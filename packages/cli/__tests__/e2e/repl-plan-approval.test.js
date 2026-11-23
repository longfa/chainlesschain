import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { CLI_BIN, testHome } from "./_helpers/cli-e2e.js";

it("restores an interactive plan approval in a new CLI process", async () => {
  const t = testHome("repl-plan-approval");
  const sessionId = "repl-approved-plan";
  const approvedFile = join(t.workspace, "approved.txt");
  const otherFile = join(t.workspace, "outside-plan.txt");
  const settingsDir = join(t.workspace, ".claude");
  mkdirSync(settingsDir);
  writeFileSync(
    join(settingsDir, "settings.json"),
    JSON.stringify({
      statusLine: { contextUsageThreshold: 100 },
    }),
  );
  const requests = [];
  const replies = [];
  const write = (file, content) => ({
    role: "assistant",
    content: "",
    tool_calls: [
      { function: { name: "write_file", arguments: { path: file, content } } },
    ],
  });
  const say = (content) => ({ role: "assistant", content });
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url !== "/api/chat") return res.writeHead(404).end();
    const payload = JSON.parse(body);
    requests.push(payload);
    const message = replies.shift();
    if (!message) return res.writeHead(500).end();
    res.writeHead(200, {
      "Content-Type": "application/json",
      Connection: "close",
    });
    res.end(
      JSON.stringify({
        message,
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    );
  });
  const processes = [];
  function launch(flag, ...extra) {
    // Select the real readline REPL while driving its input through a pipe.
    const terminal =
      "Object.defineProperty(process.stdin,'isTTY',{value:true});process.stdin.setRawMode=()=>{};";
    const child = spawn(
      process.execPath,
      [
        "--import",
        `data:text/javascript,${encodeURIComponent(terminal)}`,
        CLI_BIN,
        "agent",
        "--provider",
        "ollama",
        "--model",
        "fixture",
        "--base-url",
        `http://127.0.0.1:${server.address().port}`,
        "--no-stream",
        "--no-mcp",
        "--no-ide",
        "--no-pdh",
        "--no-jetbrains",
        "--no-checkpoint",
        "--no-recall-memory",
        "--sandbox-mode",
        "off",
        flag,
        sessionId,
        ...extra,
      ],
      {
        cwd: t.workspace,
        env: t.env({
          NO_COLOR: "1",
          CC_STATUSLINE: "1",
          CC_PERMISSION_ASK_TIMEOUT_MS: "500",
        }),
        windowsHide: true,
      },
    );
    let output = "";
    let result;
    const finished = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        result = { code, output };
        resolve(result);
      });
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8").on("data", (text) => {
        output += text;
      });
    }
    child.stdin.on("error", () => {});
    const processHandle = {
      child,
      finished,
      send: (line) => child.stdin.write(`${line}\n`),
      async expectOutput(text) {
        const deadline = Date.now() + 25_000;
        while (!output.includes(text) && !result && Date.now() < deadline)
          await delay(25);
        expect(output).toContain(text);
        return output;
      },
    };
    processes.push(processHandle);
    return processHandle;
  }

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    replies.push(
      write(approvedFile, "approved content"),
      say("Plan ready for review"),
    );
    const original = launch("--session", "--permission-mode", "acceptEdits");
    await original.expectOutput("> ");
    original.send("/plan enter");
    await original.expectOutput("Entered plan mode");
    original.send("Plan a write to approved.txt");
    await original.expectOutput("Plan ready for review");
    expect(existsSync(approvedFile)).toBe(false);
    original.send("/plan approve");
    await original.expectOutput("Plan approved!");
    original.send("/exit");
    expect((await original.finished).code).toBe(0);

    const conflicting = launch("--resume", "--permission-mode", "manual");
    await conflicting.expectOutput(
      "Requested permission mode conflicts with the approved plan",
    );
    expect((await conflicting.finished).code).toBe(1);
    expect(requests).toHaveLength(2);

    replies.push(
      write(otherFile, "outside"),
      write(approvedFile, "approved content"),
      write(approvedFile, "approved content"),
      say("Approved work finished"),
    );
    const resumed = launch("--resume");
    await resumed.expectOutput("[plan:exec] > ");
    resumed.send("/permissions");
    await resumed.expectOutput("Current mode: trusted");
    resumed.send("/permissions autopilot");
    await resumed.expectOutput(
      "The approved plan locks the current permission mode",
    );
    resumed.send("Apply the approved edit");
    await resumed.expectOutput("Approved work finished");
    expect(readFileSync(approvedFile, "utf8")).toBe("approved content");
    expect(existsSync(otherFile)).toBe(false);
    const toolResults = (request) =>
      request.messages
        .filter((message) => message.role === "tool")
        .map((message) => JSON.parse(message.content));
    expect(toolResults(requests[1]).at(-1)?.error).toContain("[Plan Mode]");
    expect(toolResults(requests.at(-1)).slice(-3)).toMatchObject([
      { code: "CC_PLAN_TOOL_ARGS_NOT_APPROVED" },
      { success: true, path: approvedFile },
      { code: "CC_PLAN_TOOL_ARGS_NOT_APPROVED" },
    ]);

    resumed.send("/plan exit");
    await resumed.expectOutput("Exited plan mode.");
    replies.push(
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "run_code",
              arguments: {
                language: "javascript",
                code: "console.log('fixture')",
              },
            },
          },
        ],
      },
      say("Approval wait finished"),
    );
    resumed.send("Try a tool that needs approval");
    const approvalOutput = await resumed.expectOutput(
      "task waiting  ·  approvals 1",
    );
    const waitingLine = approvalOutput
      .split(/\r?\n/u)
      .find((line) => line.includes("task waiting  ·  approvals 1"));
    expect(waitingLine).not.toMatch(/⛁|\(\d+%\)/u);
    await resumed.expectOutput("auto-denied");
    await resumed.expectOutput("Approval wait finished");
    expect(toolResults(requests.at(-1)).at(-1)?.error).toContain(
      "run_code denied",
    );
    resumed.send("/exit");
    expect((await resumed.finished).code).toBe(0);
    expect(replies).toHaveLength(0);
  } finally {
    for (const { child, finished } of processes) {
      if (child.exitCode === null) child.kill();
      await finished.catch(() => {});
    }
    await new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    });
    t.cleanup();
  }
}, 120_000);
