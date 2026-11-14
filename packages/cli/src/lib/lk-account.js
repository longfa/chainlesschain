import { loadConfig } from "./config-manager.js";
import { isLkEndpoint } from "./llm-channel-presets.js";
import { resolveLlmConnection } from "./llm-connection-resolution.js";
import api from "./lk-account-api.cjs";
export const { normalizeLkAccountPart, formatLkAccount } = api;
export async function queryLkAccount(
  options = {},
  { config, fetcher = fetch } = {},
) {
  const current = (config ?? loadConfig({ failIfUnavailable: true })).llm || {};
  if (
    !isLkEndpoint(current.baseUrl) ||
    !["custom", "openai", "anthropic", "gemini"].includes(current.provider)
  )
    throw new Error("Save an LK connection before querying its account");
  const connection = resolveLlmConnection({}, [current], { env: {} });
  if (!connection.apiKey)
    throw new Error("The saved LK connection requires an API key");
  return api.fetchLkAccount(connection, options, { fetcher });
}
