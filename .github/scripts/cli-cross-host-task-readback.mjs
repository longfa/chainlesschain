import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const entry = fileURLToPath(import.meta.url);
const run = promisify(execFile);
const version = "0.166.162";
const observeForMs = 150_000;

async function own(name, managerPath) {
  const { BackgroundTaskManager } = await import(pathToFileURL(managerPath));
  const manager = new BackgroundTaskManager();
  const marker = join(process.cwd(), name + ".pid");
  const workload = join(process.cwd(), name + ".cjs");
  writeFileSync(workload, "require('node:fs').writeFileSync(" + JSON.stringify(marker) + ",String(process.pid));setTimeout(()=>{},300000);");
  const shellArg = (value) => '"' + value.replaceAll("\\", "/") + '"';
  const task = manager.run({ command: shellArg(process.execPath) + " " + shellArg(workload), cwd: process.cwd() });
  let stopped;
  async function stop() {
    stopped ??= (async () => {
      manager.stop(task.id);
      const deadline = Date.now() + 20_000;
      while (manager.tasks.get(task.id)?.stopContract?.confirmed !== true && Date.now() < deadline) await delay(100);
      const confirmed = manager.tasks.get(task.id)?.stopContract?.confirmed === true;
      const stopEvents = manager.getHistory(task.id).map(({ event }) => event).filter((event) => event.startsWith("stop_"));
      manager.destroy();
      return { confirmed, stopEvents };
    })();
    return stopped;
  }
  process.once("message", async () => {
    const receipt = await stop();
    if (process.connected) process.send(receipt, () => process.exit(receipt.confirmed ? 0 : 1));
  });
  process.once("disconnect", async () => {
    const receipt = await stop();
    process.exit(receipt.confirmed ? 0 : 1);
  });
  process.send({ taskId: task.id });
}

async function acceptance(directory, startAt, output) {
  assert.ok(Number.isSafeInteger(startAt) && startAt > 0);
  const packageRoot = resolve(directory);
  const cli = join(packageRoot, "bin", "chainlesschain.js");
  const manager = join(packageRoot, "src", "harness", "background-task-manager.js");
  const temp = realpathSync(tmpdir());
  const root = mkdtempSync(join(temp, "cc-cross-host-tasks-"));
  const cwd = join(root, "workspace");
  const profile = join(root, "profile");
  const config = join(root, "config");
  for (const location of [cwd, profile, config]) mkdirSync(location);
  const env = {
    ...process.env, HOME: profile, USERPROFILE: profile, APPDATA: config,
    CHAINLESSCHAIN_HOME: config, CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: join(root, "anchors"),
    CC_UPDATE_NOTICE: "0", NO_COLOR: "1",
  };
  const options = { cwd, env, windowsHide: true };
  const owners = [];
  const samples = [];
  async function project(activeOnly = true) {
    const args = [cli, "tasks", "--json", ...(activeOnly ? ["--active-only"] : [])];
    const { stdout } = await run(process.execPath, args, { ...options, timeout: 50_000 });
    const receipt = JSON.parse(stdout);
    return new Map(receipt.tasks.map((record) => [record.taskId, record]));
  }
  async function startOwner(name) {
    const child = fork(entry, ["--owner", name, manager], { ...options, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    owners.push(child);
    const [record] = await once(child, "message", { signal: AbortSignal.timeout(30_000) });
    assert.ok(record.taskId);
    const marker = join(cwd, name + ".pid");
    const deadline = Date.now() + 20_000;
    while (!existsSync(marker) && Date.now() < deadline) await delay(100);
    const pid = Number(readFileSync(marker, "utf8"));
    assert.ok(pid > 0);
    return { child, id: record.taskId, pid };
  }
  async function stopOwner(owner) {
    const result = once(owner.child, "message", { signal: AbortSignal.timeout(25_000) });
    const stopped = once(owner.child, "exit", { signal: AbortSignal.timeout(25_000) });
    owner.child.send({ stop: true });
    const [[receipt], [exitCode]] = await Promise.all([result, stopped]);
    assert.equal(exitCode, 0);
    assert.ok(receipt.confirmed);
    assert.deepEqual(receipt.stopEvents.slice(-2), ["stop_requested", "stop_confirmed"]);
    const deadline = Date.now() + 7_000;
    while (true) {
      try { process.kill(owner.pid, 0); }
      catch (error) { assert.equal(error.code, "ESRCH"); return; }
      assert.ok(Date.now() < deadline, "stopped shell retains a native PID");
      await delay(100);
    }
  }
  try {
    const observed = await run(process.execPath, [cli, "--version"], { ...options, timeout: 45_000 });
    assert.equal(observed.stdout.trim(), version);
    assert.ok(Date.now() <= startAt + 10_000, "runner missed the rendezvous");
    if (startAt > Date.now()) await delay(startAt - Date.now());
    const [a, b] = await Promise.all([startOwner("owner-a"), startOwner("owner-b")]);
    assert.notEqual(a.pid, b.pid);
    assert.notEqual(a.id, b.id);
    const begin = Date.now();
    do {
      const active = await project();
      assert.equal(active.size, 2);
      for (const owner of [a, b]) {
        const record = active.get(owner.id);
        assert.equal(record?.source, "background-shell");
        assert.equal(record.state, "running");
        for (const field of ["endsAt", "waitingOn", "stopPath"]) assert.ok(Object.hasOwn(record, field));
        process.kill(owner.pid, 0);
      }
      samples.push(Date.now());
      console.log(JSON.stringify({ platform: process.platform, sample: samples.length, active: 2, overlapMs: samples.at(-1) - begin }));
      if (samples.at(-1) - begin < observeForMs) await delay(Math.min(28_000, observeForMs - (Date.now() - begin)));
    } while (samples.at(-1) - begin < observeForMs);
    await stopOwner(a);
    const afterA = await project(false);
    assert.equal(afterA.get(a.id)?.state, "cancelled");
    assert.equal(afterA.get(b.id)?.state, "running");
    process.kill(b.pid, 0);
    await stopOwner(b);
    assert.equal((await project()).size, 0);

    const summary = {
      schema: "chainlesschain-cross-host-task-acceptance/v1", cliVersion: version,
      ...(process.env.GITHUB_RUN_ID ? { actionsRunId: process.env.GITHUB_RUN_ID } : {}),
      platform: process.platform, arch: process.arch, node: process.version, startAt,
      firstConcurrentAt: begin, lastConcurrentAt: samples.at(-1), concurrentMs: samples.at(-1) - begin,
      readbacks: samples.length, independentOwners: 2, confirmedStops: 2, remainingActive: 0,
      runningTaskFields: ["state", "endsAt", "waitingOn", "stopPath"],
    };
    writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");
    console.log(JSON.stringify(summary));
  } finally {
    for (const child of owners) {
      if (child.connected) {
        const closed = once(child, "close", { signal: AbortSignal.timeout(25_000) }).catch(() => child.kill());
        child.disconnect();
        await closed;
      }
    }
    const verified = realpathSync(root);
    assert.equal(dirname(verified), temp);
    assert.ok(basename(verified).startsWith("cc-cross-host-tasks-"));
    rmSync(verified, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.argv[2] === "--owner") await own(process.argv[3], process.argv[4]);
else await acceptance(process.argv[2], Number(process.argv[3]), process.argv[4]);
