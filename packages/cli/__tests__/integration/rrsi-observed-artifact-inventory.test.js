import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  captureRrsiObservedTextArtifactInventory as capture,
  RRSI_OBSERVED_TEXT_EVENT_TYPE,
  RRSI_OBSERVED_TEXT_HOLD_CODE as HOLD,
  RRSI_OBSERVED_ARTIFACT_INVENTORY_SCHEMA as SCHEMA,
} from "../../src/lib/evolution/rrsi-observed-text-index.js";
import { RRSI_HISTORY_EVENT_TYPE } from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import {
  inspectRrsiTenantIndexHistory,
  verifyRrsiTenantIndexAnchorHistory,
} from "../../src/lib/evolution/rrsi-tenant-index-anchor-history.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
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

const temp = fs.realpathSync.native(os.tmpdir());
const text = "\uFEFF# Large observed Skill\r\n" + "界😀".repeat(20_000);
const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const originalPorts = {
  originalManifestPorts: true,
  originalWitnessPorts: true,
  originalRetentionPorts: true,
};
describe.sequential("actual observed artifact dependencies", () => {
  let root, fixture, index, empty, captured, report, expected, bytesBefore;
  const authority = { revokedDigests: new Set() };
  const file = (reference) => {
    const target = path.join(
      root,
      "store",
      "artifacts",
      "files",
      `${reference.ref.split(":").at(-1)}.json`,
    );
    if (!path.resolve(target).startsWith(root + path.sep))
      throw new Error("unsafe observed inventory file");
    return target;
  };
  const read = (reference) =>
    JSON.parse(fs.readFileSync(file(reference), "utf8"));
  const inspect = () =>
    inspectRrsiTenantIndexHistory({ observedTextIndex: index });
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(temp, "cc-observed-inventory-"));
    fixture = openObservedTextFixture(root, {
      ...originalPorts,
      artifactAuthorityControl: authority,
    });
    index = openObservedTextIndex(fixture);
    empty = capture(index);
  }, 60_000);
  beforeAll(() => {
    registerPreparationPlan(fixture);
    reservePreparation(fixture);
    index.registerObservedSkillText(observationRequest(fixture, text));
    index.registerObservedSkillText(
      observationRequest(fixture, text, ["source-conflict"]),
    );
    captured = capture(index);
    report = inspect();
    // Independent walk of the real journal records and nested text references.
    expected = new Map();
    const add = (reference, type) =>
      expected.set(reference.ref, { reference, type });
    const events = fixture.store.journal.read({
      afterSequence: 0,
      limit: 10_000,
    });
    for (const event of events) {
      if (
        event.type === RRSI_HISTORY_EVENT_TYPE &&
        event.skillName === fixture.campaign.goalId
      )
        add(event.subjectRef, "rrsi-history-event");
      if (event.type !== RRSI_OBSERVED_TEXT_EVENT_TYPE) continue;
      add(event.subjectRef, "rrsi-content-restriction-event");
      const manifestRef = read(event.subjectRef).value.manifestRef;
      add(manifestRef, "rrsi-observed-text-manifest");
      for (const chunk of read(manifestRef).value.chunks)
        add(chunk.ref, "rrsi-observed-text-chunk");
    }
    bytesBefore = new Map(
      [...expected.values()].map(({ reference }) => [
        reference.ref,
        fs.readFileSync(file(reference)),
      ]),
    );
  }, 60_000);
  afterAll(() => {
    if (
      path.dirname(root) !== temp ||
      !path.basename(root).startsWith("cc-observed-inventory-")
    )
      throw new Error("unsafe observed inventory cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }, 60_000);

  it("starts with no invented dependencies and invalidates the empty checkpoint after observation", () => {
    expect(empty.snapshot).toMatchObject({
      schema: SCHEMA,
      artifactCount: 0,
      totalPayloadBytes: 0,
      entries: [],
    });
    expect(() => empty.recheck()).toThrow(/head changed after prefix capture/u);
  });

  it("includes exact records, shared manifests/chunks and the associated preparation declaration chain", () => {
    const snapshot = captured.snapshot;
    expect(snapshot.entries.map((entry) => entry.ref.ref)).toEqual(
      [...expected.keys()].sort(),
    );
    expect(snapshot.artifactCount).toBe(expected.size);
    expect(snapshot.tenantId).toBe(fixture.store.descriptor.tenantId);
    expect(snapshot.artifactScope.artifactTenantId).toBe(
      fixture.store.descriptor.artifactTenantId,
    );
    expect(
      snapshot.entries.filter(
        (entry) => entry.type === "rrsi-content-restriction-event",
      ),
    ).toHaveLength(2);
    expect(
      snapshot.entries.filter(
        (entry) => entry.type === "rrsi-observed-text-manifest",
      ),
    ).toHaveLength(1);
    expect(
      snapshot.entries.filter(
        (entry) => entry.type === "rrsi-observed-text-chunk",
      ),
    ).toHaveLength(3);
    let total = 0;
    for (const entry of snapshot.entries) {
      const expectedEntry = expected.get(entry.ref.ref);
      const bytes = bytesBefore.get(entry.ref.ref);
      expect(entry.ref).toEqual(expectedEntry.reference);
      expect(entry.type).toBe(expectedEntry.type);
      expect(entry.ref.digest).toBe(digest(bytes));
      expect(entry.payloadBytes).toBe(bytes.length);
      expect(entry.retention).toBe("ledger");
      expect(Object.isFrozen(entry.ref)).toBe(true);
      expect(Object.isFrozen(entry)).toBe(true);
      total += bytes.length;
    }
    expect(snapshot.totalPayloadBytes).toBe(total);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
    const { inventoryDigest, ...core } = snapshot;
    expect(inventoryDigest).toBe(rrsiHash(SCHEMA, core));
    expect(captured.recheck()).toBe(true);
  }, 60_000);

  it("projects the same digest without including raw text or granting storage/producer authority", () => {
    expect(report).toMatchObject({
      observedArtifactInventoryDigest: captured.snapshot.inventoryDigest,
      observedArtifactInventoryVerified: true,
      observedArtifactInventoryScope:
        "observed-text-and-associated-preparation-artifacts",
      observedArtifactInventoryCount: expected.size,
      observedArtifactInventoryPayloadBytes:
        captured.snapshot.totalPayloadBytes,
      fullPhysicalStorageGraphVerified: false,
      generationProvenanceVerified: false,
      decision: "HOLD",
    });
    expect(captured.snapshot).toMatchObject({
      artifactStoreInventoryVerified: false,
      grantsMutationOrPromotionAuthority: false,
    });
    expect(JSON.stringify(captured.snapshot)).not.toContain("bytesBase64");
    expect(JSON.stringify(captured.snapshot)).not.toContain(
      "Large observed Skill",
    );
  });

  it.each([
    "rrsi-observed-text-chunk",
    "rrsi-observed-text-manifest",
    "rrsi-content-restriction-event",
    "rrsi-history-event",
  ])(
    "refuses a missing %s without recreating it",
    (type) => {
      const entry = captured.snapshot.entries.find(
        (entry) => entry.type === type,
      );
      const target = file(entry.ref);
      const saved = path.join(root, `saved-${type}.json`);
      fs.renameSync(target, saved);
      try {
        expect(() => captured.recheck()).toThrow(
          expect.objectContaining({ code: HOLD }),
        );
        expect(fs.existsSync(target)).toBe(false);
      } finally {
        fs.renameSync(saved, target);
      }
      expect(captured.recheck()).toBe(true);
    },
    60_000,
  );

  it("detects an indirect chunk corruption although the journal head stays authentic", () => {
    const entry = captured.snapshot.entries.find(
      (entry) => entry.type === "rrsi-observed-text-chunk",
    );
    const target = file(entry.ref);
    const bytes = fs.readFileSync(target);
    const head = fixture.store.journal.verify();
    const saved = path.join(root, "original-corrupted-chunk.json");
    fs.renameSync(target, saved);
    try {
      // ArtifactStore publishes read-only leaves on Windows. Preserve that
      // original file and replace the pathname with a real corrupt replica.
      fs.writeFileSync(target, Buffer.alloc(bytes.length, 0x78), {
        flag: "wx",
        mode: 0o600,
      });
      expect(fixture.store.journal.verify()).toEqual(head);
      expect(() => captured.recheck()).toThrow(
        expect.objectContaining({ code: HOLD }),
      );
      expect(() => capture(index)).toThrow();
    } finally {
      if (fs.existsSync(target))
        fs.renameSync(target, path.join(root, "corrupted-chunk.json"));
      fs.renameSync(saved, target);
    }
    expect(captured.recheck()).toBe(true);
  }, 60_000);

  it("rechecks current authority for an indirect chunk on every call", () => {
    const entry = captured.snapshot.entries.find(
      (entry) => entry.type === "rrsi-observed-text-chunk",
    );
    authority.revokedDigests.add(entry.ref.digest);
    try {
      expect(() => captured.recheck()).toThrow(
        expect.objectContaining({ code: HOLD }),
      );
      expect(() => captured.recheck()).toThrow();
    } finally {
      authority.revokedDigests.clear();
    }
    expect(captured.recheck()).toBe(true);
  }, 60_000);

  it("keeps unrelated authenticated publication outside the selected dependency inventory", () => {
    const published = fixture.store.artifactPorts.putCanonical(
      "rrsi-observed-text-chunk",
      {
        schema: "chainlesschain.rrsi-observed-text-chunk/v1",
        byteLength: 1,
        chunkDigest: digest(Buffer.from("z")),
        bytesBase64: "eg==",
      },
      {
        audience: fixture.store.descriptor.audience,
        purpose: "evolution-ledger",
        retention: "ledger",
      },
    );
    expect(expected.has(published.ref.ref)).toBe(false);
    expect(capture(index).snapshot).toEqual(captured.snapshot);
    expect(inspect()).toEqual(report);
    expect(captured.recheck()).toBe(true);
  }, 60_000);

  it("reconstructs the same inventory in a fresh process without returning transient resolution receipt digests", () => {
    const fixtureUrl = new URL(
      "../fixtures/rrsi-observed-text.js",
      import.meta.url,
    ).href;
    const indexUrl = new URL(
      "../../src/lib/evolution/rrsi-observed-text-index.js",
      import.meta.url,
    ).href;
    const script = `
      import { openObservedTextFixture, openObservedTextIndex } from ${JSON.stringify(fixtureUrl)};
      import { captureRrsiObservedTextArtifactInventory } from ${JSON.stringify(indexUrl)};
      const value = openObservedTextFixture(process.argv[1], ${JSON.stringify(originalPorts)});
      const cap = captureRrsiObservedTextArtifactInventory(openObservedTextIndex(value));
      if (!cap.recheck()) throw new Error('recheck');
      process.stdout.write(JSON.stringify(cap.snapshot));
    `;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script, root],
      { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    expect(JSON.parse(output)).toEqual(captured.snapshot);
    expect(output).not.toContain("receiptDigest");
    const reopened = openObservedTextFixture(root, originalPorts);
    expect(capture(openObservedTextIndex(reopened)).snapshot).toEqual(
      captured.snapshot,
    );
  }, 30_000);

  it("carries the artifact summary into genuine Ed25519 anchor history", () => {
    const keys = generateKeyPairSync("ed25519");
    const signed = signHistoryAnchor(
      historyAnchorInput(index, report.current, keys),
      keys,
    );
    const result = verifyRrsiTenantIndexAnchorHistory({
      observedTextIndex: index,
      previous: signed,
      current: signed,
    });
    expect(result.observedArtifactInventoryDigest).toBe(
      captured.snapshot.inventoryDigest,
    );
    expect(result.observedArtifactInventoryVerified).toBe(true);
    expect(result.storageGraphDigestVerified).toBe(false);
    expect(JSON.stringify(signed.anchor)).not.toContain("ArtifactInventory");
  }, 60_000);

  it("rejects copied/proxy indexes and replacement contexts before caller traps", () => {
    let traps = 0;
    const handler = {
      get() {
        traps++;
        throw new Error("trap");
      },
    };
    const revoked = Proxy.revocable(index, handler);
    revoked.revoke();
    for (const fake of [
      { ...index },
      new Proxy(index, handler),
      revoked.proxy,
      null,
    ])
      expect(() => capture(fake)).toThrow(TypeError);
    expect(() => capture(index, {})).toThrow(TypeError);
    expect(() => captured.recheck({})).toThrow(TypeError);
    expect(traps).toBe(0);
  });

  it("preserves all original bytes and frozen evidence after all failure/recovery controls", () => {
    for (const [reference, bytes] of bytesBefore)
      expect(fs.readFileSync(file(expected.get(reference).reference))).toEqual(
        bytes,
      );
    expect(captured.recheck()).toBe(true);
  }, 60_000);
});
