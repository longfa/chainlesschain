"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { parseArgs, promisify } = require("node:util");
const { reserveLoopbackPort } = require("./cdp-journey.cjs");
const {
  resolveConfiguredRuntime,
  runConfiguredVsCodeCommand,
} = require("./configured-runtime.cjs");

const exec = promisify(execFile);
const cli = path.resolve(__dirname, "../../../cli/bin/chainlesschain.js");
const source = "native-fork-original";
const sharedReply = "Shared reply for the native fork";
const model = "native-fork-fixture";
const workflowId = "native-fork-workflow";
const runId = "native-fork-active-run";

function writeCliShim(root, port) {
  const shim = path.join(root, "fixture-cli.cjs");
  fs.writeFileSync(
    shim,
    `
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'agent') args.push('--base-url', 'http://127.0.0.1:${port}', '--sandbox-mode', 'off', '--no-mcp', '--bare');
const stdio = ['inherit', 'inherit', 'inherit'];
const child = spawn(process.execPath, [${JSON.stringify(cli)}, ...args], { stdio, windowsHide: true });
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
`,
  );
  if (process.platform === "win32") {
    const command = path.join(root, "cc.cmd");
    fs.writeFileSync(
      command,
      `@echo off\r\n"${process.execPath}" "${shim}" %*\r\n`,
    );
    return command;
  }
  const command = path.join(root, "cc");
  const quote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
  fs.writeFileSync(
    command,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(shim)} "$@"\n`,
    { mode: 0o700 },
  );
  return command;
}

async function launchWorkflow(cwd, finish) {
  const { Command } = require("commander");
  const { registerCoworkCommand } =
    await import("../../../cli/src/commands/cowork.js");
  const { saveWorkflow } =
    await import("../../../cli/src/lib/cowork-workflow.js");
  const { createExecutionLocationBinding } =
    await import("../../../cli/src/lib/execution-location-contract.js");
  const permission = {
    file: "read",
    shell: false,
    network: false,
    mcp: false,
    externalSystems: false,
  };
  saveWorkflow(cwd, {
    id: workflowId,
    name: "Native fork workflow",
    steps: [{ id: "collect", message: "Collect fixture evidence" }],
    facade: {
      requirements: {
        capabilities: ["cowork-task", "dag", "variables"],
        executionLocations: ["local"],
        permissions: permission,
        sandbox: "strong",
        dataBoundary: "repository",
        credentials: [],
      },
      estimates: {
        tokensPerTask: 10,
        usdPerTask: 0.01,
        durationMsPerTask: 1000,
      },
      budget: {
        maxExpandedTasks: 2,
        maxParallel: 1,
        maxTokens: 100,
        maxUsd: 1,
        maxDurationMs: 10000,
      },
    },
  });
  const entered = Promise.withResolvers();
  const program = new Command().exitOverride();
  const observedAt = new Date().toISOString();
  registerCoworkCommand(program, {
    workflowExecutionAuthorityProvider: () => ({
      sessionId: source,
      headHash: "d".repeat(64),
      eventCount: 3,
      binding: createExecutionLocationBinding({
        location: "local",
        observed: true,
        observedAt,
        source: { cwd, git: { root: cwd, commit: "a".repeat(40) } },
        runtime: {
          platform: process.platform,
          arch: process.arch,
          tools: ["node"],
        },
        model: { provider: "fixture", name: model, credentialSource: "none" },
        permissions: { status: "declared", ...permission },
        policy: {
          network: "offline",
          sandbox: "strong",
          dataBoundary: { kind: "repository", root: cwd },
        },
      }),
    }),
    workflowRunTask: async () => {
      entered.resolve();
      await finish;
      return {
        taskId: "fixture-collect",
        status: "completed",
        result: { summary: "collected" },
      };
    },
  });
  const completion = program.parseAsync(
    [
      "cowork",
      "workflow",
      "run",
      workflowId,
      "--execution-authority-session",
      source,
      "--durable-run-id",
      runId,
    ],
    { from: "user" },
  );
  await Promise.race([
    entered.promise,
    completion.then(() => {
      throw new Error("Workflow exited before entering its task");
    }),
  ]);
  return { completion };
}

async function main() {
  const { values } = parseArgs({
    options: Object.fromEntries(
      ["vscode-executable", "vscode-version", "vsix"].map((key) => [
        key,
        { type: "string" },
      ]),
    ),
  });
  for (const key of ["vscode-executable", "vscode-version", "vsix"])
    assert.ok(values[key], `--${key} is required`);
  const vsix = path.resolve(values.vsix);
  const runtime = resolveConfiguredRuntime(
    values["vscode-executable"],
    values["vscode-version"],
  );
  const { testHome } =
    await import("../../../cli/__tests__/e2e/_helpers/cli-e2e.js");
  const t = testHome("native-fork");
  const originalCwd = process.cwd();
  const workspace = fs.realpathSync(t.workspace);
  const env = t.env({
    APPDATA: t.configHome,
    XDG_CONFIG_HOME: t.configHome,
    CC_API_KEY: "",
  });
  for (const key of [
    "NODE_OPTIONS",
    "ELECTRON_RUN_AS_NODE",
    "VSCODE_IPC_HOOK_CLI",
  ])
    delete env[key];
  // This standalone runner owns its environment and working directory.
  Object.assign(process.env, env);
  process.chdir(workspace);
  const replies = new Map();
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url !== "/api/chat") return res.writeHead(404).end();
    const { messages, stream } = JSON.parse(body);
    const text = messages
      .filter((message) => message.role === "user")
      .at(-1)?.content;
    const branch =
      text === "Run the source tab"
        ? "source"
        : text === "Run the fork tab"
          ? "fork"
          : null;
    if (!branch) return res.writeHead(400).end();
    const count = (replies.get(branch) || 0) + 1;
    replies.set(branch, count);
    const message =
      count === 1
        ? {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `write-${branch}`,
                type: "function",
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({
                    path: path.join(workspace, `${branch}.txt`),
                    content: branch,
                  }),
                },
              },
            ],
          }
        : { role: "assistant", content: `Native ${branch} turn completed` };
    res.writeHead(200, {
      "Content-Type": stream ? "application/x-ndjson" : "application/json",
      Connection: "close",
    });
    res.end(
      JSON.stringify({
        message,
        done: true,
        prompt_eval_count: 4,
        eval_count: 2,
      }) + "\n",
    );
  });
  const release = Promise.withResolvers();
  let workflow;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const store =
      await import("../../../cli/src/harness/jsonl-session-store.js");
    const { readSessionTranscriptHistory } =
      await import("../../../cli/src/lib/session-transcript-history.js");
    const { loadSideEffectLedger } =
      await import("../../../cli/src/lib/side-effect-ledger-store.js");
    store.startSession(source, { provider: "ollama", model });
    store.appendUserMessage(source, "Shared prompt for the native fork");
    store.appendAssistantMessage(source, sharedReply);
    workflow = await launchWorkflow(workspace, release.promise);
    const { stdout } = await exec(
      process.execPath,
      [cli, "tasks", "--json", "--active-only"],
      { cwd: workspace, env, timeout: 45_000 },
    );
    const active = JSON.parse(stdout).tasks.filter(
      (task) => task.source === "cowork",
    );
    assert.equal(active.length, 1);
    assert.equal(active[0].taskId, runId);
    assert.equal(active[0].state, "running");

    const profile = path.join(t.userHome, "profile");
    const extensions = path.join(t.userHome, "extensions");
    fs.mkdirSync(path.join(profile, "User"), { recursive: true });
    fs.mkdirSync(extensions);
    const cliCommand = writeCliShim(t.configHome, server.address().port);
    fs.writeFileSync(
      path.join(profile, "User", "settings.json"),
      JSON.stringify({
        "chainlesschain.cli.path": cliCommand,
        "chainlesschain.cli.managed.enabled": false,
        "chainlesschain.ide.enabled": false,
        "chainlesschain.chat.provider": "ollama",
        "chainlesschain.chat.model": model,
        "update.mode": "none",
        "extensions.autoUpdate": false,
        "telemetry.telemetryLevel": "off",
        "chat.disableAIFeatures": true,
        "workbench.startupEditor": "none",
      }),
    );
    const profileArgs = [
      "--user-data-dir",
      profile,
      "--extensions-dir",
      extensions,
    ];
    const install = await runConfiguredVsCodeCommand(runtime, [
      ...profileArgs,
      "--install-extension",
      vsix,
    ]);
    assert.match(install.stdout, /successfully installed/);
    const cdpPort = await reserveLoopbackPort();
    const receipt = path.join(t.configHome, "host-receipt.json");
    const { runTests } = require("@vscode/test-electron");
    await runTests({
      vscodeExecutablePath: runtime.executablePath,
      extensionDevelopmentPath: path.join(__dirname, "driver"),
      extensionTestsPath: path.join(__dirname, "driver", "session-fork.cjs"),
      launchArgs: [
        ...profileArgs,
        `--remote-debugging-port=${cdpPort}`,
        "--remote-debugging-address=127.0.0.1",
        `--remote-allow-origins=http://127.0.0.1:${cdpPort}`,
        "--disable-workspace-trust",
        "--disable-updates",
        "--disable-telemetry",
        "--skip-welcome",
        "--skip-release-notes",
        workspace,
      ],
      extensionTestsEnv: {
        ...env,
        CC_NATIVE_FORK_TEST: JSON.stringify({
          source,
          sharedReply,
          cdpPort,
          receipt,
          active: active[0],
          extensions,
        }),
      },
    }).catch((error) => {
      const diagnostics = `${receipt}.error`;
      if (fs.existsSync(diagnostics))
        throw new Error(fs.readFileSync(diagnostics, "utf8"), { cause: error });
      throw error;
    });
    const ui = JSON.parse(fs.readFileSync(receipt, "utf8"));
    assert.equal(ui.vscode, runtime.receipt.version);
    assert.match(ui.fork, /^session-fork-[a-f0-9]{32}$/u);
    const responses = (id) =>
      readSessionTranscriptHistory(id)
        .messages.filter(({ role, text }) => role === "assistant" && text)
        .map(({ text }) => text);
    assert.deepEqual(responses(source), [
      sharedReply,
      "Native source turn completed",
    ]);
    assert.deepEqual(responses(ui.fork), [
      sharedReply,
      "Native fork turn completed",
    ]);
    for (const [id, branch] of [
      [source, "source"],
      [ui.fork, "fork"],
    ]) {
      const file = path.join(workspace, `${branch}.txt`);
      assert.equal(fs.readFileSync(file, "utf8"), branch);
      assert.deepEqual(
        loadSideEffectLedger(id)
          .list()
          .map(({ key, kind, state }) => ({ key, kind, state })),
        [{ key: file, kind: "file-write", state: "committed" }],
      );
    }
    assert.deepEqual(Object.fromEntries(replies), { source: 2, fork: 2 });
    console.log(
      JSON.stringify({
        ...ui,
        independentTranscripts: true,
        independentSideEffectLedgers: true,
      }),
    );
  } finally {
    release.resolve();
    try {
      await workflow?.completion;
    } finally {
      await new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      });
      process.chdir(originalCwd);
      t.cleanup();
    }
  }
}

main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
