import { createHash } from "node:crypto";

export const PERMISSION_PROFILE_SCHEMA = "chainlesschain.permission-profile/v1";

function canonical(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

export function permissionProfileDigest(profile = {}) {
  const payload = canonical({ schema: PERMISSION_PROFILE_SCHEMA, profile });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

export function snapshotPermissionProfile(
  profile = {},
  { turnId = null } = {},
) {
  const snapshot = {
    schema: PERMISSION_PROFILE_SCHEMA,
    turnId: turnId == null ? null : String(turnId),
    profile: structuredClone(profile),
  };
  return Object.freeze({
    ...snapshot,
    digest: permissionProfileDigest(snapshot.profile),
  });
}

export function isPermissionProfileCurrent(snapshot, profile, turnId = null) {
  return Boolean(
    snapshot &&
    snapshot.digest === permissionProfileDigest(profile) &&
    (snapshot.turnId == null || String(turnId) === snapshot.turnId),
  );
}

export default {
  PERMISSION_PROFILE_SCHEMA,
  permissionProfileDigest,
  snapshotPermissionProfile,
  isPermissionProfileCurrent,
};
