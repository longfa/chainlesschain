import { collectTaskRecords, taskCounts } from "../lib/task-record.js";
import { listPersistedBackgroundShellTasks } from "../harness/background-task-manager.js";

async function readTaskSources({ session, cwd }) {
  const { listJsonlSessions, resolveSessionAuthority } =
    await import("../harness/jsonl-session-store.js");
  const { listMcpTaskRecords } = await import("../lib/mcp-task-journal.js");
  const { listBackgroundAgents } =
    await import("../lib/background-agent-supervisor.js");
  const { listDynamicWorkflowWorkbenchStates } =
    await import("../lib/dynamic-workflow-runtime.js");

  let mcp;
  if (session !== undefined) {
    const authority = resolveSessionAuthority(session);
    if (!authority?.readable)
      throw new Error("A readable canonical session is required for --session");
    mcp = listMcpTaskRecords(authority.id);
  } else {
    mcp = listJsonlSessions({ limit: 100 }).flatMap(({ id }) => {
      try {
        return listMcpTaskRecords(id);
      } catch {
        // A conflicting or unreadable session cannot provide task status.
        return [];
      }
    });
  }
  return {
    mcp,
    agent: listBackgroundAgents({ all: true }).map((agent) => {
      const waitingOn = agent.pendingQuestion
        ? "user-input"
        : agent.lifecycleState === "waitingApproval"
          ? "approval"
          : null;
      return {
        id: agent.id,
        parentTaskId: agent.sessionId,
        status:
          agent.status === "running" && waitingOn
            ? waitingOn === "approval"
              ? "waiting"
              : "input_required"
            : agent.status,
        waitingOn: agent.status === "running" ? waitingOn : null,
        lastEventAt: agent.endedAt ?? agent.heartbeatAt ?? agent.startedAt,
        startedAt: agent.startedAt,
        label: agent.title,
        stopPath: agent.status === "running" ? `cc stop ${agent.id}` : null,
      };
    }),
    cowork: listDynamicWorkflowWorkbenchStates(cwd ?? process.cwd()).runs.map(
      (run) => ({
        ...run,
        id: run.runId,
        parentTaskId: run.executionAuthoritySessionId,
        label: run.workflowId,
      }),
    ),
  };
}

export function registerTasksCommand(program) {
  const tasks = program
    .command("tasks")
    .description(
      "List tasks across background, MCP, agent and schedule runtimes",
    );
  tasks
    .option("--json", "Output the canonical TaskRecord projection as JSON")
    .option("--active-only", "Hide terminal tasks")
    .option("--session <id>", "Read MCP tasks from one canonical session")
    .option("--cwd <path>", "Project root for Cowork workflows")
    .action(async (options) => {
      let records;
      try {
        records = collectTaskRecords({
          backgroundTasks: listPersistedBackgroundShellTasks(),
          sources: await readTaskSources(options),
        });
      } catch {
        const message =
          options.session === undefined
            ? "Could not read task sources"
            : "Could not read task sources; verify the canonical session and project root";
        if (options.json) console.log(JSON.stringify({ error: { message } }));
        else console.error(message);
        process.exitCode = 1;
        return;
      }
      const visible = options.activeOnly
        ? records.filter((task) => !task.terminal)
        : records;
      if (options.json) {
        console.log(
          JSON.stringify({ ...taskCounts(records), tasks: visible }, null, 2),
        );
        return;
      }
      if (!visible.length) {
        console.log("No tasks.");
        return;
      }
      for (const task of visible) {
        const waiting = task.waitingOn ? ` waiting on ${task.waitingOn}` : "";
        const ends = task.endsAt ? ` ends ${task.endsAt}` : "";
        console.log(
          `${task.taskId} [${task.source}] ${task.state}${waiting}${ends}`,
        );
      }
    });
}
