import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CLI_BIN, testHome } from "../e2e/_helpers/cli-e2e.js";

const { values } = parseArgs({
  options: { "stdout-only": { type: "boolean" } },
});
const stdoutOnly = values["stdout-only"];
if (!stdoutOnly) {
  assert.equal(process.platform, "linux", "Linux mount fixtures are required");
}
const mounts = stdoutOnly
  ? {}
  : {
      ENOSPC: process.env.CC_CLI_RELIABILITY_DISK_ENOSPC_HOME,
      EROFS: process.env.CC_CLI_RELIABILITY_DISK_EROFS_HOME,
    };
const uninitializedHome = stdoutOnly
  ? null
  : process.env.CC_CLI_RELIABILITY_DISK_UNINITIALIZED_HOME;
for (const [fsCode, mount] of Object.entries(mounts)) {
  assert.ok(mount, `Configure the ${fsCode} session mount before running`);
  const marker = join(
    mount,
    "sessions",
    `.headless-native-probe-${randomUUID()}`,
  );
  try {
    assert.throws(() => writeFileSync(marker, "probe", { flag: "wx" }), {
      code: fsCode,
    });
  } finally {
    if (existsSync(marker)) unlinkSync(marker);
  }
}

const t = testHome("headless-native-filesystem");
const reply = "Native delivery fixture";
let calls = 0;
const server = createServer(async (request, response) => {
  if (request.url !== "/api/chat") return response.writeHead(404).end();
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const { stream } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  calls += 1;
  response.setHeader(
    "Content-Type",
    stream ? "application/x-ndjson" : "application/json",
  );
  response.end(
    JSON.stringify({
      message: { role: "assistant", content: reply },
      done: true,
      prompt_eval_count: 4,
      eval_count: 2,
    }) + (stream ? "\n" : ""),
  );
});

function run(
  format,
  { stdoutFd = "pipe", home = t.home, sessionId, sandboxModeOff = true } = {},
) {
  const stream = format === "stream-json";
  const child = spawn(
    process.execPath,
    [
      CLI_BIN,
      "agent",
      "--provider",
      "ollama",
      "--model",
      "fixture",
      "--base-url",
      `http://127.0.0.1:${server.address().port}`,
      "--no-mcp",
      "--no-ide",
      "--no-recall-memory",
      "--no-checkpoint",
      "--bare",
      ...(sandboxModeOff ? ["--sandbox-mode", "off"] : []),
      "--output-format",
      format,
      ...(stream
        ? ["--input-format", "stream-json"]
        : ["-p", "Answer the fixture"]),
      ...(sessionId ? ["--session", sessionId] : ["--ephemeral"]),
    ],
    {
      cwd: t.workspace,
      env: t.env({ CHAINLESSCHAIN_HOME: home }),
      stdio: [stream ? "pipe" : "ignore", stdoutFd, "pipe"],
    },
  );
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (data) => (stdout += data));
    child.stderr.setEncoding("utf8").on("data", (data) => (stderr += data));
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    if (stream) {
      child.stdin.on("error", () => {});
      child.stdin.end(
        `${JSON.stringify({ type: "user", text: "Answer the fixture" })}\n`,
      );
    }
  });
}

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  for (const format of ["json", "stream-json"]) {
    if (uninitializedHome) {
      const startup = await run(format, {
        home: uninitializedHome,
        sessionId: `uninitialized-${format}`,
        sandboxModeOff: false,
      });
      assert.equal(startup.code, 1, JSON.stringify(startup));
      const result = JSON.parse(startup.stdout.trim());
      assert.equal(result.type, "result");
      assert.equal(result.subtype, "error_startup");
      assert.equal(result.is_error, true);
      assert.equal(result.code, "CC_AGENT_SESSION_PREPARATION_FAILED");
      assert.equal(calls, 0);
      console.log(
        JSON.stringify({
          case: "uninitialized-home",
          format,
          exitCode: startup.code,
          modelCalls: calls,
        }),
      );
    }
    for (const [fsCode, home] of Object.entries(mounts)) {
      const result = await run(format, {
        home,
        sessionId: `disk-${format}-${fsCode.toLowerCase()}`,
        sandboxModeOff: false,
      });
      assert.equal(result.code, 1, JSON.stringify(result));
      assert.notEqual(result.stdout.trim(), "", JSON.stringify(result));
      const events =
        format === "json"
          ? [JSON.parse(result.stdout)]
          : result.stdout
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line));
      const failure = events.find(
        (event) => event.subtype === "error_persistence",
      );
      assert.equal(failure?.is_error, true, JSON.stringify(result));
      assert.equal(failure.persistence.fs_code, fsCode);
      assert.equal(failure.persistence.phase, "before-model");
      assert.equal(calls, 0);
      console.log(
        JSON.stringify({
          case: fsCode,
          format,
          exitCode: result.code,
          modelCalls: calls,
          persistence: failure.persistence,
        }),
      );

      const audit = await run(format, {
        home,
        sessionId: `audit-${format}-${fsCode.toLowerCase()}`,
      });
      assert.equal(audit.code, 6, JSON.stringify(audit));
      const auditResult = JSON.parse(audit.stdout.trim());
      assert.equal(auditResult.type, "result");
      assert.equal(auditResult.subtype, "error_persistence");
      assert.equal(auditResult.is_error, true);
      assert.equal(auditResult.code, "CC_SESSION_PERSISTENCE_FAILED");
      assert.equal(auditResult.error, "Security audit write failed");
      assert.equal(auditResult.persistence.fs_code, fsCode);
      assert.equal(auditResult.persistence.operation, "session-start");
      assert.equal(auditResult.persistence.phase, "before-model");
      assert.equal(calls, 0);
      console.log(
        JSON.stringify({
          case: `startup-audit-${fsCode}`,
          format,
          exitCode: audit.code,
          modelCalls: calls,
          persistence: auditResult.persistence,
        }),
      );
    }
  }
  const destination = stdoutOnly
    ? t.writeScript("unchanged stdout file")
    : "/dev/full";
  const stdoutFd = openSync(destination, stdoutOnly ? "r" : "w");
  try {
    for (const format of ["json", "stream-json"]) {
      const control = await run(format);
      assert.equal(control.code, 0, JSON.stringify(control));
      const records = control.stdout
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line));
      if (format === "json") assert.equal(records.length, 1);
      const results = records.filter((record) => record.type === "result");
      assert.equal(results.length, 1, JSON.stringify(records));
      assert.equal(results[0].result, reply);
      assert.equal(results[0].is_error, false);

      const before = calls;
      const result = await run(format, { stdoutFd });
      assert.equal(result.code, 1, JSON.stringify(result));
      assert.equal(result.signal, null);
      const expectedError = stdoutOnly
        ? /EBADF|bad file descriptor/i
        : /ENOSPC|no space left|output stream/i;
      const diagnostic = result.stderr
        .split(/\r?\n/u)
        .find((line) => expectedError.test(line));
      assert.ok(diagnostic, JSON.stringify(result));
      if (stdoutOnly)
        assert.equal(
          readFileSync(destination, "utf8"),
          "unchanged stdout file",
        );
      console.log(
        JSON.stringify({
          case: stdoutOnly ? "stdout-read-only-descriptor" : "stdout-/dev/full",
          platform: process.platform,
          arch: process.arch,
          format,
          controlExitCode: control.code,
          exitCode: result.code,
          diagnostic,
          modelCalls: calls - before,
        }),
      );
    }
  } finally {
    closeSync(stdoutFd);
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  t.cleanup();
}
