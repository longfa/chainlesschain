import { LK_MODELS } from "./llm-channel-presets.js";
import publicCatalog from "./lk-public-catalog.cjs";

export const refreshLkCatalog = () => publicCatalog.loadLkCatalog(LK_MODELS);
