import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  artifactFile,
  validateNativeCandidate,
  assertFrozenBefore,
  assessFrozenBefore,
  assertNativePackageSet,
} from "../scripts/verify01-native-task-checker.mjs";
import {
  loadNativePackageSet,
  VERSIONS,
} from "../scripts/verify01-native-task-campaign.mjs";
import {
  reviewDockerArgs,
  reviewEnvironment,
} from "../scripts/verify01-review-runtime.mjs";

test("checker subprocesses keep the mounted Linux temporary directory", () => {
  const env = reviewEnvironment({
    PATH: "/usr/bin",
    TMPDIR: "/mounted-checker/scratch",
    CC_VERIFY01_NPM_CACHE_DIR: "/mounted-checker/npm-cache",
    OPENAI_API_KEY: "fixture-key",
  });
  assert.deepEqual(env, {
    PATH: "/usr/bin",
    TMPDIR: "/mounted-checker/scratch",
    CC_VERIFY01_NPM_CACHE_DIR: "/mounted-checker/npm-cache",
  });
});

test("the shared npm cache is mounted only for locked dependency installation", () => {
  const options = {
    workspace: path.resolve("workspace"),
    control: path.resolve("control"),
    containerName: "verify01-fixture",
    imageId: `sha256:${"a".repeat(64)}`,
    uid: 1000,
    gid: 1000,
  };
  const npmCacheDir = path.resolve("npm-cache");
  const command = ["npm", "ci"];
  const setup = reviewDockerArgs({
    ...options,
    setup: true,
    command,
    npmCacheDir,
  });
  assert.ok(
    setup.includes(`type=bind,source=${npmCacheDir},target=/tmp/npm-cache`),
  );
  assert.throws(
    () => reviewDockerArgs({ ...options, command, npmCacheDir }),
    /only during locked dependency installation/,
  );
  assert.throws(
    () =>
      reviewDockerArgs({
        ...options,
        setup: true,
        command: ["node", "--version"],
        npmCacheDir,
      }),
    /only during locked dependency installation/,
  );
  const check = reviewDockerArgs({ ...options, command: ["node", "--test"] });
  assert.equal(check[check.indexOf("--network") + 1], "none");
  assert.ok(!check.some((arg) => arg.includes("/tmp/npm-cache")));
});

test("package set checker independently rejects missing, changed or mismatched version bindings", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "native-check-package-set-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "versions.json");
  const manifest = {
    schema: "chainlesschain.native-package-set/v1",
    versions: {
      ...VERSIONS,
      cli: "0.166.104",
      vscode: "0.37.149",
      jetbrains: "0.4.166",
    },
  };
  fs.writeFileSync(file, JSON.stringify(manifest));
  const { versions, packageSetDigest } = loadNativePackageSet(file);
  const source = {
    versions,
    packageSetDigest,
    samples: [{ sampleId: "verify-03", versions, packageSetDigest }],
  };
  assert.doesNotThrow(() => assertNativePackageSet(source, file));
  assert.throws(() => assertNativePackageSet(source));
  assert.throws(() =>
    assertNativePackageSet({ ...source, packageSetDigest: undefined }, file),
  );
  assert.throws(() =>
    assertNativePackageSet({ ...source, versions: VERSIONS }, file),
  );
  assert.throws(() =>
    assertNativePackageSet(
      { ...source, samples: [{ ...source.samples[0], versions: VERSIONS }] },
      file,
    ),
  );
  assert.throws(() =>
    assertNativePackageSet(
      {
        ...source,
        samples: [{ ...source.samples[0], packageSetDigest: undefined }],
      },
      file,
    ),
  );
  const legacy = {
    versions: VERSIONS,
    samples: [{ sampleId: "verify-03", versions: VERSIONS }],
  };
  assert.doesNotThrow(() => assertNativePackageSet(legacy));
  assert.throws(() => assertNativePackageSet(legacy, file));
  fs.appendFileSync(file, "\n");
  assert.throws(() => assertNativePackageSet(source, file));
});

test("accepts only exact bounded candidate bytes at the catalog path", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-check-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = "packages/cli/__tests__/regression.test.js",
    candidatePath = `verify-01/candidate/${file}`;
  fs.mkdirSync(path.dirname(path.join(root, candidatePath)), {
    recursive: true,
  });
  const bytes = Buffer.from("model delivery\n");
  fs.writeFileSync(path.join(root, candidatePath), bytes);
  const row = {
    sampleId: "verify-01",
    expectedFiles: [file],
    candidates: [
      {
        file,
        path: candidatePath,
        bytes: bytes.length,
        digest: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  };
  assert.deepEqual(
    validateNativeCandidate(root, row, { expectedFiles: [file] })[0].bytes,
    bytes,
  );
  assert.throws(
    () =>
      validateNativeCandidate(
        root,
        row,
        { expectedFiles: [file] },
        { [file]: { digest: row.candidates[0].digest } },
      ),
    /candidate unchanged from initial workspace/u,
  );
  fs.appendFileSync(path.join(root, candidatePath), "changed");
  assert.throws(
    () => validateNativeCandidate(root, row, { expectedFiles: [file] }),
    /digest mismatch/u,
  );
  assert.throws(
    () =>
      validateNativeCandidate(
        root,
        { ...row, candidates: [...row.candidates, ...row.candidates] },
        { expectedFiles: [file] },
      ),
    /duplicate/u,
  );
  assert.throws(() =>
    validateNativeCandidate(
      root,
      { ...row, candidates: [{ ...row.candidates[0], path: "other.txt" }] },
      { expectedFiles: [file] },
    ),
  );
});

test("canonical source stays exact and Windows mismatches require archive-derived evidence", () => {
  const frozen = { docs: { type: "directory" } };
  assert.deepEqual(assessFrozenBefore(frozen, frozen, "win32"), {
    exact: true,
    contentVerified: true,
    filenameEncoding: "utf8",
  });
  const extra = { ...frozen, injected: { type: "directory" } };
  assert.throws(() => assessFrozenBefore(frozen, extra, "win32"));
  assert.throws(() =>
    assessFrozenBefore(frozen, extra, "linux", {
      archiveBytes: Buffer.alloc(1024),
      canonicalSnapshot: frozen,
      expectedFiles: [],
    }),
  );
});

test("artifact paths reject traversal and alternate stream syntax", () => {
  for (const file of [
    "../secret",
    "/secret",
    "a/../../secret",
    "a\\secret",
    "C:/secret",
    "a:stream",
    "a//b",
    "./a",
  ])
    assert.throws(() => artifactFile(os.tmpdir(), file), /unsafe/u);
});

test("native initial tree must match all frozen content, permitting platform mode differences", () => {
  const frozen = {
    src: { type: "directory" },
    "src/file.js": {
      type: "file",
      bytes: 4,
      digest: "sha256:abc",
      mode: 0o755,
    },
  };
  const native = structuredClone(frozen);
  native["src/file.js"].mode = 0o644;
  assert.doesNotThrow(() => assertFrozenBefore(frozen, native));
  native["src/file.js"].digest = "sha256:modified";
  assert.throws(
    () => assertFrozenBefore(frozen, native),
    /initial bytes differ/u,
  );
  assert.throws(
    () =>
      assertFrozenBefore(frozen, { ...frozen, extra: { type: "directory" } }),
    /initial tree differs/u,
  );
});
