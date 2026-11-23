import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import { isProcessAlive } from "../../src/lib/background-agent-supervisor.js";
import { inspectPosixProcessGroup } from "../../src/lib/process-execution-broker/owned-posix-process-group.js";
import { AgentScheduleStore } from "../../src/lib/agent-schedule-store.js";
import { createMcpCallLedger } from "../../src/lib/mcp-call-ledger.js";
import { createSessionMcpLedgerSink } from "../../src/lib/mcp-call-ledger-store.js";
import { readSessionTranscriptHistory } from "../../src/lib/session-transcript-history.js";
import {
  appendMcpTaskJournalEvent,
  listMcpTaskRecords,
} from "../../src/lib/mcp-task-journal.js";

const cli = fileURLToPath(new URL("../../src/index.js", import.meta.url));

it("reports a live background worker whose stop cannot be confirmed by a reloaded manager", async () => {
  const root = mkdtempSync(join(tmpdir(), "cc-task-stop-evidence-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const userHome = join(root, "user-home");
  mkdirSync(userHome);
  vi.stubEnv("HOME", userHome);
  vi.stubEnv("USERPROFILE", userHome);
  vi.stubEnv("CHAINLESSCHAIN_HOME", join(root, "config"));
  vi.stubEnv("CHAINLESSCHAIN_SECURITY_ANCHOR_HOME", join(root, "security"));
  vi.stubEnv("APPDATA", join(root, "appdata"));
  vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));
  const script = join(workspace, "fixture.cjs");
  const marker = join(workspace, "started.txt");
  writeFileSync(
    script,
    `
    require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid));
    setTimeout(() => process.exit(0), 45_000);
  `,
  );
  const command = `"${process.execPath.replaceAll("\\", "/")}" "${script.replaceAll("\\", "/")}"`;
  const owner = new BackgroundTaskManager();
  let task;
  let child;
  try {
    task = owner.run({ command, cwd: workspace });
    child = owner.processes.get(task.id);
    const deadline = Date.now() + 15_000;
    while (
      !existsSync(marker) &&
      child.exitCode === null &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(existsSync(marker)).toBe(true);
    const payloadPid = Number(readFileSync(marker, "utf8"));
    expect(payloadPid).toBeGreaterThan(0);
    expect(payloadPid).not.toBe(child.pid);
    expect(child.exitCode).toBeNull();
    expect(isProcessAlive(payloadPid)).toBe(true);

    // The reloaded manager sees the on-disk task but cannot signal a process
    // it does not own. The original owner still holds the handle for cleanup.
    const observer = new BackgroundTaskManager({
      recoverOnStart: true,
      recoverPending: false,
    });
    expect(observer.stop(task.id)).toEqual({
      requested: true,
      confirmed: false,
      orphanRisk: true,
    });
    expect(
      observer.tasks.get(task.id).history.map(({ event }) => event),
    ).toEqual(expect.arrayContaining(["stop_requested", "stop_timeout"]));
    expect(child.exitCode).toBeNull();
    expect(isProcessAlive(payloadPid)).toBe(true);

    const run = (...args) => {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: workspace,
        encoding: "utf8",
        timeout: 45_000,
        windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      return JSON.parse(result.stdout);
    };
    expect(run("tasks", "--json").tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: task.id, orphanRisk: true }),
      ]),
    );
    expect(
      run("doctor", "--json").checkup.flatMap((section) => section.checks),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "bg-shell-stop-unconfirmed",
          level: "warn",
        }),
      ]),
    );

    const exited = once(child, "exit");
    owner.stop(task.id);
    await exited;
    const payloadStillRunning = () => {
      const states = inspectPosixProcessGroup(child.pid, {
        platform: process.platform,
        spawnSync,
      });
      return states
        ? states.some((state) => state !== "Z" && state !== "X")
        : isProcessAlive(payloadPid);
    };
    const reapDeadline = Date.now() + 5_000;
    while (payloadStillRunning() && Date.now() < reapDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(payloadStillRunning()).toBe(false);
    expect(owner.stop(task.id)).toEqual({
      requested: true,
      confirmed: true,
      orphanRisk: false,
    });
    expect(task.history.at(-1)?.event).toBe("stop_confirmed");
    const stored = run("tasks", "--json").tasks.find(
      ({ id }) => id === task.id,
    );
    expect(stored).toMatchObject({ state: "cancelled" });
    expect(stored).not.toHaveProperty("orphanRisk");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      owner.stop(task.id);
      await exited;
    }
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

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
    const scheduleStore = new AgentScheduleStore({
      dir: join(root, ".chainlesschain", "agent-schedule"),
    });
    const schedule = scheduleStore.scheduleWakeup({
      prompt: "scheduled fixture",
      dueAt: now + 60_000,
      expiresAt: now + 120_000,
    });
    const retiredSchedule = scheduleStore.scheduleWakeup({
      prompt: "retired before dispatch",
      dueAt: now + 60_000,
      expiresAt: now - 1000,
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
          nextRunAt: new Date(now + 60_000).toISOString(),
        }),
        expect.objectContaining({
          source: "schedule",
          taskId: retiredSchedule.id,
          state: "expired",
          nextRunAt: null,
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
