import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sourceUrl = "https://api.vv666.ai/v1/skills/models";
const inputIndex = process.argv.indexOf("--input");
const raw =
  inputIndex >= 0
    ? readFileSync(process.argv[inputIndex + 1], "utf8").replace(/^\uFEFF/u, "")
    : await (async () => {
        if (!process.env.LK_API_KEY)
          throw new Error(
            "Set LK_API_KEY or supply --input with a Skills models response",
          );
        const response = await fetch(sourceUrl, {
          headers: {
            Authorization: `Bearer ${process.env.LK_API_KEY}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(30000),
          redirect: "error",
        });
        if (!response.ok)
          throw new Error(`Model catalog HTTP ${response.status}`);
        return response.text();
      })();
const payload = JSON.parse(raw);
if (!Array.isArray(payload.models) || !payload.models.length)
  throw new Error("Expected a Skills models response");
const models = [];
const names = new Set();
for (const type of ["chat", "image", "video", "audio"]) {
  const entries = payload.models.filter((entry) => entry.type === type);
  if (!entries.length) throw new Error(`Missing ${type} models`);
  for (const entry of entries) {
    const protocol = type === "chat" ? entry.api_format : "media";
    const compatibleProtocols =
      type === "chat"
        ? [
            ...new Set([
              ...(entry.api_endpoints || []).map((endpoint) => endpoint.format),
              protocol,
            ]),
          ]
        : ["media"];
    if (
      typeof entry.name !== "string" ||
      !entry.name ||
      /[\r\n\0]/u.test(entry.name) ||
      entry.name.length > 256 ||
      names.has(entry.name) ||
      !["openai", "anthropic", "gemini", "media"].includes(protocol) ||
      compatibleProtocols.some(
        (value) =>
          ![
            "openai",
            "openai_responses",
            "anthropic",
            "gemini",
            "media",
          ].includes(value),
      )
    )
      throw new Error("Invalid or duplicate model identity/protocol");
    names.add(entry.name);
    models.push({
      id: entry.name,
      label: entry.display_name || entry.name,
      type,
      protocol,
      compatibleProtocols,
    });
  }
}
const catalog = {
  schema: "chainlesschain.lk-model-catalog/v1",
  sourceUrl,
  sourceSha256: createHash("sha256").update(raw).digest("hex"),
  runtimeVerified: false,
  accountVerified: false,
  models,
};
writeFileSync(
  new URL("../src/lib/lk-model-catalog.json", import.meta.url),
  JSON.stringify(catalog, null, 2) + "\n",
);
console.log(`Synchronized ${models.length} LK models`);
