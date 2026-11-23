/**
 * LSP integration test — exercises the FULL stack (spawn → handshake → didOpen →
 * query) against a REAL `typescript-language-server` if one is resolvable on
 * PATH. When no server is installed (e.g. CI without the toolchain) the whole
 * suite SKIPS visibly rather than passing hollowly ("不假绿" — no cosmetic green).
 *
 * To run it locally: `npm i -g typescript-language-server typescript` (or put a
 * project-local one on PATH), then `npx vitest run code-intelligence.integration`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import { resolveBin } from "../lsp-server-registry.js";
import { CodeIntelligence } from "../code-intelligence.js";

const serverAvailable = Boolean(resolveBin("typescript-language-server"));
const suite = serverAvailable ? describe : describe.skip;

if (!serverAvailable) {
  // Make the skip reason obvious in test output.

  console.warn(
    "[lsp.integration] SKIP — no `typescript-language-server` on PATH. " +
      "Install it to run real LSP integration coverage.",
  );
}

suite("CodeIntelligence against a real typescript-language-server", () => {
  let tmp;
  let ci;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-lsp-it-"));
    fs.mkdirSync(path.join(tmp, "src"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "lsp-it", version: "1.0.0", private: true }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmp, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "node",
        },
        include: ["src"],
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmp, "src", "math.ts"),
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmp, "src", "main.ts"),
      'import { add } from "./math";\n\nconst total = add(1, 2);\nconsole.log(total);\nconst bad: number = notDeclared;\n',
      "utf8",
    );
    ci = new CodeIntelligence({ projectRoot: tmp, coldStart: true });
  });

  afterAll(async () => {
    if (ci) await ci.dispose();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("serves simultaneous definition and references queries on cold start", async () => {
    const main = path.join(tmp, "src", "main.ts");
    const math = path.join(tmp, "src", "math.ts");
    const [definition, references] = await Promise.all([
      ci.definition(main, 3, 15),
      ci.references(math, 1, 17),
    ]);

    expect(definition.available).toBe(true);
    expect(
      definition.locations.map((item) => path.basename(item.file)),
    ).toContain("math.ts");
    expect(references.available).toBe(true);
    expect(references.locations.length).toBeGreaterThanOrEqual(2);
    expect(
      references.locations.map((item) => path.basename(item.file)),
    ).toContain("main.ts");
  }, 30000);

  it("reports diagnostics for an undefined name", async () => {
    const res = await ci.diagnostics(path.join(tmp, "src", "main.ts"), {
      timeoutMs: 8000,
    });
    expect(res.available).toBe(true);
    expect(res.diagnostics.some((d) => /notDeclared/.test(d.message))).toBe(
      true,
    );
    const err = res.diagnostics.find((d) => d.severity === "error");
    expect(err).toBeTruthy();
  }, 30000);

  it("lists document symbols", async () => {
    const res = await ci.documentSymbols(path.join(tmp, "src", "math.ts"));
    expect(res.available).toBe(true);
    expect(
      res.symbols.some((s) => s.name === "add" && s.kind === "function"),
    ).toBe(true);
  }, 30000);

  it("previews a rename without mutating files", async () => {
    const before = fs.readFileSync(path.join(tmp, "src", "math.ts"), "utf8");
    const res = await ci.renamePreview(
      path.join(tmp, "src", "math.ts"),
      1,
      17,
      "sum",
    );
    expect(res.available).toBe(true);
    expect(res.edits.length).toBeGreaterThan(0);
    // preview only — the file on disk is unchanged
    expect(fs.readFileSync(path.join(tmp, "src", "math.ts"), "utf8")).toBe(
      before,
    );
  }, 30000);
});
