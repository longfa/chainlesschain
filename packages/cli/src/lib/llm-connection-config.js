import { BUILT_IN_PROVIDERS } from "./llm-providers.js";
import { createHash } from "node:crypto";
import { normalizeOllamaBaseUrl } from "./ollama-base-url.js";
import { isLkEndpoint, resolveLkConnection } from "./llm-channel-presets.js";
import {
  setSecretConfigValue,
  updateConfigAtomically,
  loadConfig,
} from "./config-manager.js";

export function normalizeLlmConnection(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) =>
        ![
          "provider",
          "model",
          "baseUrl",
          "visionModel",
          "apiKey",
          "allowHttp",
        ].includes(k),
    )
  )
    throw new Error("Invalid LLM connection fields");
  const value = {};
  for (const key of ["provider", "model", "baseUrl", "visionModel", "apiKey"]) {
    if (input[key] != null && typeof input[key] !== "string")
      throw new Error(`Invalid ${key}`);
    value[key] = (input[key] || "").trim();
    if (value[key].length > (key === "apiKey" ? 8192 : 2048))
      throw new Error(`${key} is too long`);
  }
  if (
    value.provider !== "custom" &&
    !Object.hasOwn(BUILT_IN_PROVIDERS, value.provider)
  )
    throw new Error("Choose a supported provider/protocol");
  if (!value.model || /[\r\n\0]/.test(value.model + value.visionModel))
    throw new Error("A valid model name is required");
  let url;
  try {
    url = new URL(value.baseUrl);
  } catch {
    throw new Error("Invalid LLM Base URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Base URL must be HTTP(S), without credentials, query or fragment",
    );
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    input.allowHttp !== true
  )
    throw new Error("Confirm unencrypted HTTP before using a remote endpoint");
  if (
    /\/(chat\/completions|messages|responses|api\/generate)\/?$/.test(
      url.pathname,
    )
  )
    throw new Error(
      "Use the API base path, not a completion/messages endpoint",
    );
  value.baseUrl = url.href.replace(/\/+$/, "");
  if (isLkEndpoint(value.baseUrl)) {
    const expected = resolveLkConnection(
      ["custom", "openai"].includes(value.provider) ? "openai" : value.provider,
      "primary",
      { model: value.model },
    );
    if (url.pathname.replace(/\/+$/, "") !== new URL(expected.baseUrl).pathname)
      throw new Error("LK Base URL does not match the selected protocol");
  }
  if (value.provider === "ollama") {
    value.baseUrl = normalizeOllamaBaseUrl(value.baseUrl);
  }
  return value;
}

export function llmConnectionIdentity(connection = {}) {
  const provider = connection.provider || "ollama";
  let baseUrl = String(
    connection.baseUrl || BUILT_IN_PROVIDERS[provider]?.baseUrl || "",
  )
    .trim()
    .replace(/\/+$/, "");
  try {
    baseUrl = new URL(baseUrl).href.replace(/\/+$/, "");
    if (provider === "ollama") baseUrl = normalizeOllamaBaseUrl(baseUrl);
  } catch {
    // Preserve malformed legacy destinations separately until they are repaired.
  }
  return isLkEndpoint(baseUrl) ? "channel:lk" : `${provider}:${baseUrl}`;
}
const profileId = (connection) =>
  createHash("sha256").update(llmConnectionIdentity(connection)).digest("hex");
const profileFields = (connection) =>
  Object.fromEntries(
    ["provider", "model", "baseUrl", "visionModel", "apiKey", "apiKeyHelper"]
      .filter((key) => connection[key] !== undefined)
      .map((key) => [key, connection[key]]),
  );

export function saveLlmConnection(
  input,
  { storage = "auto", configMutator } = {},
) {
  if (!["auto", "keychain", "file"].includes(storage))
    throw new Error("Secret storage must be auto, keychain, or file");
  const value = normalizeLlmConnection(input);
  const targetId = profileId(value);
  const mutate = (config) => {
    const current = config.llm || {};
    const profiles = { ...(current.savedConnections || {}) };
    // Move raw references, never resolved plaintext, when migrating legacy config.
    // Older configs can have a credential before a model has been chosen.
    if (current.provider) profiles[profileId(current)] = profileFields(current);
    const saved = profiles[targetId] || {};
    const credential = saved.apiKey || null;
    const helper = saved.apiKeyHelper || null;
    if (
      (isLkEndpoint(value.baseUrl) ||
        !["ollama", "custom"].includes(value.provider)) &&
      !value.apiKey &&
      !credential &&
      !helper
    )
      throw new Error(
        "A new endpoint requires its own API key; the existing key was not reused",
      );
    const next = {
      ...current,
      provider: value.provider,
      model: value.model,
      baseUrl: value.baseUrl,
      visionModel: value.visionModel || null,
      savedConnections: profiles,
    };
    delete next.apiKey;
    delete next.apiKeyHelper;
    if (credential) next.apiKey = credential;
    if (helper && !value.apiKey) next.apiKeyHelper = helper;
    profiles[targetId] = profileFields(next);
    config.llm = next;
    configMutator?.(config);
  };
  // A single lock and atomic rename bind endpoint and credential together.
  // An interrupted save cannot route the old credential to the new endpoint.
  if (value.apiKey)
    setSecretConfigValue(
      `llm.savedConnections.${targetId}.apiKey`,
      value.apiKey,
      {
        storage,
        configMutator: mutate,
        storedValueMutator: (config, storedValue) => {
          config.llm.apiKey = storedValue;
        },
      },
    );
  else updateConfigAtomically(mutate, { resolveSecrets: false });
  return {
    provider: value.provider,
    model: value.model,
    baseUrl: value.baseUrl,
    visionModel: value.visionModel || null,
  };
}

/** A non-secret snapshot for authenticated configuration UIs. */
export function readLlmConnection() {
  const current =
    loadConfig({ resolveSecrets: false, failIfUnavailable: true }).llm || {};
  const provider = current.provider || "ollama";
  return {
    provider,
    model: current.model || "",
    baseUrl: current.baseUrl || BUILT_IN_PROVIDERS[provider]?.baseUrl || "",
    visionModel: current.visionModel || "",
    hasKey: Boolean(current.apiKey || current.apiKeyHelper),
    temperature: current.temperature ?? 0.7,
    maxTokens: current.maxTokens ?? 4096,
    savedConnections: publicConnections(current),
  };
}

function publicConnections(current) {
  const profiles = { ...(current.savedConnections || {}) };
  if (current.provider) profiles[profileId(current)] = profileFields(current);
  return Object.values(profiles)
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      provider: row.provider,
      model: row.model || "",
      baseUrl: row.baseUrl || BUILT_IN_PROVIDERS[row.provider]?.baseUrl || "",
      visionModel: row.visionModel || "",
      hasKey: Boolean(row.apiKey || row.apiKeyHelper),
      channel: isLkEndpoint(row.baseUrl) ? "lk" : null,
    }));
}

export async function readLlmConnectionInput(stream = process.stdin) {
  if (stream.isTTY)
    throw new Error("Send the LLM configuration JSON through stdin");
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32768) throw new Error("LLM configuration input is too large");
    chunks.push(buffer);
  }
  const input = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(input);
  } catch {
    throw new Error("LLM configuration input must be valid JSON");
  }
}
