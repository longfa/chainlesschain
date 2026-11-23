import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BackgroundTaskManager } from "../../src/harness/background-task-manager.js";
import { CLI_BIN, testHome } from "../e2e/_helpers/cli-e2e.js";

const overlapMs = 120_000;
const execute = promisify(execFile);
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

async function ownTask(name) {
  const manager = new BackgroundTaskManager();
  const marker = join(process.cwd(), `${name}.pid`);
  const script = join(process.cwd(), `${name}.cjs`);
  writeFileSync(
    script,
    "const fs = require('node:fs'); const marker = process.argv[2];" +
      "fs.writeFileSync(marker + '.tmp', String(process.pid));" +
      "fs.renameSync(marker + '.tmp', marker);" +
      "setTimeout(() => {}, 300_000);",
  );
  const command = [process.execPath, script, marker].map(quote).join(" ");
  const task = manager.run({ type: "shell", command, cwd: process.cwd() });

  try {
    const controller = new AbortController();
    process.once("disconnect", () => controller.abort());
    const requested = once(process, "message", { signal: controller.signal });
    process.send({ taskId: task.id });
    await requested.catch((error) => {
      if (error.name !== "AbortError") throw error;
    });
    manager.stop(task.id);
    const deadline = performance.now() + 12_000;
    while (!manager.tasks.get(task.id)?.stopContract?.confirmed) {
      assert.ok(
        performance.now() < deadline,
        "owning process did not confirm stop",
      );
      await delay(100);
    }
    const events = manager.getHistory(task.id).map(({ event }) => event);
    if (process.connected) {
      await new Promise((resolve, reject) => {
        process.send({ events }, (error) =>
          error ? reject(error) : resolve(),
        );
      });
    }
  } finally {
    manager.destroy();
    if (process.connected) process.disconnect();
  }
}

async function verifyReclaim() {
  assert.ok(["darwin", "linux"].includes(process.platform));
  const t = testHome("long-task-reclaim");
  const env = t.env({ APPDATA: t.configHome, NO_COLOR: "1" });
  const options = { cwd: t.workspace, env };
  const owners = [];

  async function status(activeOnly = false) {
    const args = [CLI_BIN, "tasks", "--json"];
    if (activeOnly) args.push("--active-only");
    const { stdout } = await execute(process.execPath, args, {
      ...options,
      timeout: 45_000,
    });
    return new Map(JSON.parse(stdout).tasks.map((task) => [task.taskId, task]));
  }

  async function launch(name) {
    const child = fork(fileURLToPath(import.meta.url), ["--owner", name], {
      ...options,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const done = once(child, "exit");
    done.catch(() => {});
    const owner = { child, done };
    owners.push(owner);
    [{ taskId: owner.taskId }] = await once(child, "message", {
      signal: AbortSignal.timeout(35_000),
    });
    const marker = join(t.workspace, `${name}.pid`);
    const deadline = performance.now() + 15_000;
    while (!existsSync(marker)) {
      assert.ok(
        performance.now() < deadline,
        "shell did not spawn a native child",
      );
      await delay(100);
    }
    owner.pid = Number(readFileSync(marker, "utf8"));
    assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0);
    return owner;
  }

  async function stop(owner) {
    const receipt = once(owner.child, "message", {
      signal: AbortSignal.timeout(20_000),
    });
    owner.child.send({ stop: true });
    const [{ events }] = await receipt;
    assert.deepEqual(
      events.filter((event) => /^stop_/u.test(event)).slice(-2),
      ["stop_requested", "stop_confirmed"],
    );
    const exited = await Promise.race([
      owner.done,
      delay(20_000, null, { ref: false }),
    ]);
    assert.deepEqual(exited, [0, null]);
    assert.throws(() => process.kill(owner.pid, 0), { code: "ESRCH" });
  }

  try {
    const a = await launch("first");
    const b = await launch("second");
    assert.notEqual(a.pid, b.pid);
    assert.notEqual(a.taskId, b.taskId);
    const started = performance.now();
    let observations = 0;
    let observedOverlap;
    do {
      const visible = await status(true);
      assert.equal(visible.size, 2);
      for (const owner of [a, b]) {
        const record = visible.get(owner.taskId);
        assert.equal(record?.source, "background-shell");
        assert.equal(record?.state, "running");
        assert.equal(record?.stopPath, null);
        process.kill(owner.pid, 0);
      }
      observations += 1;
      observedOverlap = performance.now() - started;
      if (observedOverlap < overlapMs) {
        await delay(Math.min(30_000, overlapMs - observedOverlap));
      }
    } while (observedOverlap < overlapMs);

    await stop(a);
    const betweenStops = await status();
    assert.equal(betweenStops.get(a.taskId)?.state, "cancelled");
    assert.equal(betweenStops.get(b.taskId)?.state, "running");
    process.kill(b.pid, 0);
    await stop(b);
    assert.equal((await status(true)).size, 0);
    console.log(
      JSON.stringify({
        platform: process.platform,
        architecture: process.arch,
        observedOverlapMs: Math.round(observedOverlap),
        runningObservations: observations,
        stoppedPids: 2,
        activeAfterBoth: 0,
      }),
    );
  } finally {
    for (const { child } of owners) {
      if (child.connected) child.disconnect();
    }
    await Promise.allSettled(owners.map(({ done }) => done));
    t.cleanup();
  }
}

if (process.argv[2] === "--owner") {
  await ownTask(process.argv[3]);
} else {
  await verifyReclaim();
}
