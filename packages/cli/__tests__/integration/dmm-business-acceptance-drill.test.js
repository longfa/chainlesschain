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
    expect(result.rejectedAttemptCount).toBe(1);
    expect(result.falseCompletionCount).toBe(0);
    expect(result.completionCount).toBe(1);
    expect(result.reopened.taskSnapshot).toEqual(
      result.completedAttempt.taskSnapshot,
    );
    expect(
      result.completedAttempt.taskSnapshot.every(
        (row) => row.updatedAt <= Date.parse(result.fixtureAsOf),
      ),
    ).toBe(true);
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({
      schema: "chainlesschain.dmm-business-acceptance/v1",
      status: "passed",
    });
  });

  it("closes SQLite on a failed rerun and preserves the existing database", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dmm09-close-"));
    roots.push(root);
    runBusinessAcceptanceDrill({ root });
    const database = path.join(root, "project.sqlite");
    const before = fs.readFileSync(database);
    expect(() => runBusinessAcceptanceDrill({ root })).toThrow(
      /table projects already exists/,
    );
    // Windows refuses this rename if the failing invocation leaked its handle.
    const retained = path.join(root, "retained.sqlite");
    fs.renameSync(database, retained);
    expect(fs.readFileSync(retained)).toEqual(before);
  });
});
