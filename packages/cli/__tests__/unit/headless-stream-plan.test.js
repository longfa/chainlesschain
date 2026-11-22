import "../helpers/test-model-egress.js";
/**
 * Stream-mode plan controls (chat-panel plan UI) — stdin
 * {"type":"plan","action":…} mirrors the REPL's /plan verbs:
 *   enter   → plan mode on (write tools become plan items) + plan_update
 *   approve → unlock + plan_update + an IMMEDIATE continuation turn
 *   reject  → off + plan_update
 * plus a live plan_update after every turn while planning. Uses the real
 * process-global PlanModeManager (reset around each test).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runAgentHeadlessStream,
  parseInputEvent,
  planSnapshot,
} from "../../src/runtime/headless-stream.js";
import { getPlanModeManager } from "../../src/lib/plan-mode.js";
import { openSessionPlan } from "../../src/lib/session-plan-approval.js";
import { planSnapshotPath } from "../../src/lib/plan-persistence.js";
import { startSession } from "../../src/harness/jsonl-session-store.js";
import { runAgentHeadless } from "../helpers/test-model-egress.js";

function resetPlan() {
  const pm = getPlanModeManager();
  try {
    if (pm.isActive()) pm.rejectPlan("test reset");
  } catch {
    /* ignore */
  }
}

function harness({ inputObjs, agentLoop } = {}) {
  const lines = [];
  const seenTurns = [];
  const loop =
    agentLoop ||
    async function* (messages) {
      seenTurns.push(
        messages.map((m) => ({ role: m.role, content: m.content })),
      );
      yield { type: "response-complete", content: "reply" };
      yield { type: "run-ended", reason: "complete" };
    };
  async function* input() {
    for (const o of inputObjs) yield JSON.stringify(o) + "\n";
  }
  const deps = {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    writeOut: (s) => lines.push(s),
    writeErr: () => {},
    agentLoop: loop,
    planManager: getPlanModeManager(),
    input: input(),
  };
  return {
    run: () => runAgentHeadlessStream({ expandFileRefs: false }, deps),
    events: () =>
      lines
        .join("")
        .trimEnd()
        .split("\n")
        .map((l) => JSON.parse(l)),
    seenTurns,
  };
}

it("restores the approved mode and tool lock from a fresh process", async () => {
  const root = mkdtempSync(join(tmpdir(), "cc-plan-approval-restart-"));
  vi.stubEnv("CHAINLESSCHAIN_HOME", join(root, "config"));
  vi.stubEnv("CHAINLESSCHAIN_DATA_DIR", join(root, "data"));
  vi.stubEnv("CHAINLESSCHAIN_SECURITY_ANCHOR_HOME", join(root, "authority"));
  const sessionId = "session-plan-restart";
  const moduleUrl = new URL(
    "../../src/lib/session-plan-approval.js",
    import.meta.url,
  );
  const freshHost = (mode) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { openSessionPlan } from ${JSON.stringify(moduleUrl.href)};
     const opened = openSessionPlan(process.argv[1], process.argv[2]);
     console.log(JSON.stringify({
       mode: opened.permissionMode,
       lock: opened.manager.getExecutionLock(),
     }));`,
        sessionId,
        ...(mode ? [mode] : []),
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
  try {
    startSession(sessionId, { provider: "ollama", model: "fixture" });
    const { manager } = openSessionPlan(sessionId);
    manager.enterPlanMode({ title: "Restart fixture" });
    manager.addPlanItem({
      title: "Approved edit",
      tool: "write_file",
      params: { path: "fixture.txt" },
    });
    const rows = [];
    const stream = await runAgentHeadlessStream(
      { sessionId, permissionMode: "acceptEdits", useRegisteredMcp: false },
      {
        input: (async function* () {
          yield '{"type":"plan","action":"approve"}\n';
        })(),
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: (value) => rows.push(value),
        writeErr: () => {},
        agentLoop: async function* () {
          yield { type: "response-complete", content: "fixture" };
          yield { type: "run-ended", reason: "complete" };
        },
      },
    );
    expect(stream.exitCode, rows.join("")).toBe(0);
    const restored = freshHost();
    expect(restored.status, restored.stderr).toBe(0);
    expect(JSON.parse(restored.stdout)).toMatchObject({
      mode: "acceptEdits",
      lock: {
        permissionMode: "acceptEdits",
        allowedTools: expect.arrayContaining(["write_file"]),
      },
    });
    expect(freshHost("bypassPermissions").status).toBe(1);
    const singleRows = [];
    const single = await runAgentHeadless(
      {
        prompt: "Continue the plan",
        resume: sessionId,
        outputFormat: "stream-json",
        useRegisteredMcp: false,
      },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: (value) => singleRows.push(value),
        writeErr: () => {},
        agentLoop: async function* (_messages, options) {
          expect(options.planManager.getExecutionLock().permissionMode).toBe(
            "acceptEdits",
          );
          yield {
            type: "tool-executing",
            tool: "write_file",
            tool_use_id: "tool-fixture",
            args: { path: "fixture.txt" },
          };
          yield {
            type: "tool-result",
            tool: "write_file",
            tool_use_id: "tool-fixture",
            result: { note: "tool output is private" },
          };
          yield { type: "response-complete", content: "fixture" };
          yield { type: "run-ended", reason: "complete" };
        },
      },
    );
    expect(single.exitCode, singleRows.join("")).toBe(0);
    expect(singleRows.join("")).toContain('"permission_mode":"acceptEdits"');
    const persisted = openSessionPlan(sessionId).manager.currentPlan.items[0];
    expect(persisted).toMatchObject({ status: "completed", result: null });
    const snapshotPath = planSnapshotPath(sessionId);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.state.currentPlan.items[0].params.path = "different.txt";
    writeFileSync(snapshotPath, JSON.stringify(snapshot));
    expect(freshHost().stderr).toContain(
      "no matching session approval receipt",
    );
    unlinkSync(planSnapshotPath(sessionId));
    const missing = freshHost();
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("no matching session approval receipt");
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

describe("parseInputEvent — plan controls", () => {
  it("parses plan actions and ignores empty ones", () => {
    expect(parseInputEvent('{"type":"plan","action":"enter"}')).toEqual({
      plan: "enter",
    });
    expect(parseInputEvent('{"type":"plan","action":"APPROVE"}')).toEqual({
      plan: "approve",
    });
    expect(
      parseInputEvent('{"type":"plan","action":"requestChanges"}'),
    ).toEqual({ plan: "revise" });
    expect(parseInputEvent('{"type":"plan"}')).toBe(null);
  });

  it("parses optional IDE review snapshots on plan controls", () => {
    const parsed = parseInputEvent(
      JSON.stringify({
        type: "plan",
        action: "approve",
        review: {
          action: "approve",
          reviewedAt: "2026-07-10T00:00:00.000Z",
          conversationId: "conv-1",
          revision: 4,
          comments: [
            {
              id: "c1",
              itemId: "p1",
              text: "Keep src/a.js:12 compatible",
              file: "src/a.js",
              line: 12,
              turn: 2,
            },
          ],
          executionLock: {
            planId: "plan-1",
            permissionMode: "acceptEdits",
            approvedItemIds: ["p1"],
            allowedTools: ["read_file", "edit_file"],
          },
          snapshot: "# Plan\n\nLooks good.",
        },
      }),
    );
    expect(parsed).toMatchObject({
      plan: "approve",
      planReview: {
        action: "approve",
        reviewedAt: "2026-07-10T00:00:00.000Z",
        conversationId: "conv-1",
        revision: 4,
        comments: [
          expect.objectContaining({
            id: "c1",
            itemId: "p1",
            file: "src/a.js",
            line: 12,
            turn: 2,
          }),
        ],
        executionLock: {
          planId: "plan-1",
          permissionMode: "acceptEdits",
          approvedItemIds: ["p1"],
          allowedTools: ["read_file", "edit_file"],
        },
        snapshot: "# Plan\n\nLooks good.",
      },
    });
  });
});

describe("stream plan mode", () => {
  beforeEach(resetPlan);
  afterEach(resetPlan);

  it("enter → plan_update(active) + [PLAN MODE ACTIVE] visible to the next turn", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        { type: "user", text: "analyze the task" },
      ],
    });
    await h.run();
    const updates = h.events().filter((e) => e.type === "plan_update");
    expect(updates.length).toBeGreaterThanOrEqual(2); // on enter + after turn
    expect(updates[0].active).toBe(true);
    const sys = h.seenTurns[0].filter((m) => m.role === "system");
    expect(sys.some((m) => /PLAN MODE ACTIVE/.test(m.content))).toBe(true);
  });

  it("approve with items unlocks and runs a continuation turn by itself", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        { type: "plan", action: "approve" },
      ],
    });
    // seed a plan item the way executeTool would (blocked write during planning)
    const pm = getPlanModeManager();
    const origEnter = pm.enterPlanMode.bind(pm);
    pm.enterPlanMode = (o) => {
      const r = origEnter(o);
      pm.addPlanItem({
        title: "write_file: a.js",
        tool: "write_file",
        params: { path: "a.js" },
        estimatedImpact: "medium",
      });
      return r;
    };
    try {
      await h.run();
    } finally {
      pm.enterPlanMode = origEnter;
    }
    const updates = h.events().filter((e) => e.type === "plan_update");
    expect(updates[0].items).toHaveLength(1);
    expect(updates[0].items[0].tool).toBe("write_file");
    const approved = updates.find((event) => event.execution_lock);
    expect(approved).toMatchObject({
      plan_id: expect.any(String),
      execution_lock: {
        permissionMode: "default",
        approvedItemIds: [expect.any(String)],
        allowedTools: expect.arrayContaining(["read_file", "write_file"]),
      },
    });
    // the approve triggered ONE turn without any user event on stdin
    expect(h.seenTurns).toHaveLength(1);
    const userMsgs = h.seenTurns[0].filter((m) => m.role === "user");
    expect(userMsgs.pop().content).toBe("Proceed with the approved plan.");
    const sys = h.seenTurns[0].filter((m) => m.role === "system");
    expect(sys.some((m) => /PLAN APPROVED/.test(m.content))).toBe(true);
    expect(sys.some((m) => /execution lock permits only/.test(m.content))).toBe(
      true,
    );
    // a result event for that turn exists
    expect(h.events().some((e) => e.type === "result" && !e.is_error)).toBe(
      true,
    );
  });

  it("approve writes an IDE review snapshot into the continuation turn", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        {
          type: "plan",
          action: "approve",
          review: {
            action: "approve",
            snapshot: "# Review\n\nApproved.",
            comments: [{ itemId: "p1", text: "Keep src/a.js:12 compatible" }],
            executionLock: {
              planId: "plan-1",
              permissionMode: "default",
              approvedItemIds: ["p1"],
              allowedTools: ["read_file", "write_file"],
            },
          },
        },
      ],
    });
    const pm = getPlanModeManager();
    const origEnter = pm.enterPlanMode.bind(pm);
    pm.enterPlanMode = (o) => {
      const r = origEnter(o);
      pm.addPlanItem({
        title: "write_file: a.js",
        tool: "write_file",
        params: { path: "a.js" },
        estimatedImpact: "medium",
      });
      return r;
    };
    try {
      await h.run();
    } finally {
      pm.enterPlanMode = origEnter;
    }
    const sys = h.seenTurns[0].filter((m) => m.role === "system");
    expect(sys.some((m) => /PLAN REVIEW SNAPSHOT/.test(m.content))).toBe(true);
    expect(sys.some((m) => /# Review/.test(m.content))).toBe(true);
    expect(
      sys.some((m) => /PLAN REVIEW STRUCTURED COMMENTS/.test(m.content)),
    ).toBe(true);
    expect(
      sys.some((m) => /REQUESTED EXECUTION LOCK - AUDIT ONLY/.test(m.content)),
    ).toBe(true);
  });

  it("revision freezes the previous plan and starts a fresh continuation", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        {
          type: "plan",
          action: "requestChanges",
          review: {
            action: "requestChanges",
            snapshot: "# Review\n\n- Replace the shell step.",
          },
        },
      ],
    });
    const pm = getPlanModeManager();
    const origEnter = pm.enterPlanMode.bind(pm);
    pm.enterPlanMode = (options) => {
      const result = origEnter(options);
      pm.addPlanItem({ id: "old-1", title: "Old shell", tool: "run_shell" });
      return result;
    };
    try {
      await h.run();
    } finally {
      pm.enterPlanMode = origEnter;
    }

    expect(h.seenTurns).toHaveLength(1);
    expect(
      h.seenTurns[0].some(
        (message) =>
          message.role === "system" &&
          /PLAN REVISION REQUESTED/.test(message.content),
      ),
    ).toBe(true);
    const updates = h.events().filter((event) => event.type === "plan_update");
    const revised = updates.find((event) => event.plan_version === 2);
    expect(revised).toMatchObject({
      active: true,
      state: "analyzing",
      plan_version: 2,
      previous_plan_id: expect.any(String),
      items: [],
    });
    expect(h.seenTurns[0].at(-1)).toMatchObject({
      role: "user",
      content: "Revise the plan from the review feedback.",
    });
  });

  it("attributes tool execution to a plan item and streams its progress", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        { type: "plan", action: "approve" },
      ],
      agentLoop: async function* () {
        yield {
          type: "tool-executing",
          tool: "edit_file",
          args: { path: "a.js" },
        };
        yield {
          type: "tool-result",
          tool: "edit_file",
          result: { ok: true },
        };
        yield { type: "response-complete", content: "done" };
        yield { type: "run-ended", reason: "complete" };
      },
    });
    const pm = getPlanModeManager();
    const origEnter = pm.enterPlanMode.bind(pm);
    pm.enterPlanMode = (options) => {
      const result = origEnter(options);
      pm.addPlanItem({
        id: "p1",
        title: "Edit a.js",
        tool: "edit_file",
        params: { path: "a.js" },
      });
      return result;
    };
    try {
      await h.run();
    } finally {
      pm.enterPlanMode = origEnter;
    }

    const events = h.events();
    expect(events.find((event) => event.type === "tool_use")).toMatchObject({
      id: "tu-1",
      plan_item_id: "p1",
      turn: 1,
    });
    expect(events.find((event) => event.type === "tool_result")).toMatchObject({
      id: "tu-1",
      plan_item_id: "p1",
      turn: 1,
      is_error: false,
    });
    const updates = events.filter((event) => event.type === "plan_update");
    expect(
      updates.some(
        (event) =>
          event.state === "executing" && event.items[0]?.status === "executing",
      ),
    ).toBe(true);
    expect(
      updates.some(
        (event) =>
          event.state === "completed" && event.items[0]?.status === "completed",
      ),
    ).toBe(true);
  });

  it("approve with NO items reports 'nothing to approve' and runs no turn", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        { type: "plan", action: "approve" },
      ],
    });
    await h.run();
    const note = h
      .events()
      .find((e) => e.type === "plan_update" && e.note === "nothing to approve");
    expect(note).toBeTruthy();
    expect(h.seenTurns).toHaveLength(0);
  });

  it("reject turns plan mode off", async () => {
    const h = harness({
      inputObjs: [
        { type: "plan", action: "enter" },
        { type: "plan", action: "reject" },
      ],
    });
    await h.run();
    const updates = h.events().filter((e) => e.type === "plan_update");
    expect(updates[0].active).toBe(true);
    expect(updates[updates.length - 1].active).toBe(false);
    expect(h.seenTurns).toHaveLength(0);
  });

  it("planSnapshot never throws on a virgin manager", () => {
    const snap = planSnapshot(getPlanModeManager());
    expect(snap).toMatchObject({ active: false, items: [] });
  });
});
