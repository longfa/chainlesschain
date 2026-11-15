import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  captureEvolutionLedgerV2JournalRetainedSegmentDirectoryBoundary as capture,
  captureEvolutionLedgerV2JournalReferencedSegmentInventory as captureInventory,
} from "../../src/lib/evolution/evolution-ledger-v2-journal.js";
import {
  captureImmutableLedgerSegmentStoreDirectoryBoundary as captureStore,
  computeImmutableLedgerSegmentProofDigest,
} from "../../src/lib/evolution/evolution-immutable-ledger-segment-store.js";
import { EVOLUTION_RETAINED_SEGMENT_STATE_READ_FAILED_CODE as FAILED } from "../../src/lib/evolution/evolution-file-retained-segment-backend.js";
import { captureRrsiObservedTextIndex } from "../../src/lib/evolution/rrsi-observed-text-index.js";
import {
  inspectRrsiTenantIndexHistory,
  verifyRrsiTenantIndexAnchorHistory,
  RRSI_TENANT_INDEX_ANCHOR_HISTORY_HOLD_CODE as HOLD,
} from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
import {
  openObservedTextFixture,
  openObservedTextIndex,
  registerPreparationPlan,
  reservePreparation,
  observationRequest,
} from "../fixtures/rrsi-observed-text.js";
import {
  historyAnchorInput,
  signHistoryAnchor,
} from "../fixtures/rrsi-anchor-history.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";

const temp = fs.realpathSync.native(os.tmpdir());
const options = {
  originalManifestPorts: true,
  originalWitnessPorts: true,
  originalRetentionPorts: true,
};
function codes(error) {
  const result = [];
  for (let current = error; current; current = current.cause)
    result.push(current.code);
  return result;
}
describe.sequential(
  "original retained segment directory in authenticated history",
  () => {
    let root, fixture, index, initial, retained, boundary, directory;
    const inspect = () =>
      inspectRrsiTenantIndexHistory({ observedTextIndex: index });
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(temp, "cc-rrsi-retention-"));
      fixture = openObservedTextFixture(root, options);
      index = openObservedTextIndex(fixture);
      boundary = capture(fixture.store.journal);
      directory = fixture.store.manifest.segmentDirectory;
      initial = inspect();
    }, 60_000);
    beforeAll(() => {
      registerPreparationPlan(fixture);
      reservePreparation(fixture);
      index.registerObservedSkillText(
        observationRequest(fixture, "# Exact retained segment history\r\n"),
      );
      retained = inspect();
    }, 60_000);
    afterAll(() => {
      vi.restoreAllMocks();
      if (
        path.dirname(root) !== temp ||
        !path.basename(root).startsWith("cc-rrsi-retention-")
      )
        throw new Error("unsafe retention fixture cleanup");
      fs.rmSync(root, { recursive: true, force: true });
    }, 60_000);

    function renameInside(from, to) {
      for (const target of [from, to])
        if (!path.resolve(target).startsWith(root + path.sep))
          throw new Error("unsafe retention rename");
      fs.renameSync(from, to);
    }
    function cloneOriginal(saved) {
      renameInside(directory, saved);
      fs.cpSync(saved, directory, { recursive: true });
      if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
    }
    function restore(saved, clone) {
      if (fs.existsSync(directory)) renameInside(directory, clone);
      renameInside(saved, directory);
    }

    it("projects the genuine local directory and keeps all production grants false", () => {
      expect(boundary).toBe(captureStore(fixture.store.manifest.segments));
      expect(boundary.descriptor.directory.path).toBe(directory);
      expect(retained.current.checkpoint.sequence).toBeGreaterThan(
        initial.current.checkpoint.sequence,
      );
      expect(retained).toMatchObject({
        retainedSegmentDirectoryBoundaryDigest: rrsiHash(
          "chainlesschain.rrsi-retained-segment-directory-boundary/v1",
          boundary.descriptor,
        ),
        retainedSegmentDirectoryBoundaryRechecked: true,
        retainedSegmentBoundaryScope:
          "original-local-retained-segment-directory",
        fullPhysicalStorageGraphVerified: false,
        decision: "HOLD",
      });
      expect(fs.readdirSync(directory).length).toBeGreaterThan(0);
    });

    it("projects every original catalog reference and exact decoded payload byte count", () => {
      const inventory = captureInventory(fixture.store.journal);
      const manifests = fixture.store.manifest.catalogBackend.list();
      expect(
        inventory.snapshot.entries.map((entry) => entry.manifestDigest),
      ).toEqual(manifests.map((manifest) => manifest.manifestDigest));
      let total = 0;
      for (const entry of inventory.snapshot.entries) {
        const stored = JSON.parse(
          fs.readFileSync(
            path.join(directory, `${entry.segmentRef.slice(7)}.json`),
            "utf8",
          ),
        );
        const size = Buffer.from(stored.bytes, "base64").length;
        expect(entry.payloadBytes).toBe(size);
        expect(entry.proofDigest).toBe(stored.proof.proofDigest);
        total += size;
      }
      expect(retained).toMatchObject({
        retainedSegmentInventoryDigest: inventory.snapshot.inventoryDigest,
        retainedSegmentInventoryVerified: true,
        retainedSegmentInventoryScope:
          "authenticated-manifest-referenced-segments",
        retainedSegmentInventoryCount: manifests.length,
        retainedSegmentInventoryPayloadBytes: total,
        fullPhysicalStorageGraphVerified: false,
      });
      expect(inventory.recheck()).toBe(true);
    }, 60_000);

    it("ignores unreferenced orphan files without claiming a full directory inventory", () => {
      const orphan = path.join(directory, `${"f".repeat(64)}.json`);
      expect(fs.existsSync(orphan)).toBe(false);
      fs.writeFileSync(orphan, "unpublished orphan", { mode: 0o600 });
      try {
        expect(inspect()).toEqual(retained);
        expect(
          captureInventory(fixture.store.journal).snapshot
            .directoryInventoryVerified,
        ).toBe(false);
      } finally {
        fs.unlinkSync(orphan);
      }
    }, 60_000);

    it("invalidates captured history on a renewed valid proof even when the head is unchanged", () => {
      const inventory = captureInventory(fixture.store.journal);
      const history = captureRrsiObservedTextIndex(
        index,
      ).captureHistoryCheckpoints({ checkpoints: [] });
      const entry = inventory.snapshot.entries[0];
      const file = path.join(directory, `${entry.segmentRef.slice(7)}.json`);
      const original = fs.readFileSync(file);
      const stored = JSON.parse(original);
      stored.proof.retainedUntil = "2038-09-09T00:00:00.000Z";
      stored.proof.proofDigest = computeImmutableLedgerSegmentProofDigest(
        stored.proof,
      );
      stored.proof.signature = createHmac("sha256", "test-only-v2-retention")
        .update(stored.proof.proofDigest)
        .digest("base64url");
      fs.writeFileSync(file, JSON.stringify(stored));
      try {
        expect(() => inventory.recheck()).toThrow(/changed after capture/u);
        expect(() => history.recheck()).toThrow();
        const changed = inspect();
        expect(changed.current).toEqual(retained.current);
        expect(changed.retainedSegmentInventoryDigest).not.toBe(
          retained.retainedSegmentInventoryDigest,
        );
        expect(changed.retainedSegmentInventoryVerified).toBe(true);
      } finally {
        fs.writeFileSync(file, original);
      }
      expect(history.recheck()).toBe(true);
      expect(inspect()).toEqual(retained);
    }, 60_000);

    it("rejects forged stores and journals without probing caller properties", () => {
      let traps = 0;
      const handler = {
        get() {
          traps++;
          throw new Error("trap");
        },
      };
      const revoked = Proxy.revocable(fixture.store.journal, handler);
      revoked.revoke();
      for (const fake of [
        { ...fixture.store.journal },
        new Proxy(fixture.store.journal, handler),
        revoked.proxy,
      ])
        expect(() => capture(fake)).toThrow(TypeError);
      expect(() =>
        captureStore({ ...fixture.store.manifest.segments }),
      ).toThrow(TypeError);
      expect(() => capture(fixture.store.journal, {})).toThrow(TypeError);
      expect(() => captureStore(fixture.store.manifest.segments, {})).toThrow(
        TypeError,
      );
      expect(traps).toBe(0);
    });

    it("leaves custom external retention ports explicitly unclaimed", () => {
      const custom = openObservedTextFixture(path.join(root, "custom"));
      expect(capture(custom.store.journal)).toBeNull();
      expect(captureStore(custom.store.manifest.segments)).toBeNull();
      const report = inspectRrsiTenantIndexHistory({
        observedTextIndex: openObservedTextIndex(custom),
      });
      expect(report).toMatchObject({
        retainedSegmentDirectoryBoundaryDigest: null,
        retainedSegmentDirectoryBoundaryRechecked: false,
        retainedSegmentBoundaryScope: null,
      });
    }, 60_000);

    it("rejects same-byte directory clones and accepts the restored original", () => {
      const saved = path.join(root, "saved");
      cloneOriginal(saved);
      try {
        let error;
        try {
          inspect();
        } catch (cause) {
          error = cause;
        }
        expect(error?.code).toBe(HOLD);
        expect(codes(error)).toContain(FAILED);
        expect(fs.readdirSync(directory)).toEqual(fs.readdirSync(saved));
        for (const name of fs.readdirSync(saved))
          expect(fs.readFileSync(path.join(directory, name))).toEqual(
            fs.readFileSync(path.join(saved, name)),
          );
      } finally {
        restore(saved, path.join(root, "clone"));
      }
      expect(inspect()).toEqual(retained);
    }, 60_000);

    it("does not recreate a missing directory during history readback", () => {
      const saved = path.join(root, "missing-original");
      renameInside(directory, saved);
      try {
        expect(() => inspect()).toThrow(
          expect.objectContaining({ code: HOLD }),
        );
        expect(fs.existsSync(directory)).toBe(false);
      } finally {
        renameInside(saved, directory);
      }
      expect(inspect()).toEqual(retained);
    }, 60_000);

    it("rejects corrupted signed segment content even when the directory capability passes", () => {
      const file = path.join(directory, fs.readdirSync(directory)[0]);
      const bytes = fs.readFileSync(file);
      const parsed = JSON.parse(bytes);
      parsed.proof.signature = "forged";
      fs.writeFileSync(file, JSON.stringify(parsed));
      try {
        expect(boundary.recheck()).toBe(boundary.descriptor);
        expect(() => inspect()).toThrow(
          expect.objectContaining({ code: HOLD }),
        );
      } finally {
        fs.writeFileSync(file, bytes);
      }
      expect(inspect()).toEqual(retained);
    }, 60_000);

    it("retains the same local directory digest after independent reopen", () => {
      const reopened = openObservedTextFixture(root, options);
      const report = inspectRrsiTenantIndexHistory({
        observedTextIndex: openObservedTextIndex(reopened),
      });
      expect(report).toEqual(retained);
    }, 60_000);

    it("reopens the retained history in a fresh Node process", () => {
      const fixtureModule = new URL(
        "../fixtures/rrsi-observed-text.js",
        import.meta.url,
      ).href;
      const historyModule = new URL(
        "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js",
        import.meta.url,
      ).href;
      const script = `
      import { openObservedTextFixture, openObservedTextIndex } from ${JSON.stringify(fixtureModule)};
      import { inspectRrsiTenantIndexHistory } from ${JSON.stringify(historyModule)};
      const value = openObservedTextFixture(process.argv[1], {
        originalManifestPorts: true, originalWitnessPorts: true, originalRetentionPorts: true,
      });
      const report = inspectRrsiTenantIndexHistory({ observedTextIndex: openObservedTextIndex(value) });
      process.stdout.write(JSON.stringify(report));
    `;
      const output = execFileSync(
        process.execPath,
        ["--input-type=module", "-e", script, root],
        {
          encoding: "utf8",
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
        },
      );
      expect(JSON.parse(output)).toEqual(retained);
    }, 20_000);

    it("carries the local boundary into signed anchor history without changing anchor format", () => {
      const keys = generateKeyPairSync("ed25519");
      const previous = signHistoryAnchor(
        historyAnchorInput(index, initial.current, keys),
        keys,
      );
      const current = signHistoryAnchor(
        historyAnchorInput(
          index,
          retained.current,
          keys,
          2,
          previous.anchor.anchorDigest,
        ),
        keys,
      );
      const report = verifyRrsiTenantIndexAnchorHistory({
        observedTextIndex: index,
        previous,
        current,
      });
      expect(report.retainedSegmentDirectoryBoundaryDigest).toBe(
        retained.retainedSegmentDirectoryBoundaryDigest,
      );
      expect(report.retainedSegmentDirectoryBoundaryRechecked).toBe(true);
      expect(report.storageGraphDigestVerified).toBe(false);
      expect(report.retainedSegmentInventoryDigest).toBe(
        retained.retainedSegmentInventoryDigest,
      );
      expect(report.retainedSegmentInventoryVerified).toBe(true);
      expect(JSON.stringify(current.anchor)).not.toContain(
        "retainedSegmentDirectory",
      );
    }, 60_000);

    it("detects replacement after the final journal verification", () => {
      const history = captureRrsiObservedTextIndex(
        index,
      ).captureHistoryCheckpoints({ checkpoints: [] });
      const saved = path.join(root, "late-original");
      const files = path.join(root, "store", "artifacts", "files");
      const lstat = fs.lstatSync;
      let count = 0,
        at = Infinity,
        fired = false;
      const spy = vi
        .spyOn(fs, "lstatSync")
        .mockImplementation((target, ...args) => {
          const stat = lstat(target, ...args);
          if (target === files && ++count === at) {
            fired = true;
            cloneOriginal(saved);
          }
          return stat;
        });
      try {
        expect(history.recheck()).toBe(true);
        expect(count).toBeGreaterThan(0);
        at = count;
        count = 0;
        let error;
        try {
          history.recheck();
        } catch (cause) {
          error = cause;
        }
        expect(fired).toBe(true);
        expect(codes(error)).toContain(FAILED);
      } finally {
        spy.mockRestore();
        if (fired) restore(saved, path.join(root, "late-clone"));
      }
      expect(history.recheck()).toBe(true);
    }, 60_000);
  },
);
