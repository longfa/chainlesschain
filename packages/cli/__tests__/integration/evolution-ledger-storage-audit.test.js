import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  captureEvolutionLedgerStorageAudit as capture,
  EVOLUTION_LEDGER_STORAGE_AUDIT_SCHEMA as SCHEMA,
  EVOLUTION_LEDGER_STORAGE_AUDIT_HELD_CODE as HELD,
} from "../../src/lib/evolution/evolution-ledger-storage-audit.js";
import {
  captureRrsiObservedTextStorageAudit,
  RRSI_OBSERVED_TEXT_HOLD_CODE,
} from "../../src/lib/evolution/rrsi-observed-text-index.js";
import { captureEvolutionLedgerV2JournalSourceConsistency } from "../../src/lib/evolution/evolution-ledger-v2-journal.js";
import { captureEvolutionArtifactStoreLocalInventory } from "../../src/lib/evolution/evolution-artifact-ports.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
import {
  openObservedTextFixture,
  openObservedTextIndex,
  registerPreparationPlan,
  reservePreparation,
  observationRequest,
} from "../fixtures/rrsi-observed-text.js";
import {
  openLedgerV2Fixture,
  v2FixtureDomainEvent,
} from "../fixtures/evolution-ledger-v2-store.js";

const temp = fs.realpathSync.native(os.tmpdir());
const roots = [];
const originalPorts = {
  originalManifestPorts: true,
  originalWitnessPorts: true,
  originalRetentionPorts: true,
};
function directory() {
  const root = fs.mkdtempSync(path.join(temp, "cc-storage-audit-"));
  roots.push(root);
  return root;
}
const composition = (store) => ({
  backend: store.backend,
  artifactPorts: store.artifactPorts,
  ledgerArtifactResolver: store.resolver,
});
const held = (operation) =>
  expect(operation).toThrow(expect.objectContaining({ code: HELD }));

afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  for (const root of roots) {
    if (
      path.dirname(root) !== temp ||
      !path.basename(root).startsWith("cc-storage-audit-")
    )
      throw new Error("unsafe storage audit cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

describe.sequential("original local storage audit composition", () => {
  let root, value, store, index;
  const revoked = new Set();
  const control = { onResolve: null };
  const proofControl = { revoked: false };
  beforeAll(() => {
    root = directory();
    value = openObservedTextFixture(root, {
      ...originalPorts,
      artifactAuthorityControl: {
        revokedDigests: {
          has(digest) {
            control.onResolve?.();
            return revoked.has(digest);
          },
        },
      },
      retentionProofControl: proofControl,
    });
    store = value.store;
    index = openObservedTextIndex(value);
    registerPreparationPlan(value);
    reservePreparation(value);
    index.registerObservedSkillText(
      observationRequest(value, "\uFEFF# Observed Skill\r\nExact text: 界😀"),
    );
  }, 60_000);

  it("binds the actual source, complete retention and complete artifact inventory to one head", () => {
    const result = capture(composition(store));
    const snapshot = result.snapshot;
    expect(snapshot).toMatchObject({
      schema: SCHEMA,
      tenantId: store.descriptor.tenantId,
      artifactTenantId: store.descriptor.artifactTenantId,
      readOnlyOpen: true,
      recoveryPerformed: false,
      originalCompositionVerified: true,
      localRetentionInventoryVerified: true,
      localArtifactInventoryVerified: true,
      independentInstallationVerified: false,
      crossProcessRollbackProtectionVerified: false,
      atomicSnapshotVerified: false,
      fullPhysicalStorageGraphVerified: false,
      externalWormVerified: false,
      productionAuthorityVerified: false,
      generationProvenanceVerified: false,
      grantsMutationOrPromotionAuthority: false,
      decision: "HOLD",
    });
    expect(snapshot.source).toEqual(
      captureEvolutionLedgerV2JournalSourceConsistency(store.journal).snapshot,
    );
    expect(snapshot.artifacts).toEqual(
      captureEvolutionArtifactStoreLocalInventory(store.artifactPorts).snapshot,
    );
    expect(snapshot.head).toEqual(snapshot.source.manifestHead);
    expect(snapshot.head).toEqual(snapshot.retention.head);
    expect(snapshot.retention.referencedCount).toBeGreaterThan(0);
    expect(snapshot.artifacts.fileCount).toBeGreaterThan(0);
    const { storageAuditDigest, ...core } = snapshot;
    expect(storageAuditDigest).toBe(rrsiHash(SCHEMA, core));
    expect(result.recheck()).toBe(true);
    expect(captureRrsiObservedTextStorageAudit(index).snapshot).toEqual(
      snapshot,
    );
  });

  it("returns frozen data without text, signing ports, or caller-selectable recheck paths", () => {
    const result = capture(composition(store));
    const check = (value) => {
      if (!value || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value)) check(child);
    };
    check(result.snapshot);
    expect(JSON.stringify(result.snapshot)).not.toContain("Exact text:");
    expect(() => result.recheck({ root: directory() })).toThrow(TypeError);
  });

  it("performs no filesystem mutation, permission repair, or write opens during capture and recheck", () => {
    const forbidden = vi.fn((name) => {
      throw new Error(`forbidden storage audit write: ${name}`);
    });
    const writeMethods = [
      "writeFileSync",
      "appendFileSync",
      "renameSync",
      "unlinkSync",
      "rmSync",
      "mkdirSync",
      "chmodSync",
      "fsyncSync",
      "linkSync",
    ];
    for (const name of writeMethods)
      vi.spyOn(fs, name).mockImplementation(() => forbidden(name));
    const open = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation((target, flags, ...args) => {
      const write =
        typeof flags === "string"
          ? /[wa+]/u.test(flags)
          : (flags &
              (fs.constants.O_WRONLY |
                fs.constants.O_RDWR |
                fs.constants.O_CREAT)) !==
            0;
      if (write) forbidden("openSync");
      return open(target, flags, ...args);
    });
    try {
      expect(capture(composition(store)).recheck()).toBe(true);
      expect(captureRrsiObservedTextStorageAudit(index).recheck()).toBe(true);
      expect(forbidden).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("rejects accessors, proxies and extra fields without invoking getters or traps", () => {
    let touched = 0;
    const options = composition(store);
    Object.defineProperty(options, "artifactPorts", {
      enumerable: true,
      get() {
        touched++;
        return store.artifactPorts;
      },
    });
    expect(() => capture(options)).toThrow(TypeError);
    const proxy = new Proxy(composition(store), {
      getPrototypeOf() {
        touched++;
        return Object.prototype;
      },
    });
    expect(() => capture(proxy)).toThrow(TypeError);
    const revokedProxy = Proxy.revocable(composition(store), {});
    revokedProxy.revoke();
    expect(() => capture(revokedProxy.proxy)).toThrow(TypeError);
    expect(() => capture({ ...composition(store), paths: [] })).toThrow(
      TypeError,
    );
    expect(() => capture(composition(store), {})).toThrow(TypeError);
    expect(touched).toBe(0);
  });

  it("rejects copied backends and copied observed indexes", () => {
    expect(() =>
      capture({ ...composition(store), backend: { ...store.backend } }),
    ).toThrow(TypeError);
    for (const fake of [{ ...index }, new Proxy(index, {})])
      expect(() => captureRrsiObservedTextStorageAudit(fake)).toThrow(
        TypeError,
      );
    expect(() => captureRrsiObservedTextStorageAudit(index, {})).toThrow(
      TypeError,
    );
  });

  it("rejects an unexpected file in the full retention directory without deleting it", () => {
    const file = path.join(store.manifest.segmentDirectory, "uncommitted.tmp");
    fs.writeFileSync(file, "keep crash evidence", { flag: "wx" });
    try {
      held(() => capture(composition(store)));
      expect(fs.readFileSync(file, "utf8")).toBe("keep crash evidence");
    } finally {
      fs.unlinkSync(file);
    }
  });

  it("detects missing artifacts while the source and manifest head remain unchanged", () => {
    const prior = capture(composition(store));
    const entry = prior.snapshot.artifacts.entries.find(
      (entry) => entry.type === "rrsi-observed-text-chunk",
    );
    const target = path.join(root, "store", "artifacts", "files", entry.file);
    const saved = path.join(root, "saved-artifact.json");
    fs.renameSync(target, saved);
    try {
      held(() => prior.recheck());
      expect(
        captureEvolutionLedgerV2JournalSourceConsistency(store.journal)
          .snapshot,
      ).toEqual(prior.snapshot.source);
    } finally {
      fs.renameSync(saved, target);
    }
  });

  it("rechecks current artifact and retention authorities on each invocation", () => {
    const prior = capture(composition(store));
    revoked.add(prior.snapshot.artifacts.entries[0].ref.digest);
    try {
      held(() => prior.recheck());
    } finally {
      revoked.clear();
    }
    proofControl.revoked = true;
    try {
      held(() => prior.recheck());
    } finally {
      proofControl.revoked = false;
    }
    expect(capture(composition(store)).recheck()).toBe(true);
  });

  it("includes unreferenced indexed artifacts and invalidates an earlier audit at the same head", () => {
    const prior = capture(composition(store));
    const extra = store.artifactPorts.putCanonical(
      "evolution-ledger-v2-journal",
      { schema: "test-only-unreferenced", value: "not in observed text" },
      { purpose: "evolution-ledger", retention: "ledger" },
    );
    held(() => prior.recheck());
    const current = capture(composition(store)).snapshot;
    expect(current.head).toEqual(prior.snapshot.head);
    expect(
      current.artifacts.entries.some(
        (entry) => entry.ref.ref === extra.ref.ref,
      ),
    ).toBe(true);
    expect(current.artifacts.fileCount).toBe(
      prior.snapshot.artifacts.fileCount + 1,
    );
  });

  it("rejects a changed source head rather than reusing cached successful component checks", () => {
    const prior = capture(composition(store));
    store.journal.appendDomainEvent(
      v2FixtureDomainEvent(store, "audit-new-head"),
    );
    held(() => prior.recheck());
    expect(capture(composition(store)).snapshot.head.sequence).toBeGreaterThan(
      prior.snapshot.head.sequence,
    );
  });

  it("rejects a real retention directory clone made during a later artifact authority callback", () => {
    const original = store.manifest.segmentDirectory;
    const saved = path.join(root, "saved-retention");
    if (!original.startsWith(root + path.sep))
      throw new Error("unsafe clone cleanup");
    let changed = false;
    control.onResolve = () => {
      control.onResolve = null;
      fs.renameSync(original, saved);
      fs.cpSync(saved, original, { recursive: true });
      changed = true;
    };
    try {
      held(() => capture(composition(store)));
      expect(changed).toBe(true);
    } finally {
      control.onResolve = null;
      if (changed) {
        fs.rmSync(original, { recursive: true, force: true });
        fs.renameSync(saved, original);
      }
    }
    expect(
      capture(composition(store)).snapshot.localRetentionInventoryVerified,
    ).toBe(true);
  });

  it("fails through the observed-index HOLD boundary for a broken component", () => {
    const file = path.join(store.manifest.segmentDirectory, "unexpected.tmp");
    fs.writeFileSync(file, "retained failure evidence");
    try {
      expect(() => captureRrsiObservedTextStorageAudit(index)).toThrow(
        expect.objectContaining({ code: RRSI_OBSERVED_TEXT_HOLD_CODE }),
      );
    } finally {
      fs.unlinkSync(file);
    }
  });
});

describe("unsupported storage graphs", () => {
  it("rejects mixing two original compositions with matching scope strings", () => {
    const first = openLedgerV2Fixture(directory(), originalPorts);
    const second = openLedgerV2Fixture(directory(), originalPorts);
    held(() =>
      capture({ ...composition(first), artifactPorts: second.artifactPorts }),
    );
    held(() =>
      capture({
        ...composition(first),
        ledgerArtifactResolver: second.resolver,
      }),
    );
  }, 60_000);

  it("does not upgrade custom manifest wrappers to a physical local audit", () => {
    const custom = openLedgerV2Fixture(directory(), {
      ...originalPorts,
      originalManifestPorts: false,
    });
    held(() => capture(composition(custom)));
  }, 60_000);

  it("leaves an interrupted WAL append untouched and requires explicit recovery", () => {
    const root = directory();
    const store = openLedgerV2Fixture(root, originalPorts);
    const prior = capture(composition(store));
    expect(() =>
      execFileSync(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              "../fixtures/evolution-storage-audit-crash.mjs",
              import.meta.url,
            ),
          ),
          root,
        ],
        { timeout: 15_000, windowsHide: true, stdio: "pipe" },
      ),
    ).toThrow(expect.objectContaining({ status: 23 }));
    const before = fs.readFileSync(
      store.manifest.catalogBackend.descriptor.file,
    );
    held(() => capture(composition(store)));
    expect(
      fs.readFileSync(store.manifest.catalogBackend.descriptor.file),
    ).toEqual(before);
    store.journal.recover();
    expect(capture(composition(store)).snapshot.readOnlyOpen).toBe(true);
    held(() => prior.recheck());
  }, 60_000);
});
