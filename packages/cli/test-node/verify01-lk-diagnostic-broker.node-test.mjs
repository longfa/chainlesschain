import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LK_BROKER,
  createLkDiagnosticBroker,
  lkDiagnosticBody,
  lkDiagnosticJsonUsage,
  lkDiagnosticStreamUsage,
} from "../scripts/verify01-lk-diagnostic-broker.mjs";
import { nativeEnvironment } from "../scripts/verify01-native-task-campaign.mjs";

const usage = { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 };
const request = {
  model: LK_BROKER.model,
  messages: [{ role: "user", content: "Read the fixture." }],
  tools: [{ type: "function", function: { name: "read_file" } }],
};

test("LK is evaluated as a custom runtime with a local-only capability", (t) => {
  const root = mkdtempSync(join(tmpdir(), "cc-lk-native-env-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const environment = nativeEnvironment(
    root,
    join(root, "home"),
    join(root, "cfg"),
    ["fixture.js"],
    "test-capability",
    "lk",
  );
  assert.equal(environment.CC_FORMAL_QUALITY_EVAL_PROVIDER, "custom");
  assert.equal(environment.CC_API_KEY, "test-capability");
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.VOLCENGINE_API_KEY, undefined);
  assert.equal(
    lkDiagnosticBody({ ...request, stream: true, max_tokens: 2 }).max_tokens,
    2,
  );
  assert.deepEqual(
    lkDiagnosticBody({ ...request, stream: true }).stream_options,
    { include_usage: true },
  );
  assert.throws(
    () => lkDiagnosticBody({ ...request, model: "arbitrary" }),
    /MODEL_MISMATCH/,
  );
  assert.throws(
    () =>
      lkDiagnosticBody({
        ...request,
        tools: [{ type: "function", function: { name: "run_shell" } }],
      }),
    /FILE_TOOLS_REQUIRED/,
  );
});

test("LK validates stream completion, tool names and usage", () => {
  const event = (json) => "data: " + JSON.stringify(json) + "\n\n";
  const start = {
    model: LK_BROKER.model,
    choices: [
      {
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { name: "read_" } }] },
      },
    ],
  };
  const more = {
    model: LK_BROKER.model,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [{ index: 0, type: null, function: { name: "file" } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
  const terminal = { model: LK_BROKER.model, choices: [], usage };
  const stream = event(start) + event(more) + event(terminal);
  assert.throws(
    () => lkDiagnosticStreamUsage(stream, { max_tokens: 5 }),
    /INCOMPLETE_STREAM/,
  );
  assert.deepEqual(
    lkDiagnosticStreamUsage(stream + "data: [DONE]\n\n", { max_tokens: 5 }),
    { usage, finish: "tool_calls" },
  );
  assert.throws(
    () =>
      lkDiagnosticStreamUsage(
        stream.replace("read_", "unlisted_") + "data: [DONE]\n\n",
        { max_tokens: 5 },
      ),
    /OUTPUT_TOOL_FORBIDDEN/,
  );
  assert.throws(
    () =>
      lkDiagnosticStreamUsage(
        event(more) + event(terminal) + "data: [DONE]\n\n",
        { max_tokens: 5 },
      ),
    /TOOL_DELTA_INVALID/,
  );
});

test("LK checks separately reported reasoning against the total and output limit", () => {
  // Terminal usage from the first Linux VS Code journey in Actions run 45363579053.
  const usage = {
    prompt_tokens: 21933,
    completion_tokens: 310,
    total_tokens: 22268,
    completion_tokens_details: { reasoning_tokens: 25 },
  };
  const response = { model: LK_BROKER.model, usage };
  const json = (usage) =>
    JSON.stringify({
      ...response,
      usage,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: "fixture" },
        },
      ],
    });
  const stream = (usage) =>
    `data: ${JSON.stringify({ model: response.model, choices: [{ index: 0, finish_reason: "stop" }] })}\n\n` +
    `data: ${JSON.stringify({ ...response, choices: [], usage })}\n\ndata: [DONE]\n\n`;
  for (const [read, encode] of [
    [lkDiagnosticJsonUsage, json],
    [lkDiagnosticStreamUsage, stream],
  ]) {
    assert.deepEqual(read(encode(usage), { max_tokens: 335 }), {
      usage,
      finish: "stop",
    });
    assert.throws(
      () => read(encode(usage), { max_tokens: 334 }),
      /OUTPUT_LIMIT_EXCEEDED/,
    );
    for (const invalid of [
      { ...usage, total_tokens: 22269 },
      { ...usage, completion_tokens_details: undefined },
      { ...usage, completion_tokens_details: { reasoning_tokens: -25 } },
    ]) {
      assert.throws(
        () => read(encode(invalid), { max_tokens: 335 }),
        /USAGE_INCONSISTENT/,
      );
    }
    const inclusive = { ...usage, completion_tokens: 335 };
    assert.equal(
      read(encode(inclusive), { max_tokens: 335 }).usage.completion_tokens,
      335,
    );
  }
});

test("LK records provider usage while retaining unknown billing and estimate", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "cc-lk-native-broker-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outputDir = join(root, "receipts");
  const realKey = "fixture-provider-key";
  const broker = await createLkDiagnosticBroker({
    outputDir,
    key: realKey,
    allowedTaskIds: ["verify-01"],
    requestImpl: async (body, key) => {
      assert.equal(body.model, LK_BROKER.model);
      assert.equal(key, realKey);
      return {
        status: 200,
        raw: Buffer.from(
          JSON.stringify({
            model: LK_BROKER.model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "fixture" },
                finish_reason: "stop",
              },
            ],
            usage,
          }),
        ),
      };
    },
  });
  let summary;
  try {
    broker.beginTask("verify-01");
    const response = await fetch(broker.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + broker.childKey,
      },
      body: JSON.stringify(request),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(broker.taskStatus("verify-01").passed, true);
  } finally {
    summary = await broker.close();
  }
  assert.equal(summary.usageCompleteRequests, 1);
  assert.equal(summary.actualBilledCostUsd, null);
  assert.equal(summary.tokenOnlyEstimateUsd, null);
  assert.equal(summary.knownTokenOnlyEstimateUsd, null);
  const receipt = readFileSync(
    join(outputDir, "request-1.receipt.json"),
    "utf8",
  );
  assert.equal(receipt.includes(realKey), false);
  assert.equal(receipt.includes(broker.childKey), false);
});
