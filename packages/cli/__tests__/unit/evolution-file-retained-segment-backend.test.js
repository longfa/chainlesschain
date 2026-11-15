import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEvolutionFileRetainedSegmentBackend as create,
  captureEvolutionFileRetainedSegmentDirectoryBoundary as capture,
  hasEvolutionFileRetainedSegmentDirectoryBoundary as has,
  captureEvolutionFileRetainedSegmentScanner as scanner,
  EVOLUTION_RETAINED_SEGMENT_STATE_READ_FAILED_CODE as FAILED,
} from "../../src/lib/evolution/evolution-file-retained-segment-backend.js";

const temp = fs.realpathSync.native(os.tmpdir());
const reference = `sha256:${"a".repeat(64)}`;
const roots = [];
function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(temp, "cc-retained-segment-"));
  roots.push(root);
  const directoryPath = path.join(root, "segments");
  fs.mkdirSync(directoryPath, { mode: 0o700 });
  const file = path.join(directoryPath, `${reference.slice(7)}.json`);
  const content = Buffer.from("retained UTF-8 文本\r\n");
  const proof = { external: "opaque: validated by immutable segment port" };
  const serialized = JSON.stringify({
    bytes: content.toString("base64"),
    proof,
  });
  fs.writeFileSync(file, serialized, { mode: 0o600 });
  const retain = vi.fn(() => proof);
  const backend = create({ directoryPath, retain, ...options });
  return {
    root,
    directoryPath,
    file,
    content,
    proof,
    serialized,
    retain,
    backend,
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== temp ||
      !path.basename(root).startsWith("cc-retained-segment-")
    )
      throw new Error("unsafe retained segment cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("bounded existing retained segment replica", () => {
  it("scans the complete existing directory and closes its enumeration handle", () => {
    const value = fixture();
    const openDirectory = fs.opendirSync.bind(fs);
    const handles = [];
    vi.spyOn(fs, "opendirSync").mockImplementation((...args) => {
      const handle = openDirectory(...args);
      handles.push(handle);
      return handle;
    });
    const observed = scanner(value.backend)((resolution, evidence) => {
      expect(resolution.bytes).toEqual(value.content);
      return evidence;
    });
    expect(observed.entries).toHaveLength(1);
    expect(observed.totalEncodedBytes).toBe(
      Buffer.byteLength(value.serialized),
    );
    expect(observed.entries[0]).toMatchObject({
      segmentRef: reference,
      encodedBytes: observed.totalEncodedBytes,
    });
    expect(observed.recheckMetadata()).toBe(true);
    for (const handle of handles)
      expect(() => handle.readSync()).toThrow(
        expect.objectContaining({ code: "ERR_DIR_CLOSED" }),
      );
  });

  it("rejects unknown names before content reads and still closes directory handles", () => {
    const value = fixture();
    fs.writeFileSync(
      path.join(value.directoryPath, "uncommitted.tmp"),
      "temporary",
    );
    const openDirectory = fs.opendirSync.bind(fs);
    const handles = [];
    vi.spyOn(fs, "opendirSync").mockImplementation((...args) => {
      const handle = openDirectory(...args);
      handles.push(handle);
      return handle;
    });
    const read = vi.spyOn(fs, "readSync");
    expect(() => scanner(value.backend)(() => null)).toThrow(
      /unknown or duplicate filename/u,
    );
    expect(read).not.toHaveBeenCalled();
    for (const handle of handles)
      expect(() => handle.readSync()).toThrow(
        expect.objectContaining({ code: "ERR_DIR_CLOSED" }),
      );
  });

  it("bounds file cardinality before opening any payload", () => {
    const value = fixture({ maximumInventoryFiles: 1 });
    fs.writeFileSync(
      path.join(value.directoryPath, `${"b".repeat(64)}.json`),
      value.serialized,
    );
    const read = vi.spyOn(fs, "readSync");
    expect(() => scanner(value.backend)(() => null)).toThrow(/file limit/u);
    expect(read).not.toHaveBeenCalled();
  });

  it("does not reset the aggregate byte budget for later files", () => {
    const value = fixture();
    const second = path.join(value.directoryPath, `${"b".repeat(64)}.json`);
    fs.writeFileSync(second, value.serialized);
    const backend = create({
      directoryPath: value.directoryPath,
      retain() {},
      maximumInventoryBytes: Buffer.byteLength(value.serialized) + 1,
    });
    const nativeRead = fs.readSync.bind(fs);
    const actualReads = [];
    vi.spyOn(fs, "readSync").mockImplementation((...args) => {
      const count = nativeRead(...args);
      actualReads.push(count);
      return count;
    });
    let consumed = 0;
    expect(() =>
      scanner(backend)(() => {
        consumed++;
      }),
    ).toThrow(expect.objectContaining({ code: FAILED }));
    expect(consumed).toBe(1);
    expect(actualReads.reduce((sum, count) => sum + count, 0)).toBe(
      Buffer.byteLength(value.serialized),
    );
    expect(actualReads.at(-1)).toBe(0);
    const admitted = create({
      directoryPath: value.directoryPath,
      retain() {},
      maximumInventoryBytes: 2 * Buffer.byteLength(value.serialized) + 2,
    });
    actualReads.length = 0;
    expect(scanner(admitted)(() => null).entries).toHaveLength(2);
    expect(actualReads.reduce((sum, count) => sum + count, 0)).toBe(
      2 * Buffer.byteLength(value.serialized),
    );
    expect(actualReads.filter((count) => count === 0)).toHaveLength(2);
  });

  it.each(["ino", "mtimeNs"])(
    "rejects Number fallback for inventory identity field %s before content I/O",
    (field) => {
      const value = fixture();
      const fsImpl = {
        ...fs,
        lstatSync(target, options) {
          const stat = fs.lstatSync(target, options);
          return target === value.file && options?.bigint
            ? Object.assign(Object.create(stat), {
                [field]: Number(stat[field]),
              })
            : stat;
        },
      };
      const backend = create({
        directoryPath: value.directoryPath,
        retain() {},
        fsImpl,
      });
      const read = vi.spyOn(fs, "readSync");
      expect(() => scanner(backend)(() => null)).toThrow(
        /full-precision single-link identity/u,
      );
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("detects mutation of an earlier file by a later verifier callback", () => {
    const value = fixture();
    fs.writeFileSync(
      path.join(value.directoryPath, `${"b".repeat(64)}.json`),
      value.serialized,
    );
    let consumed = 0;
    expect(() =>
      scanner(value.backend)(() => {
        if (++consumed === 2) {
          fs.writeFileSync(
            value.file,
            value.serialized.replace("opaque", "OPAQUE"),
          );
          fs.utimesSync(value.file, new Date(1_000), new Date(2_000));
        }
      }),
    ).toThrow(/file changed before scan release/u);
    expect(consumed).toBe(2);
  });

  it("detects a file added by a verifier callback without removing it", () => {
    const value = fixture();
    const added = path.join(value.directoryPath, `${"b".repeat(64)}.json`);
    expect(() =>
      scanner(value.backend)(() => fs.writeFileSync(added, value.serialized)),
    ).toThrow(/directory inventory changed/u);
    expect(fs.readFileSync(added, "utf8")).toBe(value.serialized);
  });

  it("rechecks physical evidence without executing the consumer again", () => {
    const value = fixture();
    const consume = vi.fn((resolution, evidence) => evidence);
    const observed = scanner(value.backend)(consume);
    expect(observed.recheckMetadata()).toBe(true);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(() => observed.recheckMetadata({})).toThrow(TypeError);
    fs.renameSync(value.file, path.join(value.root, "original.json"));
    fs.writeFileSync(value.file, value.serialized, { mode: 0o600 });
    expect(() => observed.recheckMetadata()).toThrow(/file changed/u);
  });

  it("rejects forged scanners, asynchronous consumers and invalid limits", () => {
    const value = fixture();
    expect(() => scanner({ ...value.backend })).toThrow(TypeError);
    expect(() => scanner(value.backend, {})).toThrow(TypeError);
    expect(() => scanner(value.backend)(async () => null)).toThrow(
      /synchronous/u,
    );
    for (const maximumInventoryFiles of [0, 4097, Infinity])
      expect(() =>
        create({
          directoryPath: value.directoryPath,
          retain() {},
          maximumInventoryFiles,
        }),
      ).toThrow(TypeError);
    for (const maximumInventoryBytes of [0, 1, 256 * 1024 * 1024 + 1])
      expect(() =>
        create({
          directoryPath: value.directoryPath,
          retain() {},
          maximumInventoryBytes,
        }),
      ).toThrow(TypeError);
  });
  it("opens existing state without initialization and reads exact bytes through descriptors", () => {
    const value = fixture();
    const wholeRead = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("whole read forbidden");
    });
    const mkdir = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      throw new Error("mkdir forbidden");
    });
    const chmod = vi.spyOn(fs, "chmodSync").mockImplementation(() => {
      throw new Error("chmod forbidden");
    });
    const backend = create({
      directoryPath: value.directoryPath,
      retain: value.retain,
    });
    expect(backend.resolve({ segmentRef: reference })).toMatchObject({
      found: true,
      bytes: value.content,
      proof: value.proof,
    });
    const cap = capture(backend);
    expect(cap.recheck()).toBe(cap.descriptor);
    expect(cap.descriptor).toMatchObject({
      storageInventoryVerified: false,
      retentionStorageVerified: false,
      grantsMutationOrPromotionAuthority: false,
    });
    expect(wholeRead).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
    expect(value.retain).not.toHaveBeenCalled();
  });

  it("does not create a missing directory or repair missing referenced state", () => {
    const value = fixture();
    const missing = path.join(value.root, "absent");
    expect(() => create({ directoryPath: missing, retain() {} })).toThrow();
    expect(fs.existsSync(missing)).toBe(false);
    fs.unlinkSync(value.file);
    expect(() => value.backend.resolve({ segmentRef: reference })).toThrow(
      expect.objectContaining({ code: FAILED }),
    );
    expect(fs.existsSync(value.file)).toBe(false);
  });

  it("rejects copied directories and resumes only when the original is restored", () => {
    const value = fixture();
    const cap = capture(value.backend);
    const saved = path.join(value.root, "saved");
    fs.renameSync(value.directoryPath, saved);
    fs.cpSync(saved, value.directoryPath, { recursive: true });
    if (process.platform !== "win32") fs.chmodSync(value.directoryPath, 0o700);
    expect(() => capture(value.backend)).toThrow(
      expect.objectContaining({ code: FAILED }),
    );
    expect(() => value.backend.resolve({ segmentRef: reference })).toThrow();
    expect(() => value.backend.retain({})).toThrow();
    expect(value.retain).not.toHaveBeenCalled();
    // Preserve both directories; restore only within this verified fixture root.
    fs.renameSync(value.directoryPath, path.join(value.root, "clone"));
    fs.renameSync(saved, value.directoryPath);
    expect(cap.recheck()).toBe(cap.descriptor);
    expect(value.backend.resolve({ segmentRef: reference }).bytes).toEqual(
      value.content,
    );
  });

  it("rejects hardlinked leaf state", () => {
    const value = fixture();
    fs.linkSync(value.file, path.join(value.root, "hardlink"));
    expect(() => value.backend.resolve({ segmentRef: reference })).toThrow(
      expect.objectContaining({ code: FAILED }),
    );
  });

  it.each([
    "not json",
    '{"bytes":"YQ=="}',
    '{"bytes":"YQ==","proof":{},"extra":1}',
    '{"bytes":"YQ","proof":{}}',
    '{"bytes":"YQ==\u0020","proof":{}}',
    '{"bytes":"","proof":{}}',
    "[]",
  ])("rejects malformed state %s", (serialized) => {
    const value = fixture();
    fs.writeFileSync(value.file, serialized);
    expect(() => value.backend.resolve({ segmentRef: reference })).toThrow(
      expect.objectContaining({ code: FAILED }),
    );
  });

  it("rejects oversize state before any content read", () => {
    const value = fixture({ maximumBytes: 2 });
    const read = vi.spyOn(fs, "readSync");
    expect(() => value.backend.resolve({ segmentRef: reference })).toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it("counts actual partial reads plus an EOF probe and closes descriptors", () => {
    const value = fixture();
    const read = fs.readSync.bind(fs);
    const reads = [];
    const open = vi.spyOn(fs, "openSync");
    const close = vi.spyOn(fs, "closeSync");
    vi.spyOn(fs, "readSync").mockImplementation(
      (fd, buffer, offset, length, position) => {
        const actual = read(fd, buffer, offset, Math.min(length, 3), position);
        reads.push(actual);
        return actual;
      },
    );
    expect(value.backend.resolve({ segmentRef: reference }).bytes).toEqual(
      value.content,
    );
    expect(reads.reduce((a, b) => a + b, 0)).toBe(
      Buffer.byteLength(value.serialized),
    );
    expect(reads.at(-1)).toBe(0);
    for (const result of open.mock.results.filter(
      (result) => result.type === "return",
    ))
      expect(close).toHaveBeenCalledWith(result.value);
  });

  it("rejects equal-length in-place mutation and closes the reading descriptor", () => {
    const value = fixture();
    const read = fs.readSync.bind(fs);
    const close = vi.spyOn(fs, "closeSync");
    let readingFd;
    vi.spyOn(fs, "readSync").mockImplementation((...args) => {
      const actual = read(...args);
      if (readingFd === undefined) {
        readingFd = args[0];
        fs.writeFileSync(
          value.file,
          value.serialized.replace("opaque", "OPAQUE"),
        );
        // Deterministic metadata change even on a coarse mounted filesystem.
        fs.utimesSync(value.file, new Date(1_000), new Date(2_000));
      }
      return actual;
    });
    expect(() => value.backend.resolve({ segmentRef: reference })).toThrow(
      expect.objectContaining({ code: FAILED }),
    );
    expect(close).toHaveBeenCalledWith(readingFd);
  });

  it("does not acquire ownership through forwarding, getters, or proxies", () => {
    const value = fixture();
    let calls = 0;
    const getter = Object.defineProperty({}, "descriptor", {
      get() {
        calls++;
        throw new Error("getter");
      },
    });
    const proxy = new Proxy(value.backend, {
      get() {
        calls++;
        throw new Error("proxy");
      },
    });
    const revoked = Proxy.revocable(value.backend, {});
    revoked.revoke();
    for (const impostor of [
      { ...value.backend },
      getter,
      proxy,
      revoked.proxy,
      null,
    ]) {
      expect(has(impostor)).toBe(false);
      expect(() => capture(impostor)).toThrow(TypeError);
    }
    expect(calls).toBe(0);
    expect(() => capture(value.backend, {})).toThrow(TypeError);
    expect(() => capture(value.backend).recheck({})).toThrow(TypeError);
  });

  it("rechecks the original directory after the explicit publisher returns", () => {
    const value = fixture();
    const backend = create({
      directoryPath: value.directoryPath,
      retain() {
        fs.renameSync(value.directoryPath, path.join(value.root, "old"));
        fs.mkdirSync(value.directoryPath, { mode: 0o700 });
        return value.proof;
      },
    });
    expect(() => backend.retain({})).toThrow(
      expect.objectContaining({ code: FAILED }),
    );
  });

  it("rejects traversal references before filesystem access", () => {
    const value = fixture();
    const stat = vi.spyOn(fs, "lstatSync");
    expect(() =>
      value.backend.resolve({ segmentRef: "../../outside" }),
    ).toThrow(TypeError);
    expect(stat).not.toHaveBeenCalled();
  });

  it("rejects malformed UTF-8 rather than replacing invalid bytes", () => {
    const value = fixture();
    fs.writeFileSync(value.file, Buffer.from([0x7b, 0xff, 0x7d]));
    expect(() => value.backend.resolve({ segmentRef: reference })).toThrow(
      expect.objectContaining({ code: FAILED }),
    );
  });

  it("closes the actual descriptor on read errors", () => {
    const value = fixture();
    const close = vi.spyOn(fs, "closeSync");
    let readingFd;
    vi.spyOn(fs, "readSync").mockImplementation((fd) => {
      readingFd = fd;
      throw Object.assign(new Error("I/O fault"), { code: "EIO" });
    });
    expect(() => value.backend.resolve({ segmentRef: reference })).toThrow(
      expect.objectContaining({ code: FAILED }),
    );
    expect(close).toHaveBeenCalledWith(readingFd);
  });

  it("rejects a link alias to the original directory", () => {
    const value = fixture();
    const alias = path.join(value.root, "alias");
    fs.symlinkSync(
      value.directoryPath,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => create({ directoryPath: alias, retain() {} })).toThrow(
      expect.objectContaining({ code: FAILED }),
    );
  });

  it("accepts legitimate leaf replacement within the original directory", () => {
    const value = fixture();
    const replacement = path.join(value.directoryPath, "replacement");
    fs.writeFileSync(replacement, value.serialized, { mode: 0o600 });
    fs.renameSync(replacement, value.file);
    expect(value.backend.resolve({ segmentRef: reference }).bytes).toEqual(
      value.content,
    );
  });

  it.each([0, 1, 90 * 1024 * 1024 + 1, Infinity])(
    "rejects invalid encoded size budget %s",
    (maximumBytes) => {
      expect(() => fixture({ maximumBytes })).toThrow(TypeError);
    },
  );
});
