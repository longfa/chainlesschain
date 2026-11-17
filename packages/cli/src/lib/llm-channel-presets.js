/** Channel endpoints are separate from protocol/provider identities. */
import catalog from "./lk-model-catalog.json" with { type: "json" };

export const LK_MODELS = catalog.models;

export const LK_CHANNEL = {
  id: "lk",
  name: "LK API",
  documentationUrl: "https://chainlesschain.net/apidoc",
  pricingUrl: "https://chainlesschain.net/api/pricing",
  addresses: {
    primary: "https://api.vv666.ai",
    backup: "https://api.lk666.ai",
  },
  protocols: {
    openai: {
      label: "OpenAI 兼容",
      provider: "custom",
      basePath: "/v1",
      defaultModel: "tt-6.1-sol",
    },
    anthropic: {
      label: "Anthropic 兼容 (FB-5.2)",
      provider: "anthropic",
      basePath: "/v1",
      defaultModel: "fb-5-2",
    },
    gemini: {
      label: "Gemini 兼容",
      provider: "gemini",
      basePath: "/v1beta",
      defaultModel: "gem-3.8-flash",
    },
  },
  endpoints: {
    chat: "/v1/chat/completions",
    responses: "/v1/responses",
    models: "/v1/models",
    images: "/v1/images/generations",
    imageEdits: "/v1/images/edits",
    messages: "/v1/messages",
    gemini: "/v1beta/models/{model}:generateContent",
    mediaGenerate: "/v1/media/generate",
    mediaStatus: "/v1/media/status?task_id={task_id}",
    mediaModels: "/v1/media/models",
    skills: "/v1/skills",
    skillsModels: "/v1/skills/models",
    pricing: "/v1/skills/models/{model_name}/pricing",
    balance: "/v1/skills/balance",
    usage: "/v1/skills/usage",
    taskStatus: "/v1/skills/task-status",
    feedback: "/v1/skills/feedback",
  },
};

export function isLkEndpoint(baseUrl) {
  const base = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  return Object.values(LK_CHANNEL.addresses).some((origin) =>
    [origin + "/v1", origin + "/v1beta"].includes(base),
  );
}

export function resolveLkConnection(
  protocol = "anthropic",
  address = "primary",
  { desktop = false, model } = {},
) {
  const definition = Object.hasOwn(LK_CHANNEL.protocols, protocol)
    ? LK_CHANNEL.protocols[protocol]
    : null;
  const origin = Object.hasOwn(LK_CHANNEL.addresses, address)
    ? LK_CHANNEL.addresses[address]
    : null;
  if (!definition || !origin) throw new Error("Unknown LK protocol or address");
  const knownModel = LK_MODELS.find((entry) => entry.id === model);
  if (
    knownModel &&
    (knownModel.type !== "chat" ||
      !knownModel.compatibleProtocols.includes(protocol))
  )
    throw new Error("LK model does not support the selected chat protocol");
  // The desktop Anthropic adapter appends /v1/messages itself.
  const basePath =
    desktop && protocol === "anthropic" ? "" : definition.basePath;
  return {
    provider: definition.provider,
    baseUrl: origin + basePath,
    model: model || definition.defaultModel || "",
  };
}
