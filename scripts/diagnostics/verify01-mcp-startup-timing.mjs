import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readPrereleasePackages,
  verifyPrereleaseCliInstallation,
} from "../../packages/cli/scripts/verify01-prerelease-package-set.mjs";

const [manifestFile, archiveDirectory, installDirectory, outputFile] =
  process.argv.slice(2);
assert.ok(manifestFile && archiveDirectory && installDirectory && outputFile);
const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
const { binding } = readPrereleasePackages(
  manifest,
  path.resolve(archiveDirectory),
);
const packageRoot = path.resolve(
  installDirectory,
  "node_modules/chainlesschain",
);
const lock = JSON.parse(
  await fs.readFile(path.join(installDirectory, "package-lock.json"), "utf8"),
);
const installation = verifyPrereleaseCliInstallation(
  binding,
  lock,
  packageRoot,
);
const { spawn } = createRequire(path.join(packageRoot, "package.json"))(
  "node-pty",
);
const temp = await fs.realpath(tmpdir());
const fixture = await fs.mkdtemp(path.join(temp, "cc-verify01-mcp-startup-"));
const workspace = path.join(fixture, "workspace");
const home = path.join(fixture, "home");
const trace = path.join(fixture, "launches.log");
const server = path.join(fixture, "server.mjs");
const config = path.join(fixture, "mcp.json");
const serverNames = [
  "required",
  "optional1",
  "optional2",
  "optional3",
  "optional4",
  "optional5",
];
const worker = new URL(
  "../../packages/cli/scripts/cli-reliability-mcp-server.mjs",
  import.meta.url,
).href;

async function measure() {
  await fs.writeFile(trace, "");
  const started = performance.now();
  const terminal = spawn(
    process.execPath,
    [
      path.join(packageRoot, "bin/chainlesschain.js"),
      "agent",
      "--provider",
      "ollama",
      "--model",
      "verify01-mcp-timing",
      "--base-url",
      "http://127.0.0.1:9",
      "--strict-mcp-config",
      "--mcp-config",
      config,
      "--ax-screen-reader",
    ],
    {
      cwd: workspace,
      env: {
        ...Object.fromEntries(
          [
            "PATH",
            "Path",
            "HOME",
            "USERPROFILE",
            "SYSTEMROOT",
            "SystemRoot",
            "TEMP",
            "TMP",
            "TMPDIR",
            "APPDATA",
            "LOCALAPPDATA",
            "COMSPEC",
            "PATHEXT",
          ]
            .filter((key) => process.env[key] !== undefined)
            .map((key) => [key, process.env[key]]),
        ),
        CHAINLESSCHAIN_HOME: home,
        CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(fixture, "security"),
        CC_MCP_EXECUTABLE_TRUST: "1",
        TERM: "xterm-256color",
      },
      name: "xterm-256color",
      cols: 110,
      rows: 36,
    },
  );
  const retired = Promise.withResolvers();
  let output = "";
  let readyMs;
  const exitListener = terminal.onExit(({ exitCode }) =>
    retired.resolve(exitCode),
  );
  const dataListener = terminal.onData((chunk) => {
    output = (output + chunk).slice(-32_768);
    const plain = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    const visiblePrompt =
      plain.includes("Type /exit to quit, /help for commands") &&
      (/(?:^|[\r\n])>$/u.test(plain.trimEnd()) ||
        /Type \/exit to quit, \/help for commands[\s\S]*>\x1b\[K/u.test(
          output,
        ));
    if (readyMs === undefined && visiblePrompt) {
      readyMs = Math.round(performance.now() - started);
      terminal.write("/exit\r");
    }
  });
  const timer = setTimeout(() => {
    retired.reject(
      new Error(
        `Terminal deadline exceeded (prompt observed: ${readyMs !== undefined})`,
      ),
    );
    try {
      terminal.kill();
    } catch {
      // The rejected deadline remains authoritative if the terminal just exited.
    }
  }, 75_000);
  try {
    const exitCode = await retired.promise;
    assert.equal(exitCode, 0);
    assert.ok(readyMs !== undefined, "first interactive prompt missing");
    const launches = (await fs.readFile(trace, "utf8"))
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    return { readyMs, launches, exitCode };
  } finally {
    clearTimeout(timer);
    dataListener.dispose();
    exitListener.dispose();
  }
}

try {
  await fs.mkdir(workspace);
  await fs.mkdir(home);
  await fs.writeFile(
    server,
    `import { appendFileSync } from "node:fs";
appendFileSync(process.argv[2], process.argv[3] + "\\n");
await new Promise((resolve) => setTimeout(resolve, 1100));
await import(${JSON.stringify(worker)});
`,
  );
  await fs.writeFile(
    config,
    JSON.stringify({
      mcpServers: Object.fromEntries(
        serverNames.map((name) => [
          name,
          {
            command: process.execPath,
            args: [server, trace, name],
            ...(name === "required"
              ? {}
              : { startOnDemand: true, discoveryCache: true }),
          },
        ]),
      ),
    }),
  );
  const cold = await measure();
  assert.deepEqual(cold.launches, serverNames);
  const warm = await measure();
  assert.deepEqual(warm.launches, ["required"]);
  const { sourceCommit, runId, artifactId, sourceFilesVerified, locked } =
    installation;
  const evidence = {
    sourceCommit,
    runId,
    artifactId,
    sourceFilesVerified,
    cliIntegrity: locked.integrity,
    cliVersion: manifest.versions.cli,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cold,
    warm,
  };
  await fs.writeFile(outputFile, JSON.stringify(evidence, null, 2) + "\n");
  await new Promise((resolve, reject) =>
    process.stdout.write(`${JSON.stringify(evidence)}\n`, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
} finally {
  assert.equal(path.dirname(await fs.realpath(fixture)), temp);
  await fs.rm(fixture, { recursive: true, force: true });
}
// node-pty can retain a ConPTY handle after both CLI children have exited.
process.exit(0);
