import statusLine from "./status-line.cjs";
import executionBroker from "./process-execution-broker/index.js";
import { collectTaskRecords } from "./task-record.js";
import { listMcpTaskRecords } from "./mcp-task-journal.js";

const brokerRunner = executionBroker.spawnSync.bind(executionBroker);

export function renderStatusLine(config, context, options = {}) {
  return statusLine.renderStatusLine(config, context, {
    ...options,
    runProcess:
      options.runProcess || statusLine._deps.runProcess || brokerRunner,
  });
}

export function buildContext(options = {}) {
  let mcpTasks = [];
  if (options.sessionId) {
    try {
      mcpTasks = listMcpTaskRecords(options.sessionId);
    } catch {
      // A new session can render a prompt before its transcript is created.
    }
  }
  const records = collectTaskRecords({ mcpTasks });
  const waiting =
    records.find((task) => task.waitingOn) ??
    records.find((task) => task.state === "paused");
  const schedule = records
    .filter(
      (task) => task.source === "schedule" && task.endsAt && !task.terminal,
    )
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt))[0];
  return statusLine.buildContext({
    ...options,
    taskState: options.taskState ?? waiting?.state ?? null,
    scheduleEndsAt: options.scheduleEndsAt ?? schedule?.endsAt,
    approvalsPending:
      options.approvalsPending ??
      records.filter((task) => task.waitingOn === "approval").length,
    mcpErrors:
      options.mcpErrors ??
      records.filter((task) => task.source === "mcp" && task.state === "failed")
        .length,
  });
}

export function getStatusLine(options = {}) {
  const config = options.config || statusLine.loadStatusLineConfig(options);
  return config
    ? renderStatusLine(config, buildContext(options), options)
    : null;
}

export const {
  loadStatusLineConfig,
  loadStatusLineContextThreshold,
  formatTokens,
  shortenPath,
  renderDefaultStatusLine,
  isStatusLineDisabled,
  terminalSize,
  _deps,
} = statusLine;

export default { ...statusLine, buildContext, renderStatusLine, getStatusLine };
