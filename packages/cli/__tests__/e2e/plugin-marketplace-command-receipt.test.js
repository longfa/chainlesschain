import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { CLI_BIN, testHome } from "./_helpers/cli-e2e.js";

const run = promisify(execFile);
const pluginName = "registry-command-receipt";
const diagnostic = "private fixture diagnostic";
const stderrDigest = createHash("sha256").update(diagnostic).digest("hex");

it("reports Git subprocess outcomes and MCP registration without launching the server", async () => {
  const t = testHome("install-source-receipt");
  try {
    const env = t.env({ APPDATA: t.configHome, XDG_CONFIG_HOME: t.configHome });
    const source = join(t.workspace, "plugin-source");
    mkdirSync(source);
    writeFileSync(
      join(source, "plugin.json"),
      JSON.stringify({ name: "git-receipt-fixture", version: "1.0.0" }),
    );
    const git = (...args) => run("git", ["-C", source, ...args], { env });
    await git("init");
    await git("add", "plugin.json");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=.",
      "commit",
      "-m",
      "Fixture plugin",
    );
    const call = (...args) =>
      run(process.execPath, [CLI_BIN, ...args], {
        cwd: source,
        env,
        timeout: 45_000,
      });
    const installed = await call(
      "plugin",
      "add",
      pathToFileURL(source).href,
      "--json",
    );
    expect(JSON.parse(installed.stdout).installCommand).toMatchObject({
      ran: true,
      exitCode: 0,
      timedOut: false,
      signaled: false,
      printedToStderr: true,
      stderrDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    const missing = pathToFileURL(join(t.workspace, "missing.git")).href;
    const failure = await call("plugin", "add", missing, "--json").catch(
      (error) => error,
    );
    expect(failure.code).toBe(1);
    expect(JSON.parse(failure.stdout).installCommand).toMatchObject({
      ran: true,
      exitCode: 128,
      printedToStderr: true,
    });

    const marker = join(t.workspace, "mcp-started.txt");
    const serverScript = t.writeScript(
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "started");`,
    );
    const registered = await call(
      "mcp",
      "add",
      "receipt-probe",
      "--scope",
      "project",
      "--command",
      process.execPath,
      "--args",
      serverScript,
      "--json",
    );
    expect(JSON.parse(registered.stdout).installCommand).toEqual({
      ran: false,
      exitCode: null,
      timedOut: false,
      signaled: false,
      printedToStderr: false,
      stderrDigest: createHash("sha256").digest("hex"),
    });
    expect(existsSync(marker)).toBe(false);
  } finally {
    t.cleanup();
  }
}, 60_000);

it.each([
  { action: "add", exitCode: 0 },
  { action: "add", exitCode: 17 },
  { action: "upgrade", exitCode: 0 },
  { action: "upgrade", exitCode: 17 },
])(
  "returns the registry installer receipt for $action with process exit $exitCode",
  async ({ action, exitCode }) => {
    const t = testHome("plugin-command-receipt");
    const source = join(t.workspace, "plugin-fixture");
    mkdirSync(source);
    const status = join(t.workspace, "install-status.txt");
    const installer = t.writeScript(`
    process.stderr.write(${JSON.stringify(diagnostic)});
    process.stdout.write(JSON.stringify({ source: process.argv[2] }));
    process.exitCode = Number(require("node:fs").readFileSync(process.argv[3], "utf8"));
  `);
    let registry;
    function offer(version, code) {
      const manifest = JSON.stringify({ name: pluginName, version });
      writeFileSync(join(source, "plugin.json"), manifest);
      writeFileSync(status, String(code));
      registry = JSON.stringify({
        plugins: [
          {
            name: pluginName,
            version,
            sha256: createHash("sha256").update(manifest).digest("hex"),
            source: {
              type: "command",
              executable: process.execPath,
              cwd: t.workspace,
              args: [installer, source, status],
            },
          },
        ],
      });
    }
    const server = createServer((_, res) => {
      res.writeHead(200, {
        "Content-Type": "application/json",
        Connection: "close",
      });
      res.end(registry);
    });
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const url = `http://127.0.0.1:${server.address().port}/registry.json`;
      const env = t.env({
        APPDATA: t.configHome,
        XDG_CONFIG_HOME: t.configHome,
        CC_PLUGIN_TRANSACTION_HOME: join(t.configHome, "plugin-transactions"),
        NO_PROXY: "127.0.0.1",
        no_proxy: "127.0.0.1",
      });
      const options = { cwd: t.workspace, env, timeout: 45_000 };
      const call = (command) =>
        run(
          process.execPath,
          [
            CLI_BIN,
            "plugin",
            command,
            pluginName,
            "--registry",
            url,
            "--scope",
            "project",
            "--json",
            ...(command === "upgrade" ? ["--allow-source-switch"] : []),
          ],
          options,
        );
      const version = action === "upgrade" ? "2.0.0" : "1.0.0";
      if (action === "upgrade") {
        offer("1.0.0", 0);
        const installed = await call("add");
        expect(JSON.parse(installed.stdout).version).toBe("1.0.0");
      }
      offer(version, exitCode);
      const result = await call(action).catch((error) => error);

      expect(result.code, result.stderr).toBe(exitCode === 0 ? undefined : 1);
      expect(result.stdout, result.stderr).not.toBe("");
      const receipt = JSON.parse(result.stdout);
      expect(receipt.installCommand).toEqual({
        ran: true,
        exitCode,
        timedOut: false,
        signaled: false,
        printedToStderr: true,
        stderrDigest,
      });
      expect(result.stdout + result.stderr).not.toContain(diagnostic);
      if (exitCode === 0) {
        expect(receipt).toMatchObject({ name: pluginName, version });
      } else {
        expect(receipt.error.code).toBe(
          "CC_MARKETPLACE_COMMAND_SOURCE_PROCESS_FAILED",
        );
        expect(receipt).not.toHaveProperty("name");
      }
      if (action === "upgrade") {
        const pointer = join(
          t.workspace,
          ".chainlesschain",
          "plugins",
          pluginName,
          ".active",
        );
        expect(readFileSync(pointer, "utf8").trim()).toBe(
          exitCode === 0 ? "2.0.0" : "1.0.0",
        );
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      t.cleanup();
    }
  },
);
