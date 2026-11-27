import path from "node:path";

export const DELIVERY_UNVERIFIED = "CC_DELIVERABLE_UNVERIFIED";
export const DELIVERY_UNVERIFIED_MESSAGE =
  "Delivery unverified. At least one expected file has no verified content change.";

export function deliveryPaths(values) {
  if (values == null) return [];
  if (!Array.isArray(values) || values.length > 16) {
    throw new TypeError("Specify at most 16 workspace deliverable paths.");
  }
  return [
    ...new Set(
      values.map((value) => {
        if (
          typeof value !== "string" ||
          value.length > 1024 ||
          /[:\\]/.test(value) ||
          Array.from(value).some((character) => character.charCodeAt(0) < 32)
        ) {
          throw new TypeError(
            "Expected deliverables must use workspace-relative paths with forward slashes.",
          );
        }
        const file = path.posix.normalize(value);
        if (
          !value ||
          file === "." ||
          file === ".." ||
          file.startsWith("../") ||
          file.startsWith("/") ||
          file.endsWith("/")
        ) {
          throw new TypeError(
            "Expected deliverables must name files within the workspace.",
          );
        }
        return file;
      }),
    ),
  ];
}

export async function snapshotDelivery(cwd, paths, signal) {
  const files = deliveryPaths(paths);
  if (!files.length) return null;
  const { captureGoalWorkspace } = await import("./goal-workspace-evidence.js");
  const snapshots = await Promise.all(
    files.map((file) =>
      captureGoalWorkspace(
        cwd,
        { tool: "read_file", args: { path: file } },
        {
          signal,
          allowMissingArtifact: true,
          limits: { maxFileBytes: 4 * 1024 * 1024, maxMs: 2000 },
        },
      ),
    ),
  );
  return files.map((path, index) => ({ path, ...snapshots[index] }));
}

export async function verifyDelivery(
  cwd,
  before,
  { sessionId, turnId, signal },
) {
  if (!before) return null;
  const after = await snapshotDelivery(
    cwd,
    before.map(({ path }) => path),
    signal,
  );
  const files = after.map((current, index) => {
    const previous = before[index];
    const digest = current.artifacts?.[0]?.digest;
    const status =
      !previous.verified ||
      !current.verified ||
      previous.workspaceId !== current.workspaceId
        ? "unavailable"
        : !digest
          ? "missing"
          : previous.artifacts[0]?.digest === digest
            ? "unchanged"
            : "changed";
    return { path: current.path, status, ...(digest ? { digest } : {}) };
  });
  return {
    session_id: sessionId,
    turn_id: turnId,
    status: files.every(({ status }) => status === "changed")
      ? "verified"
      : "unverified",
    files,
    checks: "not_verified",
  };
}
