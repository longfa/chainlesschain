import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  captureEvolutionLedgerMigrationSource,
  getEvolutionLedgerReadOnlyHistoryReader as sourceReader,
  EVOLUTION_LEDGER_READ_ONLY_HELD_CODE as SOURCE_HELD,
} from "../../src/lib/evolution/evolution-ledger.js";
import {
  createEvolutionLedgerV2Journal,
  captureEvolutionLedgerV2JournalSourceConsistency as capture,
  EVOLUTION_LEDGER_V2_SOURCE_AUDIT_HELD_CODE as HELD,
} from "../../src/lib/evolution/evolution-ledger-v2-journal.js";
import { getEvolutionLedgerV2ReadOnlyEventsReader as manifestReader } from "../../src/lib/evolution/evolution-ledger-v2-manifest-backend.js";
import { createLocalUiEvolutionFileSystem } from "../../src/lib/evolution/evolution-windows-directory-durability.js";
import { openEvolutionDurableStore } from "../fixtures/evolution-durable-store.js";
import {
  createLedgerV2FixtureBackend,
  V2_FIXTURE_RETENTION,
  v2FixtureDomainEvent,
} from "../fixtures/evolution-ledger-v2-store.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";

const temp = fs.realpathSync.native(os.tmpdir());
const roots = [];
const nativeOps = Object.fromEntries(
  [
    "writeFileSync",
    "renameSync",
    "unlinkSync",
    "rmSync",
    "mkdirSync",
    "fsyncSync",
    "linkSync",
    "chmodSync",
    "openSync",
    "readSync",
  ].map((name) => [name, fs[name]]),
);
afterEach(() => vi.restoreAllMocks());
function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(temp, "cc-readonly-source-"));
  roots.push(root);
  const control = {
    forbidMutation: false,
    mutations: 0,
    crashAt: null,
    onRead: null,
  };
  const paths = new Map();
  const base = createLocalUiEvolutionFileSystem();
  const io = base;
  for (const name of [
    "writeFileSync",
    "renameSync",
    "unlinkSync",
    "rmSync",
    "mkdirSync",
    "fsyncSync",
    "linkSync",
    "chmodSync",
  ]) {
    const native = nativeOps[name];
    vi.spyOn(fs, name).mockImplementation((...args) => {
      if (control.forbidMutation) {
        control.mutations++;
        throw new Error(`forbidden ${name}`);
      }
      return Reflect.apply(native, fs, args);
    });
  }
  const nativeOpen = nativeOps.openSync;
  vi.spyOn(fs, "openSync").mockImplementation((target, flags, ...args) => {
    const write =
      typeof flags === "string"
        ? /[wa+]/u.test(flags)
        : (flags &
            (fs.constants.O_WRONLY |
              fs.constants.O_RDWR |
              fs.constants.O_CREAT)) !==
          0;
    if (control.forbidMutation && write) {
      control.mutations++;
      throw new Error("forbidden write open");
    }
    const descriptor = nativeOpen(target, flags, ...args);
    paths.set(descriptor, target);
    return descriptor;
  });
  vi.spyOn(fs, "readSync").mockImplementation((...args) => {
    const count = nativeOps.readSync(...args);
    control.onRead?.(paths.get(args[0]), count);
    return count;
  });
  const source = openEvolutionDurableStore(root, {
    tenantId: "source-audit-tenant",
    artifactTenantId: "source-audit-artifacts",
    audience: "source-audit-runtime",
    fsImpl: io,
    crashHook: (phase) => {
      if (phase === control.crashAt) throw new Error(`crash:${phase}`);
    },
  });
  const manifest = createLedgerV2FixtureBackend(
    root,
    {
      authority: source.backend.ledger.verify(),
      descriptor: source.descriptor,
    },
    {
      originalManifestPorts: true,
      originalWitnessPorts: true,
      originalRetentionPorts: true,
      ...options,
    },
  );
  const journal = createEvolutionLedgerV2Journal({
    sourceLedger: source.backend.ledger,
    backend: manifest.backend,
    artifactPorts: source.artifactPorts,
    descriptor: {
      tenantId: source.descriptor.tenantId,
      artifactTenantId: source.descriptor.artifactTenantId,
      audience: source.descriptor.audience,
    },
    minimumRetainedUntil: V2_FIXTURE_RETENTION,
  });
  return {
    root,
    control,
    source,
    manifest,
    journal,
    ledger: source.backend.ledger,
    writer: captureEvolutionLedgerMigrationSource(source.backend.ledger),
  };
}
function move(value, from, to) {
  for (const target of [from, to])
    if (!path.resolve(target).startsWith(value.root + path.sep))
      throw new Error("unsafe source fixture move");
  fs.renameSync(from, to);
}
afterAll(() => {
  vi.restoreAllMocks();
  for (const root of roots) {
    if (
      path.dirname(root) !== temp ||
      !path.basename(root).startsWith("cc-readonly-source-")
    )
      throw new Error("unsafe source audit cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

describe("cold read-only source and v2 consistency", () => {
  it("authenticates complete source events without any source mutation or permission repair", () => {
    const value = fixture();
    const read = sourceReader(value.ledger);
    value.control.forbidMutation = true;
    try {
      const snapshot = read();
      expect(snapshot.events).toHaveLength(snapshot.frontier.sequence);
      expect(snapshot).toMatchObject({
        readOnlyOpen: true,
        recoveryPerformed: false,
        fullPhysicalStorageGraphVerified: false,
      });
      expect(read()).toEqual(snapshot);
      const consistency = capture(value.journal);
      expect(consistency.snapshot).toMatchObject({
        sourceEventsExactlyMirrored: true,
        recoveryPerformed: false,
        readOnlyOpen: true,
        eventCount: snapshot.events.length,
        artifactCurrentAuthorityVerified: false,
        fullPhysicalStorageGraphVerified: false,
      });
      expect(consistency.recheck()).toBe(true);
      expect(value.control.mutations).toBe(0);
    } finally {
      value.control.forbidMutation = false;
    }
  }, 60_000);

  it("binds every event's full payload to both source and retained v2 bytes", () => {
    const value = fixture();
    value.journal.appendDomainEvent(
      v2FixtureDomainEvent(value.source, "exact-payload"),
    );
    const source = sourceReader(value.ledger)(),
      manifest = manifestReader(value.manifest.backend)();
    expect(manifest.events).toEqual(source.events);
    const result = capture(value.journal).snapshot;
    expect(result.eventCount).toBe(3);
    expect(result.sourceFrontier.headDigest).toBe(manifest.head.eventDigest);
    const { consistencyDigest, ...core } = result;
    expect(consistencyDigest).toBe(rrsiHash(core.schema, core));
    expect(JSON.stringify(result)).not.toContain("payload:exact-payload");
  }, 60_000);

  it("holds a real committed WAL suffix without copying it into v2, then permits explicit recovery", () => {
    const value = fixture();
    const before = capture(value.journal);
    const manifestBytes = fs.readFileSync(
      value.manifest.catalogBackend.descriptor.file,
    );
    value.writer.appendDomainEvent(
      v2FixtureDomainEvent(value.source, "wal-only"),
    );
    value.control.forbidMutation = true;
    try {
      expect(sourceReader(value.ledger)().frontier.sequence).toBe(3);
      expect(() => capture(value.journal)).toThrow(
        expect.objectContaining({ code: HELD }),
      );
      expect(
        fs.readFileSync(value.manifest.catalogBackend.descriptor.file),
      ).toEqual(manifestBytes);
      expect(value.control.mutations).toBe(0);
    } finally {
      value.control.forbidMutation = false;
    }
    value.journal.recover();
    expect(capture(value.journal).snapshot.eventCount).toBe(3);
    expect(() => before.recheck()).toThrow(/changed after capture/u);
  }, 60_000);

  it.each(["after-segment", "after-anchor", "after-witness"])(
    "does not recover or delete an interrupted source append at %s",
    (phase) => {
      const value = fixture();
      const event = v2FixtureDomainEvent(value.source, `interrupted-${phase}`);
      const initialHead = fs.readFileSync(value.ledger.headPath);
      value.control.crashAt = phase;
      expect(() => value.writer.appendDomainEvent(event)).toThrow();
      value.control.crashAt = null;
      const segments = fs.readdirSync(value.ledger.segmentDir),
        anchors = fs.readdirSync(value.ledger.anchorDir);
      const bytes = new Map(
        segments.map((name) => [
          name,
          fs.readFileSync(path.join(value.ledger.segmentDir, name)),
        ]),
      );
      value.control.forbidMutation = true;
      try {
        expect(() => sourceReader(value.ledger)()).toThrow(
          expect.objectContaining({ code: SOURCE_HELD }),
        );
        expect(() => capture(value.journal)).toThrow();
        expect(value.control.mutations).toBe(0);
        expect(fs.readdirSync(value.ledger.segmentDir)).toEqual(segments);
        expect(fs.readdirSync(value.ledger.anchorDir)).toEqual(anchors);
        expect(fs.readFileSync(value.ledger.headPath)).toEqual(initialHead);
        for (const [name, stored] of bytes)
          expect(
            fs.readFileSync(path.join(value.ledger.segmentDir, name)),
          ).toEqual(stored);
      } finally {
        value.control.forbidMutation = false;
      }
      value.journal.recover();
      expect(capture(value.journal).recheck()).toBe(true);
    },
    60_000,
  );

  it("leaves actual staging debris in place instead of invoking cleanup", () => {
    const value = fixture();
    const debris = path.join(
      value.ledger.segmentDir,
      ".stage-observed.0123456789abcdef.tmp",
    );
    fs.writeFileSync(debris, "incomplete");
    try {
      value.control.forbidMutation = true;
      expect(() => sourceReader(value.ledger)()).toThrow(
        expect.objectContaining({ code: SOURCE_HELD }),
      );
      expect(fs.readFileSync(debris, "utf8")).toBe("incomplete");
      expect(value.control.mutations).toBe(0);
    } finally {
      value.control.forbidMutation = false;
      move(value, debris, path.join(value.root, "preserved-debris.tmp"));
    }
    expect(capture(value.journal).recheck()).toBe(true);
  }, 60_000);

  it("does not recreate a missing source HEAD", () => {
    const value = fixture(),
      saved = path.join(value.root, "saved-head.json");
    move(value, value.ledger.headPath, saved);
    value.control.forbidMutation = true;
    try {
      expect(() => sourceReader(value.ledger)()).toThrow();
      expect(fs.existsSync(value.ledger.headPath)).toBe(false);
      expect(value.control.mutations).toBe(0);
    } finally {
      value.control.forbidMutation = false;
      move(value, saved, value.ledger.headPath);
    }
  }, 60_000);

  it("rejects an earlier source file changed during a later descriptor read", () => {
    const value = fixture();
    const names = fs.readdirSync(value.ledger.segmentDir).sort();
    expect(names).toHaveLength(2);
    const first = path.join(value.ledger.segmentDir, names[0]),
      second = path.join(value.ledger.segmentDir, names[1]);
    const bytes = fs.readFileSync(first),
      saved = path.join(value.root, "earlier-original.json");
    let fired = false;
    value.control.onRead = (target, count) => {
      if (!fired && count > 0 && target === second) {
        fired = true;
        nativeOps.renameSync(first, saved);
        nativeOps.writeFileSync(first, bytes, { mode: 0o600 });
      }
    };
    try {
      expect(() => sourceReader(value.ledger)()).toThrow(
        expect.objectContaining({ code: SOURCE_HELD }),
      );
      expect(fired).toBe(true);
      expect(fs.readFileSync(first)).toEqual(bytes);
    } finally {
      value.control.onRead = null;
      if (fired) {
        move(value, first, path.join(value.root, "earlier-clone.json"));
        move(value, saved, first);
      }
    }
    expect(capture(value.journal).recheck()).toBe(true);
  }, 60_000);

  it("does not synthesize a source witness when its existing file is missing", () => {
    const value = fixture(),
      target = value.source.backend.descriptor.witnessFilePath,
      saved = path.join(value.root, "source-witness.json");
    move(value, target, saved);
    value.control.forbidMutation = true;
    try {
      expect(() => sourceReader(value.ledger)()).toThrow();
      expect(fs.existsSync(target)).toBe(false);
      expect(value.control.mutations).toBe(0);
    } finally {
      value.control.forbidMutation = false;
      move(value, saved, target);
    }
  }, 60_000);

  it("holds missing manifest witness bytes without creating an absent proof", () => {
    const value = fixture();
    const witnessFile = path.join(
        value.manifest.storage,
        "witness",
        "checkpoint.json",
      ),
      saved = path.join(value.root, "manifest-witness.json");
    move(value, witnessFile, saved);
    try {
      expect(() => capture(value.journal)).toThrow();
      expect(fs.existsSync(witnessFile)).toBe(false);
    } finally {
      move(value, saved, witnessFile);
    }
    expect(capture(value.journal).recheck()).toBe(true);
  }, 60_000);

  it("keeps wrapped/custom manifest components unclaimed", () => {
    const value = fixture({ originalManifestPorts: false });
    expect(capture(value.journal)).toBeNull();
    expect(sourceReader(value.ledger)().frontier.sequence).toBe(2);
  }, 60_000);

  it("rejects copied/proxy sources and replacement contexts before caller traps", () => {
    const value = fixture();
    let calls = 0;
    const proxy = new Proxy(value.ledger, {
      get() {
        calls++;
        throw new Error("trap");
      },
    });
    expect(sourceReader(proxy)).toBeNull();
    expect(sourceReader({ ...value.ledger })).toBeNull();
    expect(() => sourceReader(value.ledger, {})).toThrow(TypeError);
    expect(() => sourceReader(value.ledger)({})).toThrow(TypeError);
    expect(() => capture({ ...value.journal })).toThrow(TypeError);
    expect(() => capture(value.journal, {})).toThrow(TypeError);
    expect(() => capture(value.journal).recheck({})).toThrow(TypeError);
    expect(calls).toBe(0);
  }, 60_000);

  it("reopens the same consistency frontier in an independent process", () => {
    const value = fixture(),
      expected = capture(value.journal).snapshot;
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
      import { captureEvolutionLedgerV2JournalSourceConsistency } from ${JSON.stringify(journalUrl)};
      const value = openLedgerV2Fixture(process.argv[1], { tenantId: 'source-audit-tenant', artifactTenantId: 'source-audit-artifacts', audience: 'source-audit-runtime', originalManifestPorts: true, originalWitnessPorts: true, originalRetentionPorts: true });
      const audit = captureEvolutionLedgerV2JournalSourceConsistency(value.journal);
      if (!audit.recheck()) throw new Error('recheck');
      process.stdout.write(JSON.stringify(audit.snapshot));
    `;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script, value.root],
      { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    expect(JSON.parse(output)).toEqual(expected);
  }, 30_000);
});
