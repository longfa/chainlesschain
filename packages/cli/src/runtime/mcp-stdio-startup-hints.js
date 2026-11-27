import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ensureDir, getCacheDir } from "../lib/paths.js";

const MAX_BYTES = 256 * 1024;
const MAX_SERVERS = 64;
const MAX_TOOLS = 30;
const SAFE_NAME = /^[A-Za-z0-9_-]{1,128}$/u;

export function mcpStdioHintKey(name, cwd, configIdentity) {
  return createHash("sha256")
    .update(JSON.stringify([name, cwd, configIdentity]))
    .digest("hex");
}

function readHints(file) {
  let fd;
  try {
    if (!fs.lstatSync(file).isFile()) return [];
    const { O_RDONLY, O_NONBLOCK, O_NOFOLLOW } = fs.constants;
    fd = fs.openSync(file, O_RDONLY | (O_NONBLOCK || 0) | (O_NOFOLLOW || 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) return [];
    const bytes = Buffer.alloc(stat.size + 1);
    const read = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (read !== stat.size) return [];
    const document = JSON.parse(bytes.subarray(0, read).toString("utf8"));
    if (document?.version !== 1 || !Array.isArray(document.entries)) return [];
    return document.entries
      .slice(0, MAX_SERVERS)
      .filter(
        (entry) =>
          entry &&
          /^[0-9a-f]{64}$/u.test(entry.key) &&
          Number.isSafeInteger(entry.savedAt) &&
          Array.isArray(entry.toolNames) &&
          entry.toolNames.length <= MAX_TOOLS &&
          entry.toolNames.every(
            (name) => typeof name === "string" && SAFE_NAME.test(name),
          ),
      );
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Startup hints only contain display names. They never authorize a process or a tool. */
export function readMcpStdioStartupHint(key, ttlMs) {
  try {
    const file = path.join(getCacheDir(), "mcp-stdio-startup-v1.json");
    const saved = readHints(file).find((entry) => entry.key === key);
    const age = saved && Date.now() - saved.savedAt;
    return saved && age >= 0 && age <= ttlMs ? saved.toolNames : null;
  } catch {
    return null;
  }
}

export function recordMcpStdioStartupHint(key, tools) {
  const toolNames = tools
    .map((tool) => tool.name)
    .filter((name) => SAFE_NAME.test(name))
    .slice(0, MAX_TOOLS);
  if (!toolNames.length) return;
  let temporary;
  try {
    const directory = getCacheDir();
    ensureDir(directory);
    const file = path.join(directory, "mcp-stdio-startup-v1.json");
    const entries = readHints(file).filter((entry) => entry.key !== key);
    entries.unshift({ key, savedAt: Date.now(), toolNames });
    temporary = path.join(directory, `.mcp-stdio-startup-${randomUUID()}.tmp`);
    fs.writeFileSync(
      temporary,
      JSON.stringify({ version: 1, entries: entries.slice(0, MAX_SERVERS) }),
      { flag: "wx", mode: 0o600 },
    );
    fs.renameSync(temporary, file);
  } catch {
    // A cache failure leaves eager connection available on the next startup.
    if (temporary)
      try {
        fs.unlinkSync(temporary);
      } catch {
        /* best effort */
      }
  }
}
