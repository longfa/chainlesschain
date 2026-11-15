import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  captureEvolutionLedgerV2JournalLocalRetentionInventory as capture,
  captureEvolutionLedgerV2JournalReferencedSegmentInventory as references,
} from "../../src/lib/evolution/evolution-ledger-v2-journal.js";
import {
  captureImmutableLedgerSegmentStoreFileInventory as captureFiles,
  computeImmutableLedgerSegmentProofDigest,
} from "../../src/lib/evolution/evolution-immutable-ledger-segment-store.js";
import { EVOLUTION_RETAINED_SEGMENT_STATE_READ_FAILED_CODE as FAILED } from "../../src/lib/evolution/evolution-file-retained-segment-backend.js";
import {
  openLedgerV2Fixture,
  v2FixtureDomainEvent,
  V2_FIXTURE_RETENTION,
} from "../fixtures/evolution-ledger-v2-store.js";

const temp = fs.realpathSync.native(os.tmpdir());
const options = {
  tenantId: "audit-tenant",
  artifactTenantId: "audit-artifacts",
  audience: "audit-runtime",
  originalRetentionPorts: true,
  originalManifestPorts: true,
  originalWitnessPorts: true,
};
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
describe.sequential(
  "complete local retained directory and authentic manifest references",
  () => {
    let root, fixture, directory, initial, originalBytes;
    const control = { revoked: false, onVerify: null };
    const file = (reference) =>
      path.join(directory, `${reference.slice(7)}.json`);
    function move(from, to) {
      for (const target of [from, to])
        if (!path.resolve(target).startsWith(root + path.sep))
          throw new Error("unsafe audit fixture move");
      fs.renameSync(from, to);
    }
    const orphan = (label) =>
      fixture.manifest.segments.retain({
        bytes: Buffer.from(`retained-but-unpublished:${label}`),
        sequenceStart: 10_000,
        sequenceEnd: 10_000,
        minimumRetainedUntil: V2_FIXTURE_RETENTION,
      });
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(temp, "cc-local-retention-audit-"));
      fixture = openLedgerV2Fixture(path.join(root, "store"), {
        ...options,
        retentionProofControl: control,
      });
      directory = fixture.manifest.segmentDirectory;
      initial = capture(fixture.journal);
      originalBytes = new Map(
        fs
          .readdirSync(directory)
          .map((name) => [name, fs.readFileSync(path.join(directory, name))]),
      );
    }, 60_000);
    afterAll(() => {
      if (
        path.dirname(root) !== temp ||
        !path.basename(root).startsWith("cc-local-retention-audit-")
      )
        throw new Error("unsafe local retention audit cleanup");
      fs.rmSync(root, { recursive: true, force: true });
    }, 60_000);

    it("enumerates and authenticates every actual file with exact byte and identity evidence", () => {
      expect(initial.snapshot.fileCount).toBe(originalBytes.size);
      expect(initial.snapshot.fileCount).toBeGreaterThan(1);
      expect(initial.snapshot.referencedCount).toBe(originalBytes.size);
      expect(initial.snapshot.unreferencedCount).toBe(0);
      let total = 0;
      for (const entry of initial.snapshot.entries) {
        const bytes = originalBytes.get(entry.name);
        const stat = fs.lstatSync(file(entry.segmentRef), { bigint: true });
        expect(entry.encodedBytes).toBe(bytes.length);
        expect(entry.encodedDigest).toBe(hash(bytes));
        expect(entry.identity.ino).toBe(String(stat.ino));
        expect(entry.identity.mtimeNs).toBe(String(stat.mtimeNs));
        expect(entry.disposition).toBe("referenced");
        expect(entry.manifestDigest).toMatch(/^sha256:/u);
        expect(Object.isFrozen(entry.identity)).toBe(true);
        total += bytes.length;
      }
      expect(initial.snapshot.totalEncodedBytes).toBe(total);
      expect(initial.snapshot).toMatchObject({
        localDirectoryInventoryVerified: true,
        externalWormVerified: false,
        fullPhysicalStorageGraphVerified: false,
        grantsMutationOrPromotionAuthority: false,
      });
      expect(initial.recheck()).toBe(true);
    }, 60_000);

    it("classifies a genuine signed unreferenced retain without publishing or deleting it", () => {
      const prior = references(fixture.journal).snapshot;
      const retained = orphan("positive");
      const target = file(retained.segmentRef);
      try {
        expect(() => initial.recheck()).toThrow(/changed after capture/u);
        const audit = capture(fixture.journal);
        expect(audit.snapshot.fileCount).toBe(initial.snapshot.fileCount + 1);
        expect(audit.snapshot.unreferencedCount).toBe(1);
        expect(
          audit.snapshot.entries.find(
            (entry) => entry.segmentRef === retained.segmentRef,
          ),
        ).toMatchObject({
          disposition: "unreferenced-retained",
          manifestDigest: null,
          proofDigest: retained.proof.proofDigest,
        });
        expect(references(fixture.journal).snapshot).toEqual(prior);
        expect(fs.existsSync(target)).toBe(true);
        expect(audit.recheck()).toBe(true);
      } finally {
        move(target, path.join(root, "positive-orphan.json"));
      }
      expect(initial.recheck()).toBe(true);
    }, 60_000);

    it("rejects an unreferenced file with substituted filename/content binding", () => {
      const target = file(`sha256:${"f".repeat(64)}`);
      fs.writeFileSync(target, originalBytes.values().next().value, {
        mode: 0o600,
      });
      try {
        expect(() => capture(fixture.journal)).toThrow();
        expect(references(fixture.journal).snapshot.segmentCount).toBe(
          initial.snapshot.referencedCount,
        );
      } finally {
        move(target, path.join(root, "substituted-orphan.json"));
      }
    }, 60_000);

    it.each(["signature", "tenant", "epoch"])(
      "rejects wrong %s in a real unreferenced proof",
      (field) => {
        const retained = orphan(field);
        const target = file(retained.segmentRef);
        const stored = JSON.parse(fs.readFileSync(target, "utf8"));
        if (field === "signature") stored.proof.signature = "forged";
        else {
          stored.proof[field === "tenant" ? "tenantId" : "epoch"] =
            "another-scope";
          stored.proof.proofDigest = computeImmutableLedgerSegmentProofDigest(
            stored.proof,
          );
          stored.proof.signature = createHmac(
            "sha256",
            "test-only-v2-retention",
          )
            .update(stored.proof.proofDigest)
            .digest("base64url");
        }
        fs.writeFileSync(target, JSON.stringify(stored));
        try {
          expect(() => capture(fixture.journal)).toThrow();
        } finally {
          move(target, path.join(root, `rejected-${field}-orphan.json`));
        }
      },
      60_000,
    );

    it("holds unknown temporary files without repairing or removing them", () => {
      const target = path.join(directory, "incomplete.tmp");
      fs.writeFileSync(target, "partial publication");
      try {
        expect(() => capture(fixture.journal)).toThrow(
          expect.objectContaining({ code: FAILED }),
        );
        expect(fs.readFileSync(target, "utf8")).toBe("partial publication");
        expect(references(fixture.journal).snapshot.segmentCount).toBe(
          initial.snapshot.referencedCount,
        );
      } finally {
        move(target, path.join(root, "incomplete.tmp"));
      }
    }, 60_000);

    it("rejects subdirectories masquerading as retained file names", () => {
      const target = file(`sha256:${"e".repeat(64)}`);
      fs.mkdirSync(target, { mode: 0o700 });
      try {
        expect(() => captureFiles(fixture.manifest.segments)).toThrow(
          expect.objectContaining({ code: FAILED }),
        );
      } finally {
        move(target, path.join(root, "unexpected-directory"));
      }
    }, 60_000);

    it("rechecks proof authority on every full inventory capture", () => {
      const files = captureFiles(fixture.manifest.segments);
      control.revoked = true;
      try {
        expect(() => files.recheck()).toThrow();
        expect(() => files.recheck()).toThrow();
      } finally {
        control.revoked = false;
      }
      expect(files.recheck()).toBe(true);
      expect(() => files.recheckPhysicalSnapshot({})).toThrow(TypeError);
    }, 60_000);

    it("detects an identical-byte replacement made during later reference verification", () => {
      const target = file(initial.snapshot.entries[0].segmentRef);
      const bytes = fs.readFileSync(target);
      const saved = path.join(root, "late-original.json");
      const fileCount = fs.readdirSync(directory).length;
      let calls = 0,
        fired = false;
      control.onVerify = () => {
        if (++calls === fileCount + 1) {
          fired = true;
          move(target, saved);
          fs.writeFileSync(target, bytes, { mode: 0o600 });
        }
      };
      try {
        expect(() => capture(fixture.journal)).toThrow(
          expect.objectContaining({ code: FAILED }),
        );
        expect(fired).toBe(true);
        expect(fs.readFileSync(target)).toEqual(bytes);
      } finally {
        control.onVerify = null;
        if (fired) {
          move(target, path.join(root, "late-clone.json"));
          move(saved, target);
        }
      }
      expect(capture(fixture.journal).recheck()).toBe(true);
    }, 60_000);

    it("keeps custom external ports available without claiming a local inventory", () => {
      const custom = openLedgerV2Fixture(path.join(root, "external"), {
        ...options,
        originalRetentionPorts: false,
      });
      expect(captureFiles(custom.manifest.segments)).toBeNull();
      expect(capture(custom.journal)).toBeNull();
      expect(references(custom.journal).snapshot.segmentCount).toBeGreaterThan(
        0,
      );
    }, 60_000);

    it("rejects structural/proxy ports and replacement contexts without invoking traps", () => {
      let traps = 0;
      const proxy = new Proxy(fixture.journal, {
        get() {
          traps++;
          throw new Error("trap");
        },
      });
      const revoked = Proxy.revocable(fixture.manifest.segments, {});
      revoked.revoke();
      expect(() => capture(proxy)).toThrow(TypeError);
      expect(() => capture({ ...fixture.journal })).toThrow(TypeError);
      expect(() => captureFiles(revoked.proxy)).toThrow(TypeError);
      expect(() => captureFiles({ ...fixture.manifest.segments })).toThrow(
        TypeError,
      );
      expect(() => capture(fixture.journal, {})).toThrow(TypeError);
      expect(() => captureFiles(fixture.manifest.segments, {})).toThrow(
        TypeError,
      );
      expect(() => initial.recheck({})).toThrow(TypeError);
      expect(traps).toBe(0);
    });

    it("reconstructs an identical audit from an independent process", () => {
      const expected = capture(fixture.journal).snapshot;
      const fixtureUrl = new URL(
        "../fixtures/evolution-ledger-v2-store.js",
        import.meta.url,
      ).href;
      const journalUrl = new URL(
        "../../src/lib/evolution/evolution-ledger-v2-journal.js",
        import.meta.url,
      ).href;
      const script = `
      import { openLedgerV2Fixture } from ${JSON.stringify(fixtureUrl)};
      import { captureEvolutionLedgerV2JournalLocalRetentionInventory } from ${JSON.stringify(journalUrl)};
      const value = openLedgerV2Fixture(process.argv[1], ${JSON.stringify(options)});
      const audit = captureEvolutionLedgerV2JournalLocalRetentionInventory(value.journal);
      if (!audit.recheck()) throw new Error('recheck');
      process.stdout.write(JSON.stringify(audit.snapshot));
    `;
      const output = execFileSync(
        process.execPath,
        ["--input-type=module", "-e", script, path.join(root, "store")],
        { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 },
      );
      expect(JSON.parse(output)).toEqual(expected);
    }, 30_000);

    it("invalidates the captured audit after a genuine journal append", () => {
      const before = capture(fixture.journal);
      fixture.journal.appendDomainEvent(
        v2FixtureDomainEvent(fixture, "after-complete-audit"),
      );
      expect(() => before.recheck()).toThrow(/changed after capture/u);
      const after = capture(fixture.journal);
      expect(after.snapshot.fileCount).toBe(before.snapshot.fileCount + 1);
      expect(after.snapshot.referencedCount).toBe(
        before.snapshot.referencedCount + 1,
      );
      expect(after.snapshot.unreferencedCount).toBe(0);
      expect(after.recheck()).toBe(true);
      for (const [name, bytes] of originalBytes)
        expect(fs.readFileSync(path.join(directory, name))).toEqual(bytes);
    }, 60_000);
  },
);
