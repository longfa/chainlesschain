import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runBusinessAcceptanceDrill } from "../../scripts/dmm-business-acceptance-drill.mjs";

describe("DMM-09 independent business acceptance drill", () => {
  const roots = [];

  afterEach(() => {
    for (const root of roots.splice(0))
      fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects an incomplete outcome, persists completion, and replays after reopen", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dmm09-test-"));
    roots.push(root);
    const output = path.join(root, "evidence.json");
    const result = runBusinessAcceptanceDrill({ root, output });
    expect(result.status).toBe("passed");
    expect(result.firstAttempt).toMatchObject({
      completed: false,
      goalStatus: "active",
      reportMet: false,
    });
    expect(result.completedAttempt).toMatchObject({
      completed: true,
      goalStatus: "done",
      reportMet: true,
    });
    expect(result.reopened).toMatchObject({
      goalStatus: "done",
      completionEvidenceRefs: 1,
    });
    expect(result.replayed).toMatchObject({
      completed: true,
      replayed: true,
      goalStatus: "done",
    });
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({
      schema: "chainlesschain.dmm-business-acceptance/v1",
      status: "passed",
    });
  });
});
