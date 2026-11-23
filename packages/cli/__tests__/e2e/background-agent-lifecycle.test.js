import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { CLI_BIN, testHome } from "./_helpers/cli-e2e.js";
import { isBackgroundProcessTreeExecutionAlive } from "../../src/lib/background-agent-supervisor.js";

const runFile = promisify(execFile);

async function withBackgroundAgent(runTest) {
  const t = testHome("background-agent-lifecycle");
  const bgDir = join(t.configHome, "background-agents");
  const session = "background-agent-lifecycle";
  const workerIds = [];
  const requests = [];
  const responseQueue = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    const reply = responseQueue.shift();
    if (!reply) {
      res.writeHead(400).end();
      return;
    }
    if (typeof reply === "function") {
      reply(res);
      return;
    }
    const message =
      typeof reply === "string"
        ? { role: "assistant", content: reply }
        : {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: reply.id,
                type: "function",
                function: {
                  name: reply.tool,
                  arguments: JSON.stringify(reply.args),
                },
              },
            ],
          };
    res.writeHead(200, {
      "Content-Type": "application/json",
      Connection: "close",
    });
    res.end(
      JSON.stringify({
        message,
        done: true,
        prompt_eval_count: 4,
        eval_count: 2,
      }),
    );
  });
  const run = (argv, input) => {
    const child = runFile(process.execPath, [CLI_BIN, ...argv], {
      cwd: t.workspace,
      env: t.env({
        APPDATA: t.configHome,
        XDG_CONFIG_HOME: t.configHome,
        CC_BACKGROUND_AGENTS_DIR: bgDir,
        CC_API_KEY: "",
      }),
      timeout: 90_000,
      windowsHide: true,
    });
    child.child.stdin.end(input);
    return child;
  };
  const json = async (...argv) => JSON.parse((await run(argv)).stdout);
  const readState = (id) =>
    JSON.parse(readFileSync(join(bgDir, `${id}.json`), "utf8"));
  const readLog = (id) => readFileSync(join(bgDir, `${id}.log`), "utf8");
  const poll = async (id, predicate) => {
    const deadline = Date.now() + 90_000;
    let state;
    do {
      state = readState(id);
      if (predicate(state)) return state;
      await delay(100);
    } while (Date.now() < deadline);
    throw new Error(
      `Background worker ${id} timed out in ${state.status}/${state.phase}\n${readLog(id)}`,
    );
  };
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const agent = [
      "agent",
      "--provider",
      "ollama",
      "--model",
      "test",
      "--base-url",
      `http://127.0.0.1:${server.address().port}`,
      "--sandbox-mode",
      "off",
      "--bare",
      "--no-mcp",
      "--session",
      session,
    ];
    const launch = async (text, ...flags) => {
      const state = await json(
        ...agent,
        ...flags,
        "--bg",
        "--output-format",
        "json",
        "-p",
        text,
      );
      workerIds.push(state.id);
      return state;
    };
    const resume = async (id, text) => {
      const state = await json("daemon", "resume", id, text, "--json");
      workerIds.push(state.id);
      return state;
    };
    await runTest({
      agent,
      launch,
      resume,
      json,
      poll,
      readLog,
      readState,
      requests,
      responseQueue,
      run,
      workspace: t.workspace,
    });
  } finally {
    try {
      for (const id of workerIds) {
        if (readState(id).status === "running")
          await json("agents", "stop", id, "--json");
      }
    } finally {
      await new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      });
      t.cleanup();
    }
  }
}

it(
  "restores a newly approved plan when restarting a finished background run",
  () =>
    withBackgroundAgent(
      async ({
        agent,
        launch,
        resume,
        poll,
        readLog,
        requests,
        responseQueue,
        run,
        workspace,
      }) => {
        const approvedPath = join(workspace, "approved.txt");
        const outsidePath = join(workspace, "outside-plan.txt");
        const args = { path: approvedPath, content: "approved content" };
        responseQueue.push("Original background turn completed.");
        const original = await launch("Initialize the fixture session");
        expect(original.launchProfile.permission.mode).toBe("default");
        const first = await poll(
          original.id,
          (state) => state.status !== "running",
        );
        expect(first.exitCode, readLog(original.id)).toBe(0);
        await poll(
          original.id,
          (state) =>
            !isBackgroundProcessTreeExecutionAlive(
              state.workerPid,
              state.startedAt,
              { processGroup: false },
            ),
        );

        responseQueue.push(
          { id: "propose-edit", tool: "write_file", args },
          "The edit is ready for approval.",
          "The approved edit will run in the next background turn.",
        );
        const approval = await run(
          [
            ...agent,
            "--permission-mode",
            "acceptEdits",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
          ],
          [
            { type: "plan", action: "enter" },
            { type: "user", text: "Plan a single edit" },
            { type: "plan", action: "approve" },
          ]
            .map((event) => JSON.stringify(event))
            .join("\n") + "\n",
        );
        const events = approval.stdout
          .trim()
          .split(/\r?\n/)
          .map((line) => JSON.parse(line));
        const plan = events.find(
          (event) => event.type === "plan_update" && event.execution_lock,
        );
        expect(plan?.execution_lock).toMatchObject({
          permissionMode: "acceptEdits",
        });
        expect(existsSync(approvedPath)).toBe(false);

        responseQueue.push(
          {
            id: "outside-approval",
            tool: "write_file",
            args: { ...args, path: outsidePath },
          },
          { id: "approved-edit-only", tool: "write_file", args },
          { id: "reuse-approved-edit", tool: "write_file", args },
          "The approved edit is done.",
        );
        const afterApproval = requests.length;
        const resumed = await resume(original.id, "Apply the approved edit");
        expect(resumed.id).not.toBe(original.id);
        expect(resumed.sessionId).toBe(original.sessionId);
        expect(resumed.configFingerprint).toBe(original.configFingerprint);
        const completed = await poll(
          resumed.id,
          (state) => state.status !== "running",
        );
        expect(completed.workerPid).not.toBe(first.workerPid);
        expect(completed.exitCode, readLog(resumed.id)).toBe(0);
        expect(requests).toHaveLength(afterApproval + 4);
        const lastRequest = requests.at(-1);
        const outcomes = lastRequest.messages
          .filter((message) => message.role === "tool")
          .slice(-3)
          .map((message) => JSON.parse(message.content));
        expect(outcomes).toMatchObject([
          { code: "CC_PLAN_TOOL_ARGS_NOT_APPROVED" },
          { success: true, path: approvedPath },
          { code: "CC_PLAN_TOOL_ARGS_NOT_APPROVED" },
        ]);
        expect(readFileSync(approvedPath, "utf8")).toBe(args.content);
        expect(existsSync(outsidePath)).toBe(false);
      },
    ),
  240_000,
);

it(
  "confirms a background stop after terminating a run with two nested sub-agents",
  () =>
    withBackgroundAgent(
      async ({ launch, json, poll, readState, requests, responseQueue }) => {
        const grandchildTask = "Work at delegation depth two";
        const childTask = "Work at delegation depth one";
        let grandchildResponse;
        let grandchildDisconnected = false;
        responseQueue.push(
          {
            id: "spawn-child",
            tool: "spawn_sub_agent",
            args: { role: "researcher", task: childTask },
          },
          {
            id: "spawn-grandchild",
            tool: "spawn_sub_agent",
            args: { role: "researcher", task: grandchildTask },
          },
          (res) => {
            grandchildResponse = res;
            res.once("close", () => {
              grandchildDisconnected = true;
            });
          },
        );
        const initial = await launch("Delegate the background fixture task");
        const active = await poll(
          initial.id,
          (state) => grandchildResponse || state.status !== "running",
        );
        const latestPrompt = (request) =>
          request.messages.filter((message) => message.role === "user").at(-1)
            ?.content;
        expect(active.status).toBe("running");
        expect(requests.slice(1).map(latestPrompt)).toEqual([
          childTask,
          grandchildTask,
        ]);
        expect(grandchildResponse).toBeDefined();
        expect(grandchildDisconnected).toBe(false);
        expect(active.agentPid).toBeGreaterThan(0);
        const before = await json("tasks", "--json");
        expect(
          before.tasks.find((task) => task.taskId === initial.id),
        ).toMatchObject({
          state: "running",
          stopPath: `cc agents stop ${initial.id}`,
        });

        const stopped = await json("agents", "stop", initial.id, "--json");
        expect(stopped).toMatchObject({
          status: "stopped",
          stopped: true,
          stopPending: false,
        });
        await poll(initial.id, () => grandchildDisconnected);
        expect(
          isBackgroundProcessTreeExecutionAlive(
            active.agentPid,
            active.agentStartedAt,
          ),
        ).toBe(false);
        expect(
          isBackgroundProcessTreeExecutionAlive(
            active.workerPid,
            active.startedAt,
            {
              processGroup: false,
            },
          ),
        ).toBe(false);
        const receipt = readState(initial.id);
        expect(receipt.stopRequestedAt).toBeGreaterThan(0);
        expect(receipt.stopCleanupConfirmedAt).toBeGreaterThanOrEqual(
          receipt.stopRequestedAt,
        );

        const after = await json("tasks", "--json");
        const task = after.tasks.find((row) => row.taskId === initial.id);
        expect(task).toMatchObject({
          state: "cancelled",
          stopPath: null,
          stopEvents: [
            { type: "stop_requested", at: receipt.stopRequestedAt },
            { type: "stop_confirmed", at: receipt.stopCleanupConfirmedAt },
          ],
        });
        expect(task).not.toHaveProperty("orphanRisk");
      },
    ),
  180_000,
);
