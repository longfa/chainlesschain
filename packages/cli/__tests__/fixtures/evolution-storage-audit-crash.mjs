// TEST ONLY: interrupt the actual source writer before its JS catch/finally.
import {
  openLedgerV2Fixture,
  v2FixtureDomainEvent,
} from "./evolution-ledger-v2-store.js";

const store = openLedgerV2Fixture(process.argv[2], {
  originalManifestPorts: true,
  originalWitnessPorts: true,
  originalRetentionPorts: true,
  crashHook(phase) {
    if (phase === "after-segment") process.exit(23);
  },
});
store.journal.appendDomainEvent(
  v2FixtureDomainEvent(store, "interrupted-audit-event"),
);
throw new Error("fixture did not interrupt the original source append");
