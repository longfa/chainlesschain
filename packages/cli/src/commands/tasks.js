import { collectTaskRecords, taskCounts } from "../lib/task-record.js";

export function registerTasksCommand(program) {
  const tasks = program
    .command("tasks")
    .description(
      "List tasks across background, MCP, agent and schedule runtimes",
    );
  tasks
    .option("--json", "Output the canonical TaskRecord projection as JSON")
    .option("--active-only", "Hide terminal tasks")
    .action((options) => {
      const records = collectTaskRecords();
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
