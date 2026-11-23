"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const {
  chooseQuickPickItem,
  findChatWebview,
  findWorkbenchWindow,
  sendComposer,
  waitForDom,
} = require("../cdp-journey.cjs");
const { withTimeout } = require("./view-control.cjs");

const activeTab =
  "document.querySelector('#tabs [role=tab][aria-selected=true]')";
const has = (text) =>
  `document.body.innerText.includes(${JSON.stringify(text)})`;

async function runJourney() {
  const { source, sharedReply, cdpPort, receipt, active, extensions } =
    JSON.parse(process.env.CC_NATIVE_FORK_TEST);
  const target = vscode.extensions.getExtension(
    "chainlesschain.chainlesschain-ide",
  );
  assert.ok(target);
  const installed = path.relative(
    fs.realpathSync(extensions),
    fs.realpathSync(target.extensionPath),
  );
  assert.ok(
    installed && !installed.startsWith("..") && !path.isAbsolute(installed),
  );
  await target.activate();
  await vscode.commands.executeCommand("notifications.clearAll");

  const { client: workbench } = await findWorkbenchWindow(cdpPort, 45_000);
  let chat;
  try {
    const map = vscode.commands.executeCommand("chainlesschain.workflows.map");
    const row = await (async () => {
      const expression = `(() => {
        const widget = document.querySelector('.quick-input-widget');
        const row = [...(widget?.querySelectorAll('.monaco-list-row') || [])]
          .find((r) => r.textContent.includes(${JSON.stringify(active.taskId)}));
        return row?.textContent || null;
      })()`;
      await waitForDom(
        workbench,
        `Boolean(${expression})`,
        "Workflow Map row",
        45_000,
      );
      return workbench.evaluate(expression);
    })();
    for (const value of [
      active.label,
      active.state,
      active.taskId,
      active.parentTaskId,
    ])
      assert.ok(row.includes(value), `Workflow Map row lacks ${value}: ${row}`);
    await chooseQuickPickItem(workbench, active.taskId);
    await map;

    await vscode.commands.executeCommand(
      "vscode.open",
      vscode.Uri.parse(
        `vscode://chainlesschain.chainlesschain-ide/open?session=${encodeURIComponent(source)}`,
      ),
    );
    ({ client: chat } = await findChatWebview(cdpPort, 45_000));
    const expectText = async (text, { settled = false } = {}) => {
      const condition = settled
        ? `[...document.querySelectorAll('#log [data-saved-row-id]')].some((row) => row.textContent === ${JSON.stringify(text)})`
        : has(text);
      try {
        await waitForDom(chat, condition, text, 45_000);
      } catch (error) {
        const visible = await chat.evaluate(
          "document.body.innerText.slice(-1600)",
        );
        throw new Error(`${error.message}\nVisible chat:\n${visible}`, {
          cause: error,
        });
      }
    };
    await expectText(sharedReply);
    const sourceTab = await chat.evaluate(`${activeTab}?.dataset.tabId`);
    assert.ok(sourceTab);
    await sendComposer(chat, "Run the source tab");
    await expectText("Native source turn completed", { settled: true });

    const forkAction = vscode.commands.executeCommand(
      "chainlesschain.sessions.fork",
    );
    await chooseQuickPickItem(workbench, sharedReply);
    await forkAction;
    await waitForDom(
      chat,
      `${activeTab}?.dataset.tabId !== ${JSON.stringify(sourceTab)}`,
      "fork tab selected",
      45_000,
    );
    await expectText(sharedReply);
    assert.equal(
      await chat.evaluate(has("Native source turn completed")),
      false,
    );
    const forkTab = await chat.evaluate(`${activeTab}?.dataset.tabId`);
    assert.ok(forkTab);
    assert.equal(
      await chat.evaluate(
        "document.querySelectorAll('#tabs [role=tab]').length",
      ),
      2,
    );
    const forkIdExpression =
      "document.body.innerText.match(/forked session (session-fork-[a-f0-9]{32})/)?.[1]";
    await waitForDom(
      workbench,
      `Boolean(${forkIdExpression})`,
      "fork session receipt",
      15_000,
    );
    const fork = await workbench.evaluate(forkIdExpression);

    await sendComposer(chat, "Run the fork tab");
    await expectText("Native fork turn completed", { settled: true });
    assert.equal(
      await chat.evaluate(has("Native source turn completed")),
      false,
    );
    for (const [id, ownReply, otherReply] of [
      [sourceTab, "Native source turn completed", "Native fork turn completed"],
      [forkTab, "Native fork turn completed", "Native source turn completed"],
    ]) {
      assert.equal(
        await chat.evaluate(`(() => {
        const tab = [...document.querySelectorAll('#tabs [role=tab]')]
          .find((t) => t.dataset.tabId === ${JSON.stringify(id)});
        if (!tab) return false;
        tab.click();
        return true;
      })()`),
        true,
      );
      await waitForDom(
        chat,
        `${activeTab}?.dataset.tabId === ${JSON.stringify(id)}`,
        "activated conversation tab",
        15_000,
      );
      await expectText(ownReply);
      assert.equal(await chat.evaluate(has(otherReply)), false);
    }
    fs.writeFileSync(
      receipt,
      JSON.stringify({
        vscode: vscode.version,
        extension: target.packageJSON.version,
        fork,
        workflow: active.taskId,
        workflowState: active.state,
      }),
      { flag: "wx" },
    );
  } finally {
    chat?.close();
    workbench.close();
  }
}

exports.run = async () => {
  try {
    await withTimeout(runJourney(), 230_000, "Native fork and workflow map");
  } catch (error) {
    const { receipt } = JSON.parse(process.env.CC_NATIVE_FORK_TEST);
    fs.writeFileSync(`${receipt}.error`, error.stack || String(error));
    throw error;
  }
};
