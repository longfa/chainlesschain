import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { verifyNpmRegistryReadback } from "../../scripts/verify-npm-registry-readback.mjs";

const dirs = [];
const VERSION = "1.2.3";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const RUN_ID = 123456;
const CANONICAL_REPOSITORY = "https://github.com/chainlesschain/chainlesschain";
const FORK_REPOSITORY = "https://github.com/longfa/chainlesschain";

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(repository = CANONICAL_REPOSITORY) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-npm-readback-"));
  dirs.push(dir);
  const sourceTarball = path.join(dir, `chainlesschain-${VERSION}.tgz`);
  const registryDir = path.join(dir, "registry");
  fs.mkdirSync(registryDir);
  const registryTarball = path.join(
    registryDir,
    `chainlesschain-${VERSION}.tgz`,
  );
  const bytes = Buffer.from("immutable npm release bytes");
  fs.writeFileSync(sourceTarball, bytes);
  fs.writeFileSync(registryTarball, bytes);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const sha512 = crypto.createHash("sha512").update(bytes).digest("hex");
  return {
    sourceTarball,
    registryTarball,
    manifest: {
      schema: 2,
      package: "chainlesschain",
      version: VERSION,
      commit: COMMIT,
      workflowRun: `${repository}/actions/runs/${RUN_ID}`,
      artifact: path.basename(sourceTarball),
      bytes: bytes.length,
      sha256,
      sha512,
      provenance: "npm --provenance",
    },
    provenance: {
      schema: 1,
      package: "chainlesschain",
      version: VERSION,
      commit: COMMIT,
      ref: "refs/tags/v-npm-1-2-3",
      sha512,
      repository,
      workflow: ".github/workflows/npm-publish.yml",
      runId: RUN_ID,
      attempt: 1,
    },
  };
}

describe("public npm registry readback", () => {
  it("proves registry bytes equal the immutable attested artifact", () => {
    const value = fixture();
    expect(verifyNpmRegistryReadback(value)).toMatchObject({
      package: "chainlesschain",
      version: VERSION,
      commit: COMMIT,
      publishRunId: RUN_ID,
      byteIdentical: true,
      sha256: value.manifest.sha256,
      sha512: value.manifest.sha512,
    });
  });

  it("rejects a changed public registry tarball", () => {
    const value = fixture();
    fs.appendFileSync(value.registryTarball, "tampered");
    expect(() => verifyNpmRegistryReadback(value)).toThrow(
      /registry artifact byte length/,
    );
  });

  it("verifies fork artifact bytes only when the fork authority is explicitly expected", () => {
    const value = fixture(FORK_REPOSITORY);
    expect(() => verifyNpmRegistryReadback(value)).toThrow(
      /provenance repository/,
    );
    expect(
      verifyNpmRegistryReadback({ ...value, repository: FORK_REPOSITORY }),
    ).toMatchObject({
      repository: FORK_REPOSITORY,
      commit: COMMIT,
      byteIdentical: true,
    });
  });

  it.each([
    [
      "foreign expected authority",
      (value) => {
        value.repository = "https://github.com/untrusted/chainlesschain";
        value.provenance.repository = value.repository;
        value.manifest.workflowRun = `${value.repository}/actions/runs/${RUN_ID}`;
      },
      /authorized release repositories/,
    ],
    [
      "canonical provenance for fork expectation",
      (value) => {
        value.provenance.repository = CANONICAL_REPOSITORY;
      },
      /provenance repository/,
    ],
    [
      "foreign provenance",
      (value) => {
        value.provenance.repository =
          "https://github.com/untrusted/chainlesschain";
      },
      /provenance repository/,
    ],
    [
      "canonical manifest for fork provenance",
      (value) => {
        value.manifest.workflowRun = `${CANONICAL_REPOSITORY}/actions/runs/${RUN_ID}`;
      },
      /attested workflow run/,
    ],
    [
      "short matching SHA",
      (value) => {
        value.manifest.commit = value.provenance.commit = COMMIT.slice(0, 8);
      },
      /full Git SHA/,
    ],
  ])("rejects %s even with matching artifact bytes", (_name, mutate, error) => {
    const value = { ...fixture(FORK_REPOSITORY), repository: FORK_REPOSITORY };
    mutate(value);
    expect(() => verifyNpmRegistryReadback(value)).toThrow(error);
  });

  it("uses the explicit repository environment through the real readback CLI", () => {
    const value = fixture(FORK_REPOSITORY);
    const dir = path.dirname(value.sourceTarball);
    const manifestPath = path.join(dir, "manifest.json");
    const provenancePath = path.join(dir, "provenance.json");
    const outputPath = path.join(dir, "readback.json");
    fs.writeFileSync(manifestPath, JSON.stringify(value.manifest));
    fs.writeFileSync(provenancePath, JSON.stringify(value.provenance));
    const invoke = (repository, commit = COMMIT) =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              "../../scripts/verify-npm-registry-readback.mjs",
              import.meta.url,
            ),
          ),
          value.sourceTarball,
          value.registryTarball,
          manifestPath,
          provenancePath,
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 15000,
          env: {
            ...process.env,
            CC_NPM_RELEASE_REPOSITORY: repository,
            CC_RELEASE_VERSION: VERSION,
            CC_RELEASE_COMMIT: commit,
            CC_NPM_READBACK_OUTPUT: outputPath,
          },
        },
      );
    const success = invoke(FORK_REPOSITORY);
    expect(success.status, success.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toMatchObject({
      repository: FORK_REPOSITORY,
      commit: COMMIT,
      publishRunId: RUN_ID,
      byteIdentical: true,
    });
    fs.unlinkSync(outputPath);
    for (const repository of [
      CANONICAL_REPOSITORY,
      "https://github.com/untrusted/repo",
    ]) {
      const rejected = invoke(repository);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toMatch(
        /provenance repository|authorized release repositories/,
      );
      expect(fs.existsSync(outputPath)).toBe(false);
    }
    expect(invoke(FORK_REPOSITORY, "f".repeat(40)).status).toBe(1);
    expect(fs.existsSync(outputPath)).toBe(false);
    fs.writeFileSync(
      value.registryTarball,
      Buffer.alloc(value.manifest.bytes, 0),
    );
    const tampered = invoke(FORK_REPOSITORY);
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toMatch(/registry artifact sha256/);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it.each([
    [
      "version",
      (value) => (value.provenance.version = "9.9.9"),
      /provenance version/,
    ],
    [
      "commit",
      (value) => (value.provenance.commit = "f".repeat(40)),
      /provenance commit/,
    ],
    [
      "digest",
      (value) => (value.provenance.sha512 = "ab".repeat(64)),
      /provenance sha512/,
    ],
    [
      "ref",
      (value) => (value.provenance.ref = "refs/tags/other"),
      /provenance ref/,
    ],
    ["run", (value) => (value.provenance.runId = 999), /attested workflow run/],
  ])("rejects mismatched provenance %s", (_name, mutate, error) => {
    const value = fixture();
    mutate(value);
    expect(() => verifyNpmRegistryReadback(value)).toThrow(error);
  });

  it("binds the manifest to an explicitly expected tag commit", () => {
    const value = fixture();
    expect(() =>
      verifyNpmRegistryReadback({ ...value, commit: "f".repeat(40) }),
    ).toThrow(/release manifest commit/);
  });
});
