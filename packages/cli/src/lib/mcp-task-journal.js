import {
  appendAuthorityEventWithVerifiedProjection,
  readVerifiedProjection,
} from "../harness/jsonl-session-store.js";
import {
  MCP_TASK_JOURNAL_EVENT,
  assertMcpTaskJournalSessionId,
  snapshotMcpTaskJournalEvent,
  transitionMcpTaskJournalRecord,
  createMcpTaskJournalProjection,
} from "./mcp-task-journal-projection.js";

export { MCP_TASK_JOURNAL_EVENT } from "./mcp-task-journal-projection.js";

function fail(reason) {
  const error = new Error(
    "MCP task journal rejected invalid authority: " + reason,
  );
  error.code = "CC_MCP_TASK_JOURNAL_INVALID";
  throw error;
}

export function readMcpTaskJournal(sessionId, options) {
  assertMcpTaskJournalSessionId(sessionId);
  return readVerifiedProjection(sessionId, () =>
    createMcpTaskJournalProjection(sessionId, options),
  );
}

/** Read task status without retaining result bodies from the transcript. */
export function listMcpTaskRecords(sessionId) {
  return readMcpTaskJournal(sessionId, { retainResults: false }).records.map(
    (record) => {
      const task = record.task;
      const terminal = ["completed", "failed", "cancelled"].includes(
        task?.status,
      );
      const settled = record.phase === "result_saved";
      return {
        taskId: `${sessionId}:${record.localId}`,
        parentTaskId: sessionId,
        state:
          settled && !terminal ? "completed" : (task?.status ?? record.phase),
        createdAt: task?.createdAt ?? record.at,
        lastEventAt: record.updatedAt ?? record.at,
        endsAt:
          task?.ttl == null ? null : Date.parse(task.createdAt) + task.ttl,
        waitingOn:
          !settled && task?.status === "input_required" ? "mcp-input" : null,
        stopPath:
          task && !terminal && !settled
            ? `cc mcp tasks cancel ${record.localId} --session ${sessionId}`
            : null,
        label: `${record.serverName}/${record.toolName}`,
      };
    },
  );
}

/** Validate and append under the canonical writer lock, then verify readback. */
export function appendMcpTaskJournalEvent(sessionId, value) {
  assertMcpTaskJournalSessionId(sessionId);
  const data = snapshotMcpTaskJournalEvent(sessionId, value);
  const receipt = appendAuthorityEventWithVerifiedProjection(
    sessionId,
    MCP_TASK_JOURNAL_EVENT,
    data,
    {
      createProjection: () => createMcpTaskJournalProjection(sessionId),
      validateProjection(current) {
        transitionMcpTaskJournalRecord(
          new Map(current.records.map((record) => [record.localId, record])),
          data,
          current.callRecovery,
        );
      },
    },
  );
  if (!/^[a-f0-9]{64}$/u.test(receipt?.hash || ""))
    fail("append not committed");
  const record = readMcpTaskJournal(sessionId).records.find(
    (item) => item.localId === data.localId,
  );
  if (!record || record.revision < data.revision)
    fail("committed record missing");
  return record;
}
