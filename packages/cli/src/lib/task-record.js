/**
 * Canonical task projection shared by CLI, status-line and IDE consumers.
 *
 * Adapters deliberately accept plain objects so callers can project tasks
 * owned by another runtime without importing that runtime's storage layer.
 */
import { listBackgroundShellTasks } from "../runtime/agent-core.js";
import { AgentScheduleStore } from "./agent-schedule-store.js";
import { SubAgentRegistry } from "./sub-agent-registry.js";

export const TASK_SOURCES = Object.freeze([
  "background-shell",
  "mcp",
  "agent",
  "schedule",
  "cowork",
]);

export const TASK_STATES = Object.freeze([
  "pending",
  "running",
  "waiting",
  "input_required",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "expired",
  "unknown",
]);

const TERMINAL = new Set(["completed", "failed", "cancelled", "expired"]);
const SOURCE_READERS = new Map();

/** Register a live source reader without coupling it to the projection layer. */
export function registerTaskSource(source, reader) {
  if (!source || typeof reader !== "function")
    throw new TypeError("task source requires a name and reader function");
  SOURCE_READERS.set(source, reader);
  return () => SOURCE_READERS.delete(source);
}

function first(value, fallback = null) {
  return value === undefined ? fallback : value;
}

function normalizeState(value, fallback = "unknown") {
  const state = String(value || "")
    .trim()
    .toLowerCase();
  if (TASK_STATES.includes(state)) return state;
  if (["needs_input", "awaiting_input"].includes(state))
    return "input_required";
  if (["blocked", "waiting_permission"].includes(state)) return "waiting";
  if (["aborted", "canceled", "stopped"].includes(state)) return "cancelled";
  if (["created", "queued", "scheduled", "prepared"].includes(state))
    return "pending";
  if (
    [
      "active",
      "started",
      "in_progress",
      "working",
      "accepted",
      "observed",
    ].includes(state)
  )
    return "running";
  if (
    [
      "done",
      "success",
      "succeeded",
      "exited",
      "fired",
      "matched",
      "exhausted",
      "result_saved",
    ].includes(state)
  )
    return "completed";
  if (["error", "timeout", "lost"].includes(state)) return "failed";
  return fallback;
}

function timestamp(value) {
  if (
    !(value instanceof Date) &&
    typeof value !== "number" &&
    typeof value !== "string"
  )
    return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function stableId(value, fallback) {
  const id = value?.taskId ?? value?.id ?? value?.executionId ?? fallback;
  return String(id || fallback);
}

/** Convert one source-specific task into the canonical, additive shape. */
export function toTaskRecord(value, source = "unknown", options = {}) {
  const input = value && typeof value === "object" ? value : {};
  const normalizedSource = TASK_SOURCES.includes(source)
    ? source
    : source || "unknown";
  const state = normalizeState(
    input.state ??
      input.status ??
      input.remoteStatus ??
      input.phase ??
      input.lifecycleState,
    normalizedSource === "schedule" && input.status === "active"
      ? "running"
      : "unknown",
  );
  const createdAt = timestamp(
    input.createdAt ?? input.created_at ?? input.startedAt,
  );
  const lastEventAt = timestamp(
    input.lastEventAt ??
      input.lastUpdatedAt ??
      input.updatedAt ??
      input.endedAt ??
      input.lastHeartbeat ??
      createdAt,
  );
  const endsAt = timestamp(input.endsAt ?? input.expiresAt ?? input.expiryAt);
  const taskId = stableId(
    input,
    options.fallbackId || `${normalizedSource}-unknown`,
  );
  let stopPath = input.cancelPath ?? input.stop ?? null;
  if (Object.hasOwn(input, "stopPath")) stopPath = input.stopPath;
  else if (!stopPath && !TERMINAL.has(state)) {
    if (normalizedSource === "background-shell")
      stopPath = `check_shell --kill ${taskId}`;
    if (normalizedSource === "schedule")
      stopPath = `cc agenda cancel ${taskId}`;
  }
  const record = {
    taskId,
    // Legacy aliases keep existing `/tasks` callers working while new
    // consumers use the explicit canonical names below.
    id: taskId,
    parentTaskId: first(input.parentTaskId ?? input.parentId, null),
    permissionProfileDigest: first(input.permissionProfileDigest, null),
    modelDecision: first(input.modelDecision, null),
    source: normalizedSource,
    state,
    status: state,
    lastEventAt,
    endsAt,
    waitingOn: first(
      input.waitingOn ??
        input.waitingFor ??
        (state === "input_required"
          ? "input"
          : input.status === "waiting_permission"
            ? "approval"
            : null),
      null,
    ),
    stopPath: stopPath ?? null,
    label: first(
      input.label ?? input.description ?? input.command ?? input.prompt,
      null,
    ),
    createdAt,
    nextRunAt: timestamp(input.nextRunAt ?? input.nextAt ?? input.dueAt),
    expiresAction:
      input.expiresAction ??
      input.onExpire ??
      (normalizedSource === "schedule" && endsAt ? "retire" : null),
    ...(input.orphanRisk === true ? { orphanRisk: true } : {}),
    ...(Array.isArray(input.stopEvents) && input.stopEvents.length > 0
      ? { stopEvents: input.stopEvents }
      : {}),
    terminal: TERMINAL.has(state),
    rawSource: normalizedSource === "unknown" ? input : undefined,
  };
  if (options.includeRaw === true) record.raw = input;
  return Object.freeze(record);
}

function mapList(values, source, options) {
  return (Array.isArray(values) ? values : []).map((value, index) =>
    toTaskRecord(value, source, {
      ...options,
      fallbackId: `${source}-${index + 1}`,
    }),
  );
}

/**
 * Project all currently known task sources. Unknown source rows are retained
 * when supplied by a caller, which prevents a new runtime from disappearing
 * from the unified view during a rolling upgrade.
 */
export function collectTaskRecords(options = {}) {
  const now = options.now == null ? Date.now() : Number(options.now);
  let background = options.backgroundTasks;
  if (background === undefined) {
    try {
      background = listBackgroundShellTasks();
    } catch {
      background = [];
    }
  }
  let scheduled = options.scheduledEntries;
  if (scheduled === undefined) {
    try {
      scheduled = new AgentScheduleStore().list();
    } catch {
      scheduled = [];
    }
  }
  const read = (source, supplied) => {
    if (supplied !== undefined) return supplied;
    const reader = SOURCE_READERS.get(source);
    if (!reader) return [];
    try {
      const value = reader();
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  const sourceRows =
    options.sources && typeof options.sources === "object"
      ? options.sources
      : {};
  const agentTasks = options.agentTasks ?? sourceRows.agent;
  const agents = agentTasks ?? read("agent", undefined);
  const registry = SubAgentRegistry.getInstance();
  const subAgents = [...registry.getActive(), ...registry.getHistory()].map(
    (agent) => ({
      id: agent.id,
      parentTaskId: agent.parentId,
      status: agent.status,
      createdAt: agent.createdAt,
      endedAt: agent.completedAt,
      modelDecision: agent.modelDecision,
      label: agent.role,
    }),
  );
  const rows = [
    ...mapList(background, "background-shell", options),
    ...mapList(read("mcp", options.mcpTasks ?? sourceRows.mcp), "mcp", options),
    ...mapList(
      [...(Array.isArray(agents) ? agents : []), ...subAgents],
      "agent",
      options,
    ),
    ...mapList(scheduled, "schedule", options),
    ...mapList(
      read("cowork", options.coworkTasks ?? sourceRows.cowork),
      "cowork",
      options,
    ),
    ...mapList(options.unknownTasks ?? sourceRows.unknown, "unknown", options),
  ];
  const handled = new Set(["mcp", "agent", "cowork", "unknown"]);
  for (const [source, values] of Object.entries(sourceRows)) {
    if (
      handled.has(source) ||
      source === "background-shell" ||
      source === "schedule"
    )
      continue;
    rows.push(...mapList(values, source, options));
  }
  const records = rows.map((record) => {
    if (record.endsAt && Date.parse(record.endsAt) <= now && !record.terminal) {
      return Object.freeze({
        ...record,
        state: "expired",
        status: "expired",
        waitingOn: null,
        stopPath: null,
        terminal: true,
      });
    }
    return record;
  });
  return records.sort((a, b) =>
    String(b.lastEventAt || b.createdAt || "").localeCompare(
      String(a.lastEventAt || a.createdAt || ""),
    ),
  );
}

export function taskCounts(records) {
  const tasks = Array.isArray(records) ? records : [];
  return {
    count: tasks.length,
    active: tasks.filter((task) =>
      ["running", "pending", "waiting", "input_required", "paused"].includes(
        task.state,
      ),
    ).length,
    completed: tasks.filter((task) => task.terminal).length,
  };
}

export default {
  TASK_SOURCES,
  TASK_STATES,
  toTaskRecord,
  collectTaskRecords,
  taskCounts,
  registerTaskSource,
};
