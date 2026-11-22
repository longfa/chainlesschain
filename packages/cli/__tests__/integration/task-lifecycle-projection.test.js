import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import {
  appendAssistantMessage,
  readVerifiedMessages,
  startSession,
} from "../../src/harness/jsonl-session-store.js";
import { BackgroundTaskManager } from "../../src/harness/background-task-manager.js";
import { AgentScheduleStore } from "../../src/lib/agent-schedule-store.js";
import { createMcpCallLedger } from "../../src/lib/mcp-call-ledger.js";
import { createSessionMcpLedgerSink } from "../../src/lib/mcp-call-ledger-store.js";
import { readSessionTranscriptHistory } from "../../src/lib/session-transcript-history.js";
import {
  appendMcpTaskJournalEvent,
  listMcpTaskRecords,
} from "../../src/lib/mcp-task-journal.js";

const cli = fileURLToPath(new URL("../../src/index.js", import.meta.url));

it("reads concurrent task sources and forks a verified session from separate CLI processes", async () => {
  const root = mkdtempSync(join(tmpdir(), "cc-task-lifecycle-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const manager = new BackgroundTaskManager();
  vi.stubEnv("HOME", root);
  vi.stubEnv("USERPROFILE", root);
  vi.stubEnv("CHAINLESSCHAIN_HOME", join(root, "config"));
  vi.stubEnv("CHAINLESSCHAIN_SECURITY_ANCHOR_HOME", join(root, "security"));
  const run = (...args) => {
    const child = spawnSync(process.execPath, [cli, ...args], {
      cwd: workspace,
      encoding: "utf8",
      timeout: 45_000,
      windowsHide: true,
    });
    expect(child.error).toBeUndefined();
    return child;
  };

  try {
    const sessionId = "task-fixture-" + randomUUID();
    startSession(sessionId, { provider: "fixture", model: "fixture" });
    appendAssistantMessage(sessionId, "common reply");
    const localId = randomUUID();
    const ledger = createMcpCallLedger({
      sink: createSessionMcpLedgerSink(sessionId),
    });
    const ticket = await ledger.begin({
      sessionId,
      serverName: "fixture",
      toolName: "work",
      input: {},
      effectContract: { effect: "write" },
    });
    const at = new Date().toISOString();
    const commonEvent = { schemaVersion: 1, sessionId, localId, at };
    appendMcpTaskJournalEvent(sessionId, {
      ...commonEvent,
      phase: "prepared",
      revision: 0,
      serverName: "fixture",
      toolName: "work",
      ledgerId: ticket.ledgerId,
      inputDigest: ticket.record.inputDigest,
      identityDigest: "hmac-sha256:" + "a".repeat(64),
      secretRef: "mcp-task/" + localId,
    });
    const mcpTask = {
      taskId: "remote:work",
      createdAt: at,
      lastUpdatedAt: at,
      ttl: 60 * 60 * 1000,
    };
    appendMcpTaskJournalEvent(sessionId, {
      ...commonEvent,
      phase: "accepted",
      revision: 1,
      task: { ...mcpTask, status: "working" },
    });
    appendMcpTaskJournalEvent(sessionId, {
      ...commonEvent,
      phase: "observed",
      revision: 2,
      task: { ...mcpTask, status: "input_required" },
    });
    const shell = manager.create({ command: "echo fixture" });
    const now = Date.now();
    const schedule = new AgentScheduleStore({
      dir: join(root, ".chainlesschain", "agent-schedule"),
    }).scheduleWakeup({
      prompt: "scheduled fixture",
      dueAt: now + 60_000,
      expiresAt: now + 120_000,
    });

    const list = run("tasks", "--json", "--session", sessionId);
    expect(list.status, list.stderr).toBe(0);
    expect(JSON.parse(list.stdout).tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "background-shell",
          taskId: shell.id,
          state: "pending",
          label: "Background shell",
        }),
        expect.objectContaining({
          source: "mcp",
          taskId: sessionId + ":" + localId,
          state: "input_required",
          waitingOn: "mcp-input",
          endsAt: new Date(Date.parse(at) + mcpTask.ttl).toISOString(),
        }),
        expect.objectContaining({
          source: "schedule",
          taskId: schedule.id,
          endsAt: new Date(now + 120_000).toISOString(),
        }),
      ]),
    );

    const fork = run("session", "fork", "--json", "--", sessionId);
    expect(fork.status, fork.stderr).toBe(0);
    const branch = JSON.parse(fork.stdout);
    expect(branch).toMatchObject({
      sessionId: expect.stringMatching(/^session-fork-/),
      forkedFrom: sessionId,
    });
    expect(listMcpTaskRecords(branch.sessionId)).toEqual([]);
    appendAssistantMessage(branch.sessionId, "branch reply");
    appendAssistantMessage(sessionId, "original reply");
    const replies = (id) =>
      readVerifiedMessages(id)
        .filter(({ role }) => role === "assistant")
        .map(({ content }) => content);
    expect(replies(sessionId)).toEqual(["common reply", "original reply"]);
    expect(replies(branch.sessionId)).toEqual(["common reply", "branch reply"]);

    const boundary = readSessionTranscriptHistory(sessionId).messages[0].id;
    const partial = run(
      "session",
      "fork",
      "--json",
      "--after-message",
      boundary,
      "--",
      sessionId,
    );
    expect(partial.status, partial.stderr || partial.stdout).toBe(0);
    const partialId = JSON.parse(partial.stdout).sessionId;
    expect(replies(partialId)).toEqual(["common reply"]);
    expect(listMcpTaskRecords(partialId)).toEqual([]);
    expect(replies(sessionId)).toEqual(["common reply", "original reply"]);
  } finally {
    manager.destroy();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
