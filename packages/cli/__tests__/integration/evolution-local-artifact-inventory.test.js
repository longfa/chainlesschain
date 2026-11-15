import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EvolutionArtifactPorts,
  captureEvolutionArtifactStoreLocalInventory as capture,
  EVOLUTION_ARTIFACT_LOCAL_INVENTORY_SCHEMA as SCHEMA,
  EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE as FAILED,
  EVOLUTION_ARTIFACT_EXPIRED_CODE as EXPIRED,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { evolutionDurableStoreConfiguration } from "../fixtures/evolution-durable-store.js";
import { rrsiCanonical, rrsiHash } from "../../src/lib/evolution/rrsi-data.js";

const temp = fs.realpathSync.native(os.tmpdir());
const roots = [];
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(temp, "cc-local-artifact-audit-"));
  roots.push(root);
  const dir = options.directory ?? path.join(root, "artifacts");
  const tenantId = options.tenantId ?? "audit-artifacts";
  const control = {
    now: Date.parse("2026-09-05T00:00:00.000Z"),
    leaseMs: 60_000,
    onResolve: null,
    revoked: new Set(),
    calls: 0,
  };
  const config = evolutionDurableStoreConfiguration(root, {
    artifactTenantId: tenantId,
    audience: "audit-runtime",
  });
  const Store = options.Store ?? ArtifactStore;
  const store = new Store({ dir, now: () => control.now });
  const ports = new EvolutionArtifactPorts({
    artifactStore: store,
    tenantId,
    audience: "audit-runtime",
    ...config.artifactAuthority,
    now: () => control.now,
    currentAuthorityResolver: {
      resolve(request) {
        control.calls++;
        control.onResolve?.(request);
        const base =
          config.artifactAuthority.currentAuthorityResolver.resolve(request);
        const denied = control.revoked.has(request.digest);
        const core = {
          ...base,
          checkedAt: new Date(control.now).toISOString(),
          decisionExpiresAt: new Date(
            control.now + control.leaseMs,
          ).toISOString(),
          allowed: !denied,
          revoked: denied,
        };
        delete core.receiptDigest;
        return {
          ...core,
          receiptDigest: rrsiHash(
            "chainlesschain.evolution-artifact-authority-decision/v1",
            core,
          ),
        };
      },
    },
    ...options.portOptions,
  });
  const publish = (value, purpose = "evolution-ledger") =>
    ports.putCanonical(
      purpose === "skill-mutation"
        ? "skill-mutation-audit"
        : "evolution-ledger-v2-journal",
      value,
      {
        purpose,
        retention: "ledger",
      },
    );
  return {
    root,
    dir,
    store,
    ports,
    control,
    publish,
    files: path.join(dir, "files"),
    index: path.join(dir, "index.jsonl"),
  };
}
function move(value, from, to) {
  for (const target of [from, to])
    if (!path.resolve(target).startsWith(value.root + path.sep))
      throw new Error("unsafe artifact inventory move");
  fs.renameSync(from, to);
}
afterAll(() => {
  vi.restoreAllMocks();
  for (const root of roots) {
    if (
      path.dirname(root) !== temp ||
      !path.basename(root).startsWith("cc-local-artifact-audit-")
    )
      throw new Error("unsafe local artifact audit cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

describe.sequential("complete original ArtifactStore index/file audit", () => {
  let value, publications, initial, bytesBefore;
  beforeAll(() => {
    value = fixture();
    publications = [
      value.publish({ text: "signed audit artifact 中文" }),
      value.publish({ text: "another purpose" }, "skill-mutation"),
    ];
    initial = capture(value.ports);
    bytesBefore = new Map(
      initial.snapshot.entries.map((entry) => [
        entry.file,
        fs.readFileSync(path.join(value.files, entry.file)),
      ]),
    );
  }, 60_000);

  it("authenticates the complete index and every file across signed purposes", () => {
    const snapshot = initial.snapshot;
    expect(snapshot.fileCount).toBe(2);
    expect(snapshot.entries.map((entry) => entry.id)).toEqual(
      snapshot.entries.map((entry) => entry.id).sort(),
    );
    expect(snapshot.entries.map((entry) => entry.purpose).sort()).toEqual([
      "evolution-ledger",
      "skill-mutation",
    ]);
    expect(snapshot.totalPayloadBytes).toBe(
      [...bytesBefore.values()].reduce((sum, bytes) => sum + bytes.length, 0),
    );
    expect(snapshot.indexBytesDigest).toBe(hash(fs.readFileSync(value.index)));
    for (const entry of snapshot.entries) {
      const stat = fs.lstatSync(path.join(value.files, entry.file), {
        bigint: true,
      });
      expect(entry.identity.ino).toBe(String(stat.ino));
      expect(entry.identity.mtimeNs).toBe(String(stat.mtimeNs));
      expect(entry.ref.digest).toBe(hash(bytesBefore.get(entry.file)));
      expect(Object.isFrozen(entry.identity)).toBe(true);
    }
    const entriesHash = createHash("sha256").update(
      `${snapshot.entries.length}\0`,
    );
    for (const entry of snapshot.entries) {
      const json = rrsiCanonical(entry);
      entriesHash.update(`${Buffer.byteLength(json)}:`).update(json);
    }
    expect(snapshot.entriesDigest).toBe(`sha256:${entriesHash.digest("hex")}`);
    const { entries, inventoryDigest, ...metadata } = snapshot;
    expect(entries).toHaveLength(2);
    expect(inventoryDigest).toBe(rrsiHash(SCHEMA, metadata));
    expect(snapshot).toMatchObject({
      localIndexFileCorrespondenceVerified: true,
      signaturesAndCurrentAuthorityVerified: true,
      fullPhysicalStorageGraphVerified: false,
      externalWormVerified: false,
      grantsMutationOrPromotionAuthority: false,
    });
    expect(JSON.stringify(snapshot)).not.toContain("signed audit artifact");
    expect(JSON.stringify(snapshot)).not.toContain("receiptDigest");
    expect(initial.recheck()).toBe(true);
  });

  it("reads an empty store without bootstrapping or inventing an index row", () => {
    const empty = fixture();
    const before = fs.readFileSync(empty.index);
    expect(capture(empty.ports).snapshot).toMatchObject({
      fileCount: 0,
      entries: [],
      totalPayloadBytes: 0,
    });
    expect(fs.readFileSync(empty.index)).toEqual(before);
  });

  it("rejects a missing indexed file without recreating it", () => {
    const entry = initial.snapshot.entries[0];
    const target = path.join(value.files, entry.file),
      saved = path.join(value.root, "missing-original.json");
    move(value, target, saved);
    try {
      expect(() => capture(value.ports)).toThrow(
        expect.objectContaining({ code: FAILED }),
      );
      expect(fs.existsSync(target)).toBe(false);
    } finally {
      move(value, saved, target);
    }
  });

  it("does not recreate a missing index during explicit audit", () => {
    const saved = path.join(value.root, "missing-index.jsonl");
    move(value, value.index, saved);
    try {
      expect(() => capture(value.ports)).toThrow(
        expect.objectContaining({ code: FAILED }),
      );
      expect(fs.existsSync(value.index)).toBe(false);
    } finally {
      move(value, saved, value.index);
    }
  });

  it("refuses an identical-byte index replacement instead of adopting the new inode", () => {
    const bytes = fs.readFileSync(value.index),
      saved = path.join(value.root, "original-index.jsonl");
    move(value, value.index, saved);
    try {
      fs.writeFileSync(value.index, bytes, { mode: 0o600 });
      expect(() => capture(value.ports)).toThrow(
        expect.objectContaining({ code: FAILED }),
      );
    } finally {
      if (fs.existsSync(value.index))
        move(value, value.index, path.join(value.root, "index-clone.jsonl"));
      move(value, saved, value.index);
    }
    expect(capture(value.ports).snapshot.fileCount).toBe(2);
  });

  it("rejects unindexed files while preserving their bytes", () => {
    const target = path.join(value.files, "orphan.json");
    fs.writeFileSync(target, "unindexed artifact");
    try {
      expect(() => capture(value.ports)).toThrow(
        expect.objectContaining({ code: FAILED }),
      );
      expect(fs.readFileSync(target, "utf8")).toBe("unindexed artifact");
    } finally {
      move(value, target, path.join(value.root, "orphan.json"));
    }
  });

  it("holds unexpected root entries and closes native directory handles", () => {
    const target = path.join(value.dir, "index.jsonl.lock");
    fs.writeFileSync(target, "in-progress");
    const nativeOpen = fs.opendirSync.bind(fs),
      handles = [];
    const spy = vi.spyOn(fs, "opendirSync").mockImplementation((...args) => {
      const handle = nativeOpen(...args);
      handles.push(handle);
      return handle;
    });
    try {
      expect(() => capture(value.ports)).toThrow();
      for (const handle of handles)
        expect(() => handle.readSync()).toThrow(
          expect.objectContaining({ code: "ERR_DIR_CLOSED" }),
        );
      expect(fs.readFileSync(target, "utf8")).toBe("in-progress");
    } finally {
      spy.mockRestore();
      move(value, target, path.join(value.root, "index.jsonl.lock"));
    }
  });

  it("rejects substituted bytes in a real indexed pathname", () => {
    const entry = initial.snapshot.entries[0],
      target = path.join(value.files, entry.file),
      saved = path.join(value.root, "corrupt-original.json");
    move(value, target, saved);
    try {
      fs.writeFileSync(
        target,
        Buffer.alloc(bytesBefore.get(entry.file).length, 0x78),
        { mode: 0o600 },
      );
      expect(() => capture(value.ports)).toThrow(
        expect.objectContaining({ code: FAILED }),
      );
    } finally {
      if (fs.existsSync(target))
        move(value, target, path.join(value.root, "corrupt-copy.json"));
      move(value, saved, target);
    }
  });

  it("rejects hardlinked indexed content", () => {
    const entry = initial.snapshot.entries[0],
      target = path.join(value.files, entry.file),
      link = path.join(value.root, "hardlink.json");
    fs.linkSync(target, link);
    try {
      expect(() => capture(value.ports)).toThrow(
        expect.objectContaining({ code: FAILED }),
      );
    } finally {
      fs.unlinkSync(link);
    }
  });

  it("rejects duplicate index rows and record identities", () => {
    const original = fs.readFileSync(value.index);
    const first = original.toString().trim().split("\n")[0];
    fs.appendFileSync(value.index, `${first}\n`);
    try {
      expect(() => capture(value.ports)).toThrow(
        expect.objectContaining({ code: FAILED }),
      );
    } finally {
      fs.writeFileSync(value.index, original);
    }
  });

  it("rejects an invalid signed lineage without changing other rows or files", () => {
    const original = fs.readFileSync(value.index);
    const rows = original
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const envelope = JSON.parse(rows[0].lineage.envelope);
    envelope.signature.value = "A".repeat(43);
    rows[0].lineage.envelope = rrsiCanonical(envelope);
    rows[0].lineage.envelopeDigest = hash(
      Buffer.from(rows[0].lineage.envelope),
    );
    fs.writeFileSync(value.index, rows.map(rrsiCanonical).join("\n") + "\n");
    try {
      expect(() => capture(value.ports)).toThrow();
    } finally {
      fs.writeFileSync(value.index, original);
    }
  });

  it("rechecks current authority without caching successful prior audits", () => {
    const current = capture(value.ports);
    value.control.revoked.add(publications[0].ref.digest);
    try {
      expect(() => current.recheck()).toThrow();
      expect(() => current.recheck()).toThrow();
    } finally {
      value.control.revoked.clear();
    }
    expect(capture(value.ports).recheck()).toBe(true);
  });

  it("does not serialize transient clock/decision receipts into its identity", () => {
    const before = capture(value.ports).snapshot;
    value.control.now += 1_000;
    try {
      expect(capture(value.ports).snapshot).toEqual(before);
    } finally {
      value.control.now -= 1_000;
    }
  });

  it("detects a later authority callback replacing an earlier file with identical bytes", () => {
    const first = capture(value.ports).snapshot.entries[0];
    const target = path.join(value.files, first.file),
      saved = path.join(value.root, "late-original.json");
    let calls = 0,
      fired = false;
    value.control.onResolve = (request) => {
      if (request.action === "resolve" && ++calls === 2) {
        fired = true;
        move(value, target, saved);
        fs.writeFileSync(target, bytesBefore.get(first.file), { mode: 0o600 });
      }
    };
    try {
      expect(() => capture(value.ports)).toThrow(
        expect.objectContaining({ code: FAILED }),
      );
      expect(fired).toBe(true);
    } finally {
      value.control.onResolve = null;
      if (fired) {
        move(value, target, path.join(value.root, "late-copy.json"));
        move(value, saved, target);
      }
    }
  });

  it("detects actual index publication during an authority callback", () => {
    const dynamic = fixture();
    dynamic.publish({ initial: true });
    let fired = false;
    dynamic.control.onResolve = (request) => {
      if (request.action === "resolve" && !fired) {
        fired = true;
        dynamic.publish({ concurrent: true });
      }
    };
    try {
      expect(() => capture(dynamic.ports)).toThrow(
        expect.objectContaining({ code: FAILED }),
      );
      expect(fired).toBe(true);
    } finally {
      dynamic.control.onResolve = null;
    }
    expect(capture(dynamic.ports).snapshot.fileCount).toBe(2);
  });

  it("enforces all previously checked leases at the end of the scan", () => {
    const timed = fixture();
    timed.publish({ first: true });
    timed.publish({ second: true });
    timed.control.leaseMs = 1_000;
    let calls = 0;
    timed.control.onResolve = (request) => {
      if (request.action === "resolve" && ++calls === 2)
        timed.control.now += 2_000;
    };
    try {
      expect(() => capture(timed.ports)).toThrow(
        expect.objectContaining({ code: EXPIRED }),
      );
      expect(calls).toBe(2);
    } finally {
      timed.control.onResolve = null;
    }
  });

  it("preflights file count and aggregate payload budgets before authority callbacks", () => {
    for (const portOptions of [
      { maximumInventoryFiles: 1 },
      { maximumInventoryBytes: 600 },
    ]) {
      const bounded = fixture({ portOptions });
      bounded.publish({ text: "x".repeat(250) });
      bounded.publish({ text: "y".repeat(250) });
      const calls = bounded.control.calls;
      expect(() => capture(bounded.ports)).toThrow(
        expect.objectContaining({ code: FAILED }),
      );
      expect(bounded.control.calls).toBe(calls);
    }
  });

  it("never calls unbounded whole-file readers during audit", () => {
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("unbounded reader");
    });
    try {
      expect(capture(value.ports).snapshot.fileCount).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps non-default store hooks available without a complete local inventory claim", () => {
    class CustomStore extends ArtifactStore {
      list(...args) {
        return super.list(...args);
      }
    }
    const custom = fixture({ Store: CustomStore });
    const published = custom.publish({ local: true });
    expect(published.receipt.persisted).toBe(true);
    expect(capture(custom.ports)).toBeNull();
  });

  it("rejects mixed unsigned ordinary artifacts rather than silently filtering them out", () => {
    const mixed = fixture();
    mixed.publish({ governed: true });
    mixed.store.publishData({
      data: "ordinary report",
      fileName: "report.txt",
      title: "ordinary",
      kind: "report",
      mime: "text/plain",
    });
    const before = fs.readFileSync(mixed.index);
    expect(() => capture(mixed.ports)).toThrow(
      expect.objectContaining({ code: FAILED }),
    );
    expect(fs.readFileSync(mixed.index)).toEqual(before);
  });

  it("rejects a genuine signed row from another tenant instead of claiming partial coverage", () => {
    const mixed = fixture();
    mixed.publish({ localTenant: true });
    const other = fixture({
      directory: mixed.dir,
      tenantId: "another-audit-tenant",
    });
    other.publish({ foreignTenant: true });
    expect(() => capture(mixed.ports)).toThrow();
    expect(() => capture(other.ports)).toThrow();
    expect(fs.readdirSync(mixed.files)).toHaveLength(2);
  });

  it("enforces signed TTL expiry without cleaning expired rows or files", () => {
    const expiring = fixture();
    expiring.ports.putCanonical(
      "candidate",
      { temporary: true },
      { purpose: "audit-test", retention: "ttl", ttlMs: 1_000 },
    );
    expect(capture(expiring.ports).snapshot.fileCount).toBe(1);
    const indexBytes = fs.readFileSync(expiring.index),
      names = fs.readdirSync(expiring.files);
    expiring.control.now += 2_000;
    expect(() => capture(expiring.ports)).toThrow(
      expect.objectContaining({ code: EXPIRED }),
    );
    expect(fs.readFileSync(expiring.index)).toEqual(indexBytes);
    expect(fs.readdirSync(expiring.files)).toEqual(names);
  });

  it("rejects invalid inventory budgets without widening existing admission limits", () => {
    for (const portOptions of [
      { maximumInventoryFiles: 0 },
      { maximumInventoryFiles: 10_001 },
      { maximumInventoryFiles: Infinity },
      { maximumInventoryBytes: 1 },
      { maximumInventoryBytes: 256 * 1024 * 1024 + 1 },
    ])
      expect(() => fixture({ portOptions })).toThrow(TypeError);
  });

  it("rejects prototype method drift while preserving the original captured directory", () => {
    const current = capture(value.ports);
    const original = Object.getOwnPropertyDescriptor(
      ArtifactStore.prototype,
      "storedPath",
    );
    let calls = 0;
    Object.defineProperty(ArtifactStore.prototype, "storedPath", {
      ...original,
      value() {
        calls++;
        throw new Error("custom path");
      },
    });
    try {
      expect(capture(value.ports)).toBeNull();
      expect(() => current.recheck()).toThrow();
      expect(calls).toBe(0);
    } finally {
      Object.defineProperty(ArtifactStore.prototype, "storedPath", original);
    }
    expect(current.recheck()).toBe(true);
  });

  it("rejects forged/proxy ports and replacement contexts without caller traps", () => {
    let calls = 0;
    const proxy = new Proxy(value.ports, {
      get() {
        calls++;
        throw new Error("trap");
      },
    });
    const revoked = Proxy.revocable(value.ports, {});
    revoked.revoke();
    for (const fake of [{ ...value.ports }, proxy, revoked.proxy, null])
      expect(() => capture(fake)).toThrow(TypeError);
    expect(() => capture(value.ports, {})).toThrow(TypeError);
    expect(() => initial.recheck({})).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it("reopens identical evidence in a fresh process", () => {
    const expected = capture(value.ports).snapshot;
    const storeUrl = new URL("../../src/lib/artifact-store.js", import.meta.url)
      .href;
    const portsUrl = new URL(
      "../../src/lib/evolution/evolution-artifact-ports.js",
      import.meta.url,
    ).href;
    const fixtureUrl = new URL(
      "../fixtures/evolution-durable-store.js",
      import.meta.url,
    ).href;
    const script = `
      import { ArtifactStore } from ${JSON.stringify(storeUrl)};
      import { EvolutionArtifactPorts, captureEvolutionArtifactStoreLocalInventory } from ${JSON.stringify(portsUrl)};
      import { evolutionDurableStoreConfiguration } from ${JSON.stringify(fixtureUrl)};
      const config = evolutionDurableStoreConfiguration(process.argv[1], { artifactTenantId: 'audit-artifacts', audience: 'audit-runtime' });
      const ports = new EvolutionArtifactPorts({ artifactStore: new ArtifactStore({ dir: process.argv[2], now: config.clock }), tenantId: 'audit-artifacts', audience: 'audit-runtime', now: config.clock, ...config.artifactAuthority });
      const audit = captureEvolutionArtifactStoreLocalInventory(ports);
      if (!audit.recheck()) throw new Error('recheck');
      process.stdout.write(JSON.stringify(audit.snapshot));
    `;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script, value.root, value.dir],
      { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    expect(JSON.parse(output)).toEqual(expected);
  }, 30_000);

  it("invalidates a captured inventory after a real publication and preserves all original bytes", () => {
    const before = capture(value.ports);
    value.publish({ after: true });
    expect(() => before.recheck()).toThrow(/changed after capture/u);
    expect(capture(value.ports).snapshot.fileCount).toBe(3);
    for (const [name, bytes] of bytesBefore)
      expect(fs.readFileSync(path.join(value.files, name))).toEqual(bytes);
  });
});
