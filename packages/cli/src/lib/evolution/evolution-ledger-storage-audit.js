/** Explicit, read-only composition of the original local v2 storage checks. */
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  captureEvolutionLedgerFileBackend,
  captureEvolutionLedgerFileBackendBinding,
  captureEvolutionLedgerFileBackendSourceDirectoryBoundary,
  captureEvolutionLedgerFileBackendWitnessDirectoryBoundaries,
} from "./evolution-ledger-file-backend.js";
import {
  captureEvolutionLedgerArtifactResolverBinding,
  captureEvolutionArtifactStoreDirectoryBoundary,
  captureEvolutionArtifactStoreLocalInventory,
} from "./evolution-artifact-ports.js";
import {
  isEvolutionLedgerV2Journal,
  captureEvolutionLedgerV2JournalManifestDirectoryBoundaries,
  captureEvolutionLedgerV2JournalWitnessDirectoryBoundaries,
  captureEvolutionLedgerV2JournalRetainedSegmentDirectoryBoundary,
  captureEvolutionLedgerV2JournalLocalRetentionInventory,
  captureEvolutionLedgerV2JournalSourceConsistency,
} from "./evolution-ledger-v2-journal.js";

export const EVOLUTION_LEDGER_STORAGE_AUDIT_SCHEMA =
  "chainlesschain.evolution-local-storage-audit/v1";
export const EVOLUTION_LEDGER_STORAGE_AUDIT_HELD_CODE =
  "CC_EVOLUTION_STORAGE_AUDIT_HELD";

function held(message, cause) {
  throw Object.assign(new Error(message, cause ? { cause } : undefined), {
    code: EVOLUTION_LEDGER_STORAGE_AUDIT_HELD_CODE,
  });
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update(`${EVOLUTION_LEDGER_STORAGE_AUDIT_SCHEMA}\0`)
    .update(canonical(value))
    .digest("hex")}`;
}

function frozen(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

function ports(input) {
  const keys = ["backend", "artifactPorts", "ledgerArtifactResolver"];
  if (
    !input ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== keys.length
  )
    throw new TypeError("storage audit requires exactly three original ports");
  return Object.fromEntries(
    keys.map((key) => {
      const field = Object.getOwnPropertyDescriptor(input, key);
      if (!field?.enumerable || !("value" in field))
        throw new TypeError("storage audit ports must be own data properties");
      return [key, field.value];
    }),
  );
}

/**
 * No caller paths, inventory filters, recovery, installation or trust defaults.
 * Separate component read windows do not constitute an atomic disk snapshot.
 */
export function captureEvolutionLedgerStorageAudit(input) {
  if (arguments.length !== 1)
    throw new TypeError("storage audit takes one original composition");
  const options = ports(input);
  const backend = captureEvolutionLedgerFileBackend(options.backend);
  const binding = captureEvolutionLedgerFileBackendBinding(backend);
  const resolver = captureEvolutionLedgerArtifactResolverBinding(
    options.ledgerArtifactResolver,
  );
  const journal = backend.ledger;
  if (
    !binding.matchesArtifactResolver(options.ledgerArtifactResolver) ||
    !resolver.matchesArtifactPorts(options.artifactPorts)
  )
    held("storage audit requires the same original backend and artifact ports");
  if (!isEvolutionLedgerV2Journal(journal))
    held("storage audit requires an original v2 journal");
  if (
    resolver.tenantId !== journal.descriptor.artifactTenantId ||
    resolver.audience !== journal.descriptor.audience ||
    resolver.purpose !== "evolution-ledger"
  )
    held("storage audit artifact scope differs from the original journal");

  function capture() {
    const sourceBoundary =
      captureEvolutionLedgerFileBackendSourceDirectoryBoundary(backend);
    const sourceWitnessBoundary =
      captureEvolutionLedgerFileBackendWitnessDirectoryBoundaries(backend);
    const manifestBoundaries =
      captureEvolutionLedgerV2JournalManifestDirectoryBoundaries(journal);
    const manifestWitnessBoundary =
      captureEvolutionLedgerV2JournalWitnessDirectoryBoundaries(journal);
    const retentionBoundary =
      captureEvolutionLedgerV2JournalRetainedSegmentDirectoryBoundary(journal);
    const artifactBoundary = captureEvolutionArtifactStoreDirectoryBoundary(
      options.artifactPorts,
    );
    if (!manifestBoundaries || !manifestWitnessBoundary || !retentionBoundary)
      held(
        "storage audit requires original physical manifest and retention ports",
      );

    const boundaries = [
      sourceBoundary,
      sourceWitnessBoundary,
      manifestBoundaries.catalog,
      manifestBoundaries.head,
      manifestWitnessBoundary,
      retentionBoundary,
      artifactBoundary,
    ];
    const recheckDirectories = () => {
      for (const boundary of boundaries) boundary.recheck();
    };
    recheckDirectories();
    // These explicit readers never call journal.verify()/recover(), take a
    // source lock, advance a witness or finalize an outstanding WAL suffix.
    const source = captureEvolutionLedgerV2JournalSourceConsistency(journal);
    if (source === null)
      held("storage audit requires a finalized read-only source/v2 history");
    const retention =
      captureEvolutionLedgerV2JournalLocalRetentionInventory(journal);
    const artifacts = captureEvolutionArtifactStoreLocalInventory(
      options.artifactPorts,
    );
    if (retention === null || artifacts === null)
      held("storage audit cannot substitute custom or incomplete inventories");

    const head = source.snapshot.manifestHead;
    if (
      canonical(head) !== canonical(retention.snapshot.head) ||
      artifacts.snapshot.tenantId !== journal.descriptor.artifactTenantId ||
      artifacts.snapshot.audience !== journal.descriptor.audience
    )
      held("storage audit components do not share one journal head and scope");

    // Re-read all three components rather than trusting their reported hashes.
    // Retention includes unreferenced files; artifacts includes the full index.
    source.recheck();
    retention.recheck();
    artifacts.recheck();
    recheckDirectories();
    const core = frozen({
      schema: EVOLUTION_LEDGER_STORAGE_AUDIT_SCHEMA,
      scope: "original-v2-source-witnesses-local-retention-and-artifact-store",
      tenantId: journal.descriptor.tenantId,
      artifactTenantId: journal.descriptor.artifactTenantId,
      audience: journal.descriptor.audience,
      head,
      directories: {
        source: sourceBoundary.descriptor,
        sourceWitness: sourceWitnessBoundary.descriptor,
        manifestCatalog: manifestBoundaries.catalog.descriptor,
        manifestHead: manifestBoundaries.head.descriptor,
        manifestWitness: manifestWitnessBoundary.descriptor,
        retention: retentionBoundary.descriptor,
        artifacts: artifactBoundary.descriptor,
      },
      source: source.snapshot,
      retention: retention.snapshot,
      artifacts: artifacts.snapshot,
      readOnlyOpen: true,
      recoveryPerformed: false,
      originalCompositionVerified: true,
      sourceEventsExactlyMirrored: true,
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
    return frozen({ ...core, storageAuditDigest: digest(core) });
  }

  function guardedCapture() {
    try {
      return capture();
    } catch (cause) {
      if (cause?.code === EVOLUTION_LEDGER_STORAGE_AUDIT_HELD_CODE) throw cause;
      held("original local storage audit could not be authenticated", cause);
    }
  }
  const snapshot = guardedCapture();
  return Object.freeze({
    snapshot,
    recheck(...args) {
      if (args.length)
        throw new TypeError("storage audit takes no replacement context");
      if (guardedCapture().storageAuditDigest !== snapshot.storageAuditDigest)
        held("original local storage changed after audit capture");
      return true;
    },
  });
}
