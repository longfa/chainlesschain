import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sourceUrl =
  "https://api.lingkeai.ai/gongkai/apidoc/moxing-liebiao?domain=quexuan.net";
const inputIndex = process.argv.indexOf("--input");
const raw =
  inputIndex >= 0
    ? readFileSync(process.argv[inputIndex + 1], "utf8")
    : await (async () => {
        const response = await fetch(sourceUrl, {
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok)
          throw new Error(`Model catalog HTTP ${response.status}`);
        return response.text();
      })();
const payload = JSON.parse(raw);
if (payload.code !== 200) throw new Error("Model catalog request failed");
const models = [];
const names = new Set();
for (const type of ["chat", "image", "video", "audio"]) {
  if (!Array.isArray(payload.data?.[type]) || !payload.data[type].length)
    throw new Error(`Missing ${type} models`);
  for (const entry of payload.data[type]) {
    if (
      typeof entry.mingcheng !== "string" ||
      !entry.mingcheng ||
      names.has(entry.mingcheng) ||
      !["openai", "anthropic", "gemini", "media"].includes(entry.api_xieyi) ||
      !Array.isArray(entry.jianrong_xieyi) ||
      !entry.jianrong_xieyi.includes(entry.api_xieyi)
    )
      throw new Error("Invalid or duplicate model identity/protocol");
    names.add(entry.mingcheng);
    models.push({
      id: entry.mingcheng,
      label: entry.zhanshi_mingcheng || entry.mingcheng,
      type,
      protocol: entry.api_xieyi,
      compatibleProtocols: entry.jianrong_xieyi,
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
