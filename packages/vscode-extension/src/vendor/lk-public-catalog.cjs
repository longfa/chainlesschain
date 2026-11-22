const SOURCE_URL =
  "https://api.cc888.ai/gongkai/apidoc/moxing-liebiao?domain=chainlesschain.net";
const TYPES = ["chat", "image", "video", "audio"];
const CHAT_PROTOCOLS = ["openai", "openai_responses", "anthropic", "gemini"];

function normalizePublicLkCatalog(payload) {
  if (payload?.code !== 200) throw new Error("Invalid LK catalog response");
  const ids = new Set();
  return TYPES.flatMap((type) => {
    const rows = payload.data?.[type];
    if (!Array.isArray(rows) || (type === "chat" && !rows.length))
      throw new Error("Missing LK catalog group");
    return rows.map((row) => {
      const id = row?.mingcheng;
      const supported = type === "chat" ? CHAT_PROTOCOLS : ["media"];
      const protocol = row?.api_xieyi;
      if (
        typeof id !== "string" ||
        !id ||
        id.length > 256 ||
        /[\s\p{Cc}]/u.test(id) ||
        ids.has(id) ||
        !supported.includes(protocol)
      )
        throw new Error("Invalid or duplicate LK model");
      ids.add(id);
      const compatible = Array.isArray(row.jianrong_xieyi)
        ? row.jianrong_xieyi.filter((value) => supported.includes(value))
        : [];
      const label = row.zhanshi_mingcheng;
      return {
        id,
        label: typeof label === "string" && label ? label.slice(0, 256) : id,
        type,
        protocol,
        compatibleProtocols: [...new Set([...compatible, protocol])],
      };
    });
  });
}

async function readPublicLkCatalog(fetchImpl = fetch) {
  const response = await fetchImpl(SOURCE_URL, {
    headers: { Accept: "application/json" },
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !response.body) throw new Error("LK catalog unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2 * 1024 * 1024) throw new Error("LK catalog too large");
      raw += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  raw += decoder.decode();
  return { raw, models: normalizePublicLkCatalog(JSON.parse(raw)) };
}

let pendingPublicCatalog;

async function loadLkCatalog(bundledModels, fetchImpl) {
  try {
    if (fetchImpl) {
      const { models } = await readPublicLkCatalog(fetchImpl);
      return { source: "live", models };
    }
    pendingPublicCatalog ??= readPublicLkCatalog().finally(() => {
      pendingPublicCatalog = undefined;
    });
    const { models } = await pendingPublicCatalog;
    return { source: "live", models };
  } catch {
    return { source: "bundled", models: bundledModels };
  }
}

module.exports = {
  SOURCE_URL,
  normalizePublicLkCatalog,
  readPublicLkCatalog,
  loadLkCatalog,
};
