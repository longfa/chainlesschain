/**
 * Background task listing utilities (ESM)
 * Mirrors Claude Code /tasks behavior
 * @module lib/task-list
 */

import { formatBackgroundTasks } from "../repl/tasks-status.js";
import { logger } from "./logger.js";
import { collectTaskRecords, taskCounts } from "./task-record.js";

/**
 * List all background tasks
 * @param {Object} options List options
 * @returns {Promise<Object>} task list result
 */
export async function listTasks(options = {}) {
  const tasks = collectTaskRecords(options);
  const counts = taskCounts(tasks);
  const active = tasks.filter((t) =>
    ["running", "pending", "waiting", "input_required", "paused"].includes(
      t.state,
    ),
  );
  const completed = tasks.filter((t) => t.terminal);

  if (tasks.length === 0) {
    logger.info("No background tasks");
    return { count: 0, active: 0, completed: 0, tasks: [] };
  }

  if (!options.quiet) {
    const background = tasks
      .filter((task) => task.source === "background-shell")
      .map((task) => ({
        ...task,
        id: task.taskId,
        status: task.state === "completed" ? "exited" : task.state,
        command: task.label || "",
      }));
    if (background.length) logger.info(formatBackgroundTasks(background));
  }

  logger.info(
    `  ${active.length} active, ${completed.length} completed (total: ${tasks.length})`,
  );

  return {
    ...counts,
    tasks,
    formatted: formatBackgroundTasks(
      tasks
        .filter((task) => task.source === "background-shell")
        .map((task) => ({ ...task, id: task.taskId, status: task.state })),
    ),
  };
}

/**
 * Get a specific task by ID
 * @param {string} taskId
 * @returns {Object|null}
 */
export function getTask(taskId) {
  const tasks = collectTaskRecords();
  return tasks.find((t) => t.taskId === taskId) || null;
}

export default { listTasks, getTask };
