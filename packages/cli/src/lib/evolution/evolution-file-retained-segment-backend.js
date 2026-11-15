/** Local replica reads; external retention proofs remain independently verified. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { artifactPhysicalIdentity } from "./evolution-artifact-identity.js";
import {
  createEvolutionPhysicalStateReader,
  captureEvolutionPhysicalStateReaderDirectoryBoundary,
} from "./evolution-physical-state-reader.js";

export const EVOLUTION_RETAINED_SEGMENT_STATE_READ_FAILED_CODE =
  "CC_EVOLUTION_RETAINED_SEGMENT_STATE_READ_FAILED";
const BOUNDARIES = new WeakMap();
const SCANNERS = new WeakMap();
const MAXIMUM_BYTES = 90 * 1024 * 1024;
const MAXIMUM_SEGMENT_BYTES = 64 * 1024 * 1024;
export const EVOLUTION_RETAINED_FILE_INVENTORY_LIMITS = Object.freeze({
  maximumFiles: 4096,
  maximumEncodedBytes: 256 * 1024 * 1024,
});
const FILE_FIELDS = [
  "dev",
  "ino",
  "mode",
  "uid",
  "gid",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
];

/**
 * Open an EXISTING canonical directory. No initialization, permission repair,
 * signing or WORM claims. The explicit retain callback owns publication and its
 * external proof; the enclosing immutable segment port verifies that proof.
 * Files contain { bytes: canonical base64, proof } under <segmentRef hex>.json.
 */
export function createEvolutionFileRetainedSegmentBackend({
  directoryPath,
  retain,
  fsImpl = fs,
  maximumBytes = MAXIMUM_BYTES,
  maximumInventoryFiles = EVOLUTION_RETAINED_FILE_INVENTORY_LIMITS.maximumFiles,
  maximumInventoryBytes = EVOLUTION_RETAINED_FILE_INVENTORY_LIMITS.maximumEncodedBytes,
} = {}) {
  if (typeof retain !== "function")
    throw new TypeError("an explicit retained segment publisher is required");
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 2 ||
    maximumBytes > MAXIMUM_BYTES
  )
    throw new TypeError(
      "retained segment maximumBytes must be between 2 and 90 MiB",
    );
  if (
    !Number.isSafeInteger(maximumInventoryFiles) ||
    maximumInventoryFiles < 1 ||
    maximumInventoryFiles >
      EVOLUTION_RETAINED_FILE_INVENTORY_LIMITS.maximumFiles ||
    !Number.isSafeInteger(maximumInventoryBytes) ||
    maximumInventoryBytes < 2 ||
    maximumInventoryBytes >
      EVOLUTION_RETAINED_FILE_INVENTORY_LIMITS.maximumEncodedBytes
  )
    throw new TypeError("retained file inventory limits are invalid");
  const reader = createEvolutionPhysicalStateReader({
    directoryPath,
    fsImpl,
    maximumBytes,
    minimumBytes: 2,
    directoryMode: process.platform === "win32" ? null : 0o700n,
    label: "retained segment",
    errorCode: EVOLUTION_RETAINED_SEGMENT_STATE_READ_FAILED_CODE,
  });
  const fail = (message, cause) => {
    throw Object.assign(new Error(message, cause ? { cause } : undefined), {
      code: EVOLUTION_RETAINED_SEGMENT_STATE_READ_FAILED_CODE,
    });
  };
  const readResolution = (
    segmentRef,
    byteLimit = maximumBytes,
    collectEvidence = false,
  ) => {
    const bytes = reader.read(
      path.join(directoryPath, `${segmentRef.slice(7)}.json`),
      { maximumBytes: byteLimit },
    );
    let stored;
    try {
      stored = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch (cause) {
      fail("retained segment is not valid UTF-8 JSON", cause);
    }
    if (
      !stored ||
      typeof stored !== "object" ||
      Array.isArray(stored) ||
      Object.keys(stored).length !== 2 ||
      !Object.hasOwn(stored, "bytes") ||
      !Object.hasOwn(stored, "proof") ||
      typeof stored.bytes !== "string" ||
      stored.bytes.length > 4 * Math.ceil(MAXIMUM_SEGMENT_BYTES / 3)
    )
      fail("retained segment state fields or encoded size are invalid");
    const content = Buffer.from(stored.bytes, "base64");
    if (
      content.length === 0 ||
      content.length > MAXIMUM_SEGMENT_BYTES ||
      content.toString("base64") !== stored.bytes
    )
      fail("retained segment bytes must be nonempty canonical base64");
    reader.recheck();
    return {
      encodedBytes: bytes.length,
      encodedDigest: collectEvidence
        ? `sha256:${createHash("sha256").update(bytes).digest("hex")}`
        : null,
      resolution: {
        schema:
          "chainlesschain.evolution-immutable-ledger-segment-resolution/v1",
        found: true,
        bytes: content,
        proof: stored.proof,
      },
    };
  };
  const backend = Object.freeze({
    retain(request) {
      reader.recheck();
      const proof = Reflect.apply(retain, undefined, [request]);
      reader.recheck();
      return proof;
    },
    resolve(request) {
      if (!/^sha256:[a-f0-9]{64}$/u.test(request?.segmentRef || ""))
        throw new TypeError("retained segment reference must be sha256-bound");
      return readResolution(request.segmentRef).resolution;
    },
  });
  BOUNDARIES.set(backend, reader);
  SCANNERS.set(backend, (consume) => {
    if (typeof consume !== "function" || types.isProxy(consume))
      throw new TypeError(
        "a synchronous retained file inventory consumer is required",
      );
    try {
      reader.recheck();
      const list = () => {
        const handle = fsImpl.opendirSync(directoryPath);
        const names = new Set();
        try {
          let entry;
          while ((entry = handle.readSync()) !== null) {
            if (
              !/^[a-f0-9]{64}\.json$/u.test(entry.name) ||
              names.has(entry.name)
            )
              fail(
                "retained file inventory has an unknown or duplicate filename",
              );
            names.add(entry.name);
            if (names.size > maximumInventoryFiles)
              fail("retained file inventory exceeds file limit");
          }
        } finally {
          handle.closeSync();
        }
        return [...names].sort();
      };
      const identity = (name) => {
        const stat = fsImpl.lstatSync(path.join(directoryPath, name), {
          bigint: true,
        });
        if (
          FILE_FIELDS.some((field) => typeof stat[field] !== "bigint") ||
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1n
        )
          fail(
            "retained inventory leaf requires full-precision single-link identity",
          );
        return Object.freeze({
          ...Object.fromEntries(
            FILE_FIELDS.map((field) => [field, String(stat[field])]),
          ),
          birthtimeMs: artifactPhysicalIdentity(stat).birthtimeMs,
        });
      };
      const same = (left, right) =>
        Object.keys(left).every((key) => left[key] === right[key]);
      const names = list();
      let remaining = maximumInventoryBytes;
      let totalEncodedBytes = 0;
      const pins = [];
      const entries = [];
      for (const name of names) {
        const before = identity(name);
        const segmentRef = `sha256:${name.slice(0, -5)}`;
        const observed = readResolution(
          segmentRef,
          Math.min(maximumBytes, Math.max(0, remaining - 1)),
          true,
        );
        // Reserve one EOF probe byte per file in the aggregate read budget.
        remaining -= observed.encodedBytes + 1;
        totalEncodedBytes += observed.encodedBytes;
        const evidence = Object.freeze({
          name,
          segmentRef,
          identity: before,
          encodedBytes: observed.encodedBytes,
          encodedDigest: observed.encodedDigest,
        });
        const result = consume(observed.resolution, evidence);
        if (types.isPromise(result))
          fail("retained inventory consumer must be synchronous");
        if (!same(before, identity(name)))
          fail("retained inventory file changed during scan");
        pins.push(evidence);
        entries.push(result);
      }
      const recheckMetadata = (...args) => {
        if (args.length)
          throw new TypeError(
            "retained inventory physical snapshot takes no replacement context",
          );
        try {
          reader.recheck();
          if (JSON.stringify(list()) !== JSON.stringify(names))
            fail("retained directory inventory changed during scan");
          for (const pin of pins)
            if (!same(pin.identity, identity(pin.name)))
              fail("retained inventory file changed before scan release");
          reader.recheck();
          return true;
        } catch (cause) {
          if (cause?.code === EVOLUTION_RETAINED_SEGMENT_STATE_READ_FAILED_CODE)
            throw cause;
          fail("retained inventory physical snapshot read failed", cause);
        }
      };
      recheckMetadata();
      return Object.freeze({
        directory:
          captureEvolutionPhysicalStateReaderDirectoryBoundary(reader)
            .descriptor,
        entries: Object.freeze(entries),
        totalEncodedBytes,
        maximumFiles: maximumInventoryFiles,
        maximumEncodedBytes: maximumInventoryBytes,
        recheckMetadata: Object.freeze(recheckMetadata),
      });
    } catch (cause) {
      if (cause?.code === EVOLUTION_RETAINED_SEGMENT_STATE_READ_FAILED_CODE)
        throw cause;
      fail("retained directory inventory read failed", cause);
    }
  });
  return backend;
}

/** Ownership probes do not inspect caller properties or execute caller code. */
export function hasEvolutionFileRetainedSegmentDirectoryBoundary(value) {
  return BOUNDARIES.has(value);
}

export function captureEvolutionFileRetainedSegmentDirectoryBoundary(value) {
  if (arguments.length !== 1 || !BOUNDARIES.has(value))
    throw new TypeError(
      "one original file retained segment backend is required",
    );
  return captureEvolutionPhysicalStateReaderDirectoryBoundary(
    BOUNDARIES.get(value),
  );
}

/** Raw scan only. The immutable store must independently authenticate each proof. */
export function captureEvolutionFileRetainedSegmentScanner(value) {
  if (arguments.length !== 1 || !SCANNERS.has(value))
    throw new TypeError(
      "one original file retained segment backend is required",
    );
  return SCANNERS.get(value);
}
