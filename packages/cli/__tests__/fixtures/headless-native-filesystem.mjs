import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { CLI_BIN, testHome } from "../e2e/_helpers/cli-e2e.js";

assert.equal(process.platform, "linux", "Linux mount fixtures are required");
const mounts = {
  ENOSPC: process.env.CC_CLI_RELIABILITY_DISK_ENOSPC_HOME,
  EROFS: process.env.CC_CLI_RELIABILITY_DISK_EROFS_HOME,
};
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
let calls = 0;
const server = createServer((request, response) => {
  request.resume();
  if (request.url !== "/api/chat") return response.writeHead(404).end();
  calls += 1;
  response.setHeader("Content-Type", "application/json");
  response.end(
    JSON.stringify({
      message: { role: "assistant", content: "Linux delivery fixture" },
      done: true,
      prompt_eval_count: 4,
      eval_count: 2,
    }),
  );
});

function run(format, { stdoutFd = "pipe", home = t.home, sessionId } = {}) {
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
      "--sandbox-mode",
      "off",
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
    for (const [fsCode, home] of Object.entries(mounts)) {
      const result = await run(format, {
        home,
        sessionId: `disk-${format}-${fsCode.toLowerCase()}`,
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
    }
  }
  const control = await run("json");
  assert.equal(control.code, 0, JSON.stringify(control));
  assert.equal(JSON.parse(control.stdout).result, "Linux delivery fixture");
  const full = openSync("/dev/full", "w");
  try {
    for (const format of ["json", "stream-json"]) {
      const before = calls;
      const result = await run(format, { stdoutFd: full });
      assert.equal(result.code, 1, JSON.stringify(result));
      assert.match(result.stderr, /ENOSPC|no space left|output stream/i);
      console.log(
        JSON.stringify({
          case: "stdout-/dev/full",
          format,
          exitCode: result.code,
          modelCalls: calls - before,
        }),
      );
    }
  } finally {
    closeSync(full);
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  t.cleanup();
}
