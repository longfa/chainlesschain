import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureSessionExecutionScope,
  checkSessionExecutionScope,
  normalizeSessionExecutionScope,
} from "../../src/lib/session-execution-scope.js";

describe("session execution scope", () => {
  let temp;
  let workspace;
  let root;

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-execution-scope-"));
    workspace = fs.mkdirSync(path.join(temp, "workspace"), { recursive: true });
    root = fs.mkdirSync(path.join(temp, "extra"), { recursive: true });
  });

  afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

  it("recognizes the same root and permits a narrower launch policy", () => {
    const original = captureSessionExecutionScope({
      cwd: workspace,
      additionalDirectories: [root, root],
    });
    expect(original.roots).toHaveLength(1);
    expect(JSON.stringify(original)).not.toContain(temp);
    expect(checkSessionExecutionScope(original, original).status).toBe(
      "matched",
    );
    const restricted = captureSessionExecutionScope({
      cwd: workspace,
      sandbox: { mode: "strict" },
    });
    expect(checkSessionExecutionScope(original, restricted)).toEqual({
      status: "restricted",
      changes: ["additional-roots-restricted", "sandbox-tightened"],
    });
    expect(checkSessionExecutionScope(restricted, original)).toEqual({
      status: "refused",
      changes: ["additional-root-changed", "sandbox-weakened"],
    });
  });

  it("requires an explicit change for a workspace or host mismatch", () => {
    const original = captureSessionExecutionScope({ cwd: workspace });
    const other = captureSessionExecutionScope({ cwd: root });
    expect(checkSessionExecutionScope(original, other).changes).toEqual([
      "workspace-changed",
    ]);
    expect(checkSessionExecutionScope(original, other, true).status).toBe(
      "overridden",
    );
    const foreign = {
      ...original,
      pathFamily: original.pathFamily === "posix" ? "windows" : "posix",
    };
    expect(checkSessionExecutionScope(foreign, original).changes).toEqual([
      "host-changed",
    ]);
  });

  it("denies replacing an additional root with a different directory at the same path", () => {
    const original = captureSessionExecutionScope({
      cwd: workspace,
      additionalDirectories: [root],
    });
    fs.renameSync(root, path.join(temp, "original-extra"));
    fs.mkdirSync(root);
    const replaced = captureSessionExecutionScope({
      cwd: workspace,
      additionalDirectories: [root],
    });
    expect(checkSessionExecutionScope(original, replaced)).toEqual({
      status: "refused",
      changes: ["additional-root-changed"],
    });
  });

  it("preserves legacy sessions and refuses malformed declared scopes", () => {
    expect(normalizeSessionExecutionScope(undefined)).toBeNull();
    expect(checkSessionExecutionScope(null, null).status).toBe("legacy");
    expect(() => normalizeSessionExecutionScope({ version: 1 })).toThrow(
      "malformed",
    );
  });
});
