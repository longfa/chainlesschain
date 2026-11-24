import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyPricingReceipt,
  ORIGINAL_CANDIDATE_DIGEST,
  PRICING_SEMANTIC_MUTANTS,
  readOriginalPricingCandidate,
} from "../scripts/verify01-review-pricing-diagnostic.mjs";
import {
  applyReviewMutation,
  runReviewStage,
} from "../scripts/verify01-review-runtime.mjs";

const mutant = PRICING_SEMANTIC_MUTANTS[0];

test(
  "an independent check retains the failed mutation and restores the source",
  { skip: process.platform !== "linux" },
  (t) => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), "verify01-mutant-"),
    );
    t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
    const original = "export const count = 1;\n";
    const source = path.join(workspace, "source.js");
    fs.writeFileSync(source, original);
    fs.writeFileSync(path.join(workspace, "baseline.test.js"), "fixture");
    fs.writeFileSync(path.join(workspace, "candidate.test.js"), "fixture");
    const report = JSON.stringify({
      success: true,
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [{ assertionResults: [{ status: "passed" }] }],
    });
    const spec = {
      taskId: "verify-10",
      imageId: `sha256:${"a".repeat(64)}`,
      sourcePath: "source.js",
      expectedFiles: ["candidate.test.js"],
      baselineTests: ["baseline.test.js"],
      testSupport: [],
      mutants: [
        { name: "wrong-count", find: "count = 1", replace: "count = 2" },
      ],
    };
    const receipt = runReviewStage(workspace, spec, "check", {
      execute: (_command, args) => ({
        status: 0,
        stdout: args.includes("--version") ? "v22.12.0" : report,
      }),
    });
    assert.equal(receipt.pass, false);
    assert.deepEqual(receipt.mutations, []);
    assert.equal(receipt.failedMutation.name, "wrong-count");
    assert.match(
      receipt.failedMutation.failure,
      /did not reject the behavioral mutant/u,
    );
    assert.equal(fs.readFileSync(source, "utf8"), original);

    // The timed-out client can race Docker's automatic removal of --rm jobs.
    for (const removed of [true, false]) {
      const timedOut = runReviewStage(workspace, spec, "check", {
        execute: (_command, args) => {
          if (args[0] === "rm" || args.includes("--check")) {
            return { status: null, error: new Error("ETIMEDOUT") };
          }
          if (args[0] === "container") {
            return {
              status: 1,
              stderr: `Error response from daemon: No such container: ${removed ? args[2] : "another-container"}\n`,
            };
          }
          return {
            status: 0,
            stdout: args.includes("--version") ? "v22.12.0" : report,
          };
        },
      });
      assert.equal(timedOut.pass, false);
      assert.equal(timedOut.failedMutation.name, "wrong-count");
      assert.ok(timedOut.executions.some(({ error }) => error === "ETIMEDOUT"));
      assert.equal(Boolean(timedOut.cleanupFailure), !removed);
      assert.equal(fs.readFileSync(source, "utf8"), original);
    }
  },
);

function survivor() {
  return {
    stage: "check",
    providerAssessed: false,
    productionAttested: false,
    pass: false,
    detail: "candidate tests did not reject the behavioral mutant",
    tests: ["baseline", "candidate"].map((kind) => ({
      kind,
      total: 1,
      passed: 1,
      failed: 0,
    })),
    mutations: [],
    executions: [
      {
        command: ["node", "vitest", "--reporter=json"],
        exitCode: 0,
        signal: null,
        error: null,
        stdout: JSON.stringify({
          success: true,
          numTotalTests: 1,
          numPassedTests: 1,
          numFailedTests: 0,
          numPendingTests: 0,
          numTodoTests: 0,
          testResults: [{ assertionResults: [{ status: "passed" }] }],
        }),
      },
    ],
  };
}

test("replays exactly the original archived candidate, without changing its imports", () => {
  const candidate = readOriginalPricingCandidate();
  assert.equal(
    "sha256:" + createHash("sha256").update(candidate).digest("hex"),
    ORIGINAL_CANDIDATE_DIGEST,
  );
  assert.equal(candidate.length, 4924);
});

test("each semantic mutation has one syntax-valid match in the frozen pricing implementation", () => {
  const original = execFileSync(
    "git",
    [
      "show",
      "b2aa3aba082873570e85dce39b00754e5504ff37:packages/cli/src/lib/llm-pricing.js",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(
    new Set(PRICING_SEMANTIC_MUTANTS.map((item) => item.name)).size,
    4,
  );
  for (const item of PRICING_SEMANTIC_MUTANTS) {
    const changed = applyReviewMutation(original, item);
    assert.notEqual(changed, original);
    execFileSync(process.execPath, ["--check", "--input-type=module"], {
      input: changed,
      windowsHide: true,
    });
  }
});

test("classifies a fully executed passing mutant run as a survivor", () => {
  assert.deepEqual(classifyPricingReceipt(survivor(), mutant), {
    outcome: "survived",
    tests: { total: 1, passed: 1, failed: 0 },
  });
});

test("classifies a reviewed assertion rejection separately from survival", () => {
  const receipt = survivor();
  receipt.pass = true;
  receipt.mutations = [{ name: mutant.name, total: 1, passed: 0, failed: 1 }];
  assert.equal(classifyPricingReceipt(receipt, mutant).outcome, "killed");
});

test("an empty candidate with a passing baseline cannot establish any semantic outcome", () => {
  for (const semanticMutant of PRICING_SEMANTIC_MUTANTS) {
    const receipt = survivor();
    receipt.detail = "acceptance requires executed test cases";
    receipt.tests = [{ kind: "baseline", total: 22, passed: 22, failed: 0 }];
    receipt.executions[0].exitCode = 1;
    receipt.executions[0].stdout = JSON.stringify({
      success: false,
      numTotalTests: 0,
      numFailedTests: 0,
      testResults: [{ assertionResults: [], message: "No test suite found" }],
    });
    assert.throws(
      () => classifyPricingReceipt(receipt, semanticMutant),
      /candidate assertions were not executed; semantic outcome cannot be established/u,
    );
  }
});

test("does not turn infrastructure failures or incomplete tests into expected survival", () => {
  for (const adjust of [
    (r) => {
      r.detail = "behavioral mutation has invalid syntax";
    },
    (r) => {
      r.executions[0].signal = "SIGKILL";
    },
    (r) => {
      r.executions[0].error = "ENOENT";
    },
    (r) => {
      r.executions[0].exitCode = 1;
    },
    (r) => {
      r.executions[0].stdout = "not JSON";
    },
    (r) => {
      r.executions[0].stdout = JSON.stringify({
        success: true,
        numTotalTests: 0,
        testResults: [],
      });
    },
    (r) => {
      const report = JSON.parse(r.executions[0].stdout);
      report.numPendingTests = 1;
      report.testResults[0].assertionResults[0].status = "pending";
      r.executions[0].stdout = JSON.stringify(report);
    },
    (r) => {
      r.tests.pop();
    },
    (r) => {
      r.tests[1].failed = 1;
    },
  ]) {
    const receipt = survivor();
    adjust(receipt);
    assert.throws(() => classifyPricingReceipt(receipt, mutant));
  }
});
