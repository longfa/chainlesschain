/**
 * Save an LLM API key through the authenticated WS protocol. The key is sent
 * as structured request data and is never interpolated into a CLI command or
 * exposed through process argv.
 */
export async function saveLlmApiKey(ws, apiKey) {
  if (!ws || typeof ws.sendRaw !== "function") {
    throw new Error("WebSocket configuration API is unavailable");
  }
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error("API Key cannot be empty");
  }

  const response = await ws.sendRaw(
    {
      type: "config-set-secret",
      key: "llm.apiKey",
      value: apiKey,
    },
    15000,
  );

  if (response?.success !== true) {
    throw new Error(response?.message || "API Key save failed");
  }
  return response;
}

export async function readLlmConnection(ws) {
  await ws.waitConnected?.(8000);
  const response = await ws.sendRaw({ type: "llm-config-get" }, 15000);
  if (response?.success !== true || !response.config)
    throw new Error("无法读取连接配置");
  return response.config;
}

export async function saveLlmConnection(ws, connection) {
  await ws.waitConnected?.(8000);
  const response = await ws.sendRaw(
    { type: "llm-configure", connection },
    15000,
  );
  if (response?.success !== true)
    throw new Error(response?.message || "连接保存失败");
  return response.config;
}
