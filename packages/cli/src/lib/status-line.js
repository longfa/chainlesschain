import statusLine from "./status-line.cjs";
import executionBroker from "./process-execution-broker/index.js";
import { collectTaskRecords } from "./task-record.js";

const brokerRunner = executionBroker.spawnSync.bind(executionBroker);

export function renderStatusLine(config, context, options = {}) {
  return statusLine.renderStatusLine(config, context, {
    ...options,
    runProcess:
      options.runProcess || statusLine._deps.runProcess || brokerRunner,
  });
}

export function getStatusLine(options = {}) {
  const records = collectTaskRecords();
  const waiting = records.filter((task) =>
    ["waiting", "input_required", "paused"].includes(task.state),
  );
  return statusLine.getStatusLine({
    ...options,
    taskState: options.taskState || (waiting[0]?.state ?? null),
    approvalsPending:
      options.approvalsPending ??
      records.filter((task) => task.waitingOn === "approval").length,
    mcpErrors:
      options.mcpErrors ??
      records.filter((task) => task.source === "mcp" && task.state === "failed")
        .length,
    runProcess:
      options.runProcess || statusLine._deps.runProcess || brokerRunner,
  });
}

export const {
  loadStatusLineConfig,
  buildContext,
  formatTokens,
  shortenPath,
  renderDefaultStatusLine,
  isStatusLineDisabled,
  terminalSize,
  _deps,
} = statusLine;

export default { ...statusLine, renderStatusLine, getStatusLine };
