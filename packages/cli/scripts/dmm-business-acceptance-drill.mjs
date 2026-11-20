#!/usr/bin/env node

/**
 * Deterministic DMM-09 business acceptance drill.
 *
 * The project and task rows are real native SQLite rows. Only the owner DID
 * and clock are fixture inputs. The drill deliberately checks an incomplete
 * business outcome first, then completes the same outcome and reopens the
 * database to prove durable completion and idempotent replay.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestBusinessObjectContent as digest } from "@chainlesschain/session-core/business-object-contract";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { ApprovalGate } = require("@chainlesschain/session-core/approval-gate");
const {
  ProjectGoalCompletionService,
} = require("@chainlesschain/session-core/project-goal-completion");

export const DMM_BUSINESS_ACCEPTANCE_SCHEMA =
  "chainlesschain.dmm-business-acceptance/v1";

const OWNER = "did:chainless:dmm-business-acceptance";
const CLOCK = 1791244800000;

function initialize(db) {
  db.exec(`
    CREATE TABLE projects(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted INTEGER DEFAULT 0
    );
    CREATE TABLE project_tasks(
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted INTEGER DEFAULT 0,
      sync_status TEXT NOT NULL,
      due_date INTEGER,
      blocked_by TEXT
    );
  `);
  db.prepare(
    "INSERT INTO projects VALUES ('dmm-business-sample', ?, 'active', ?, 0)",
  ).run(OWNER, CLOCK);
  db.prepare(
    "INSERT INTO project_tasks VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL)",
  ).run(
    "prepare-report",
    "dmm-business-sample",
    "analyze_data",
    "Prepare the customer report",
    "pending",
    CLOCK,
    CLOCK,
    "synced",
  );
  db.prepare(
    "INSERT INTO project_tasks VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL)",
  ).run(
    "verify-report",
    "dmm-business-sample",
    "review",
    "Verify the customer report",
    "pending",
    CLOCK,
    CLOCK,
    "synced",
  );
}

function taskSnapshot(db) {
  return db
    .prepare(
      "SELECT id,status,updated_at FROM project_tasks WHERE project_id=? ORDER BY id",
    )
    .all("dmm-business-sample")
    .map((row) => ({
      id: row.id,
      status: row.status,
      updatedAt: row.updated_at,
    }));
}

function assertDrill(result) {
  if (
    result.schema !== DMM_BUSINESS_ACCEPTANCE_SCHEMA ||
    result.status !== "passed" ||
    result.firstAttempt.completed !== false ||
    result.firstAttempt.goalStatus !== "active" ||
    result.firstAttempt.reportMet !== false ||
    result.completedAttempt.completed !== true ||
    result.completedAttempt.goalStatus !== "done" ||
    result.completedAttempt.reportMet !== true ||
    result.reopened.goalStatus !== "done" ||
    result.replayed.replayed !== true ||
    result.replayed.completed !== true ||
    result.replayed.goalStatus !== "done" ||
    result.falseCompletionCount !== 0 ||
    result.rejectedAttemptCount !== 1 ||
    result.completionCount !== 1 ||
    result.reopened.completionEvidenceRefs !== 1
  )
    throw Object.assign(
      new Error("DMM-09 business acceptance drill did not pass"),
      { report: result },
    );
  return result;
}

export function runBusinessAcceptanceDrill({ root, output } = {}) {
  const ownsRoot = !root;
  const workRoot = root
    ? path.resolve(root)
    : fs.mkdtempSync(path.join(os.tmpdir(), "chainlesschain-dmm09-"));
  fs.mkdirSync(workRoot, { recursive: true });
  const databasePath = path.join(workRoot, "project.sqlite");
  let db;
  let now = CLOCK;
  try {
    db = new Database(databasePath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    initialize(db);

    const makeService = () =>
      new ProjectGoalCompletionService({
        db,
        getActor: () => OWNER,
        clock: () => now,
        approvalGate: new ApprovalGate({ confirm: async () => true }),
      });
    let service = makeService();
    let goal = service.goals.create({
      projectId: "dmm-business-sample",
      objective: "Deliver the customer report with independent verification",
      budgetPolicy: { maxRuns: 10 },
    });
    goal = service.configure({
      goalId: goal.id,
      expectedRevision: goal.revision,
      acceptanceCriteria: [
        {
          id: "report-delivered",
          kind: "business-assertion",
          description:
            "The report preparation and verification tasks are complete",
        },
      ],
      assertions: [
        { criterionId: "report-delivered", type: "all-tasks-completed" },
      ],
    }).goal;

    const pendingInput = {
      goalId: goal.id,
      expectedRevision: goal.revision,
      requestId: "dmm09-pending-check",
    };
    const first = service.complete(pendingInput);
    const pendingTasks = taskSnapshot(db);
    if (first.completed || first.report.met || first.goal.status !== "active")
      throw new Error("incomplete business outcome was accepted");

    // Business rows and the verifier share a forward-moving fixture clock.
    // A task updated after the verifier's as-of watermark must stay rejected.
    now += 1000;
    db.prepare(
      "UPDATE project_tasks SET status='completed',updated_at=? WHERE project_id=?",
    ).run(now, "dmm-business-sample");
    const completedInput = {
      goalId: goal.id,
      expectedRevision: goal.revision,
      requestId: "dmm09-complete",
    };
    const completed = service.complete(completedInput);
    const completedTasks = taskSnapshot(db);
    const completionEvidenceRefs =
      completed.goal.completion?.evidenceRefs || [];

    db.close();
    db = new Database(databasePath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    service = makeService();
    const reopenedGoal = service.goals.get({ id: goal.id });
    const reopened = {
      goalStatus: reopenedGoal.status,
      completionEvidenceRefs:
        reopenedGoal.completion?.evidenceRefs?.length || 0,
      taskSnapshot: taskSnapshot(db),
    };
    const replayed = service.complete(completedInput);
    const fixtureDigest = digest({
      projectId: "dmm-business-sample",
      tasks: completedTasks,
      acceptance: "report-delivered",
    });
    const result = assertDrill({
      schema: DMM_BUSINESS_ACCEPTANCE_SCHEMA,
      status: "passed",
      generatedAt: new Date().toISOString(),
      fixtureAsOf: new Date(now).toISOString(),
      owner: OWNER,
      projectId: "dmm-business-sample",
      goalId: goal.id,
      fixtureDigest,
      firstAttempt: {
        completed: first.completed,
        goalStatus: first.goal.status,
        reportMet: first.report.met,
        taskSnapshot: pendingTasks,
      },
      completedAttempt: {
        completed: completed.completed,
        goalStatus: completed.goal.status,
        reportMet: completed.report.met,
        evidenceRefs: completionEvidenceRefs.length,
        taskSnapshot: completedTasks,
      },
      reopened,
      replayed: {
        completed: replayed.completed,
        replayed: replayed.replayed,
        goalStatus: replayed.goal.status,
      },
      rejectedAttemptCount: db
        .prepare(
          "SELECT COUNT(*) AS n FROM cc_project_goal_acceptance WHERE kind='check' AND json_extract(record_json,'$.met')=0",
        )
        .get().n,
      falseCompletionCount: db
        .prepare(
          "SELECT COUNT(*) AS n FROM cc_project_goal_acceptance WHERE kind='check' AND json_extract(record_json,'$.met')=0 AND json_extract(record_json,'$.appliedRevision') IS NOT NULL",
        )
        .get().n,
      completionCount: db
        .prepare(
          "SELECT COUNT(*) AS n FROM cc_project_goal_acceptance WHERE kind='check' AND json_extract(record_json,'$.met')=1",
        )
        .get().n,
    });
    db.close();
    if (output) {
      const outputPath = path.resolve(output);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(
        outputPath,
        `${JSON.stringify(result, null, 2)}\n`,
        "utf8",
      );
      result.output = outputPath;
    }
    return result;
  } finally {
    if (db?.open) db.close();
    if (ownsRoot) fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = argv[++index];
    else if (arg === "--output") options.output = argv[++index];
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = runBusinessAcceptanceDrill(options);
    process.stdout.write(
      options.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `DMM-09 business acceptance drill passed for ${result.goalId}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `DMM-09 business acceptance drill failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}
