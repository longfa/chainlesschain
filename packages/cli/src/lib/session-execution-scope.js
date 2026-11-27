import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";

const SCOPE_VERSION = 1;
const ISOLATION_STRENGTH = ["policy-only", "preferred", "enforced", "strict"];
const DIGEST = /^[a-f0-9]{64}$/u;

const digest = (value) => createHash("sha256").update(value).digest("hex");

function directoryIdentity(directory) {
  const resolved = fs.realpathSync.native(directory);
  const stat = fs.statSync(resolved, { bigint: true });
  if (!stat.isDirectory()) throw new Error("Execution root is not a directory");
  const pathKey =
    process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return digest(JSON.stringify([pathKey, String(stat.dev), String(stat.ino)]));
}

/** Only identity digests go into session metadata. The current host grants paths. */
export function captureSessionExecutionScope({
  cwd,
  additionalDirectories = [],
  sandbox,
}) {
  const isolation = !sandbox
    ? "policy-only"
    : sandbox.mode === "strict"
      ? "strict"
      : sandbox.policy?.allowUnsandboxedCommands === false
        ? "enforced"
        : "preferred";
  return normalizeSessionExecutionScope({
    version: SCOPE_VERSION,
    pathFamily: process.platform === "win32" ? "windows" : "posix",
    host: digest(`${process.platform}\0${os.hostname()}`),
    workspace: directoryIdentity(cwd),
    roots: [...new Set(additionalDirectories.map(directoryIdentity))].sort(),
    sandbox: { isolation, network: !sandbox || sandbox.network === true },
  });
}

export function normalizeSessionExecutionScope(scope) {
  if (scope == null) return null;
  if (
    scope.version !== SCOPE_VERSION ||
    !["windows", "posix"].includes(scope.pathFamily) ||
    typeof scope.host !== "string" ||
    !DIGEST.test(scope.host) ||
    typeof scope.workspace !== "string" ||
    !DIGEST.test(scope.workspace) ||
    !Array.isArray(scope.roots) ||
    !scope.roots.every(
      (root) => typeof root === "string" && DIGEST.test(root),
    ) ||
    !ISOLATION_STRENGTH.includes(scope.sandbox?.isolation) ||
    typeof scope.sandbox.network !== "boolean"
  ) {
    throw new Error("Stored session execution scope is malformed");
  }
  return Object.freeze({
    version: SCOPE_VERSION,
    pathFamily: scope.pathFamily,
    host: scope.host,
    workspace: scope.workspace,
    roots: Object.freeze([...new Set(scope.roots)].sort()),
    sandbox: Object.freeze({
      isolation: scope.sandbox.isolation,
      network: scope.sandbox.network,
    }),
  });
}

export function checkSessionExecutionScope(
  previous,
  current,
  allowChange = false,
) {
  if (!previous) return { status: "legacy", changes: [] };
  const changes = [];
  if (
    previous.pathFamily !== current.pathFamily ||
    previous.host !== current.host
  )
    changes.push("host-changed");
  if (previous.workspace !== current.workspace)
    changes.push("workspace-changed");
  if (current.roots.some((root) => !previous.roots.includes(root)))
    changes.push("additional-root-changed");
  if (
    ISOLATION_STRENGTH.indexOf(current.sandbox.isolation) <
      ISOLATION_STRENGTH.indexOf(previous.sandbox.isolation) ||
    (current.sandbox.network && !previous.sandbox.network)
  )
    changes.push("sandbox-weakened");
  if (changes.length)
    return { status: allowChange ? "overridden" : "refused", changes };
  if (current.roots.length < previous.roots.length)
    changes.push("additional-roots-restricted");
  if (
    previous.sandbox.isolation !== current.sandbox.isolation ||
    previous.sandbox.network !== current.sandbox.network
  ) {
    changes.push("sandbox-tightened");
  }
  return { status: changes.length ? "restricted" : "matched", changes };
}

export function describeSessionExecutionScopeChange(check) {
  if (check.status === "refused") {
    return `CC_SESSION_EXECUTION_SCOPE_CHANGED: ${check.changes.join(", ")}. Reopen the original workspace or use --resume-in-current-workspace to confirm the current scope.`;
  }
  if (check.status === "overridden" || check.status === "restricted") {
    return `Session execution scope ${check.status} (${check.changes.join(", ")}).`;
  }
  return null;
}
