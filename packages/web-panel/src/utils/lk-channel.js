import catalog from "../vendor/lk-channel-presets.json" with { type: "json" };

export const lkCatalog = catalog;
export const lkChannel = catalog.channel;
export const lkModels = catalog.models;
const normalized = (value) =>
  String(value || "")
    .trim()
    .replace(/\/+$/, "");

export function lkConnection(protocol, address, model, models = lkModels) {
  const definition =
    Object.hasOwn(lkChannel.protocols, protocol) &&
    lkChannel.protocols[protocol];
  const origin =
    Object.hasOwn(lkChannel.addresses, address) && lkChannel.addresses[address];
  if (!definition || !origin) throw new Error("请选择有效的 LK 协议与地址");
  const selected = model || definition.defaultModel;
  const known = models.find((entry) => entry.id === selected);
  if (
    known &&
    (known.type !== "chat" || !known.compatibleProtocols.includes(protocol))
  )
    throw new Error("此 LK 模型不支持当前对话协议");
  return {
    provider: definition.provider,
    model: selected,
    baseUrl: origin + definition.basePath,
  };
}

export function lkSelection(connection) {
  const protocol =
    connection.provider === "custom" || connection.provider === "openai"
      ? "openai"
      : connection.provider;
  const definition = lkChannel.protocols[protocol];
  if (!definition || !Object.hasOwn(lkChannel.protocols, protocol)) return null;
  for (const [address, origin] of Object.entries(lkChannel.addresses)) {
    if (normalized(connection.baseUrl) === origin + definition.basePath)
      return { protocol, address };
  }
  return null;
}
