/** LK transport for the native VERIFY01 diagnostic cohort. */
import { LK_CHANNEL } from "../src/lib/llm-channel-presets.js";
import {
  createBoundedDiagnosticBroker,
  parseDiagnosticJson,
  requestFixedDiagnosticEndpoint,
} from "./verify01-volcengine-diagnostic-broker.mjs";

export const LK_BROKER = Object.freeze({
  endpoint: LK_CHANNEL.addresses.primary + "/v1/chat/completions",
  provider: "lk",
  model: "gpt-6.1-sol",
  protocol: "chat-completions",
  maximumRequestsPerTask: 24,
  maximumRequestBytes: 256 * 1024,
  maximumResponseBytes: 16 * 1024 * 1024,
  maximumAnswerTokens: 8192,
  timeoutMs: 180000,
  connectionAttemptTimeoutMs: 5000,
  usageAccounting: "completion-with-optional-separate-reasoning/v1",
  formalSample: false,
});

const tools = new Set([
  "read_file",
  "search_files",
  "list_dir",
  "write_file",
  "edit_file",
  "edit_file_hashed",
]);
const requestFields = new Set([
  "model",
  "messages",
  "tools",
  "stream",
  "stream_options",
  "max_tokens",
]);
const check = (valid, code) => {
  if (!valid) throw new Error("DIAGNOSTIC_LK_" + code);
};
const count = (value) => Number.isSafeInteger(value) && value >= 0;

export function lkDiagnosticBody(
  input,
  { allowTextOnlyRequests = false } = {},
) {
  check(input?.model === LK_BROKER.model, "MODEL_MISMATCH");
  check(
    Object.keys(input).every((key) => requestFields.has(key)),
    "UNEXPECTED_FIELD",
  );
  check(
    input.stream === undefined || typeof input.stream === "boolean",
    "INVALID_STREAM_MODE",
  );
  check(
    Array.isArray(input.messages) && input.messages.length > 0,
    "MESSAGES_REQUIRED",
  );
  for (const message of input.messages) {
    check(
      ["system", "user", "assistant", "tool"].includes(message?.role),
      "MESSAGE_ROLE_INVALID",
    );
    check(
      message.content == null || typeof message.content === "string",
      "NON_TEXT_MESSAGE",
    );
    check(
      message.tool_calls === undefined ||
        (message.role === "assistant" &&
          Array.isArray(message.tool_calls) &&
          message.tool_calls.every(
            (call) =>
              call?.type === "function" && tools.has(call.function?.name),
          )),
      "MESSAGE_TOOL_FORBIDDEN",
    );
  }
  check(
    (allowTextOnlyRequests && input.tools === undefined) ||
      (Array.isArray(input.tools) &&
        (allowTextOnlyRequests || input.tools.length > 0) &&
        input.tools.every(
          (tool) => tool?.type === "function" && tools.has(tool.function?.name),
        )),
    "FILE_TOOLS_REQUIRED",
  );
  check(
    input.max_tokens === undefined ||
      (count(input.max_tokens) && input.max_tokens > 0),
    "OUTPUT_LIMIT_INVALID",
  );
  const stream = input.stream === true;
  return {
    model: input.model,
    messages: input.messages,
    ...(input.tools?.length ? { tools: input.tools } : {}),
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    max_tokens: Math.min(
      input.max_tokens ?? LK_BROKER.maximumAnswerTokens,
      LK_BROKER.maximumAnswerTokens,
    ),
  };
}

function validateUsage(usage, finish, countLimit) {
  check(["stop", "tool_calls", "length"].includes(finish), "FINISH_UNKNOWN");
  check(
    usage &&
      [usage.prompt_tokens, usage.completion_tokens, usage.total_tokens].every(
        count,
      ),
    "USAGE_UNKNOWN",
  );
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  check(reasoning === undefined || count(reasoning), "USAGE_INCONSISTENT");
  const outputTokens = usage.total_tokens - usage.prompt_tokens;
  // LK can include reasoning in completion_tokens or add it separately to
  // total_tokens. Keep the reported fields intact for receipt verification.
  const includesReasoning =
    outputTokens === usage.completion_tokens &&
    (reasoning ?? 0) <= usage.completion_tokens;
  const separateReasoning =
    reasoning > 0 && outputTokens - usage.completion_tokens === reasoning;
  check(includesReasoning || separateReasoning, "USAGE_INCONSISTENT");
  check(outputTokens <= countLimit, "OUTPUT_LIMIT_EXCEEDED");
  return { usage, finish };
}

export function lkDiagnosticJsonUsage(raw, body) {
  const response = parseDiagnosticJson(raw);
  check(
    response?.model === LK_BROKER.model && !Object.hasOwn(response, "error"),
    "RESPONSE_MODEL_UNKNOWN",
  );
  check(
    Array.isArray(response.choices) && response.choices.length === 1,
    "CHOICES_INVALID",
  );
  const [choice] = response.choices;
  const message = choice?.message;
  check(choice.index === 0 && message?.role === "assistant", "CHOICE_INVALID");
  check(
    message.tool_calls === undefined ||
      (Array.isArray(message.tool_calls) &&
        message.tool_calls.every(
          (call) =>
            call?.type === "function" &&
            tools.has(call.function?.name) &&
            typeof call.id === "string" &&
            typeof call.function.arguments === "string",
        )),
    "OUTPUT_TOOL_FORBIDDEN",
  );
  check(
    choice.finish_reason !== "tool_calls" || message.tool_calls?.length > 0,
    "MISSING_OUTPUT_TOOL",
  );
  return validateUsage(response.usage, choice.finish_reason, body.max_tokens);
}

export function lkDiagnosticStreamUsage(raw, body) {
  let usage,
    finish,
    done = false,
    modelSeen = false;
  const toolNames = new Map();
  for (const block of raw.replaceAll("\r\n", "\n").split("\n\n")) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    check(!done, "DATA_AFTER_TERMINAL");
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    const event = parseDiagnosticJson(data);
    check(event && !Object.hasOwn(event, "error"), "PROVIDER_ERROR");
    if (event.model !== undefined) {
      check(event.model === LK_BROKER.model, "RESPONSE_MODEL_UNKNOWN");
      modelSeen = true;
    }
    if (event.usage != null) {
      check(
        usage === undefined ||
          JSON.stringify(usage) === JSON.stringify(event.usage),
        "CONFLICTING_USAGE",
      );
      usage = event.usage;
    }
    check(
      Array.isArray(event.choices) && event.choices.length <= 1,
      "CHOICES_INVALID",
    );
    for (const choice of event.choices) {
      check(choice?.index === 0, "CHOICE_INVALID");
      if (choice.finish_reason) {
        check(
          finish === undefined || finish === choice.finish_reason,
          "CONFLICTING_FINISH",
        );
        finish = choice.finish_reason;
      }
      for (const call of choice.delta?.tool_calls || []) {
        check(
          count(call?.index) &&
            (call.type === undefined || call.type === "function"),
          "TOOL_DELTA_INVALID",
        );
        const name = call.function?.name ?? "";
        check(typeof name === "string", "TOOL_DELTA_INVALID");
        toolNames.set(call.index, (toolNames.get(call.index) ?? "") + name);
      }
    }
  }
  check(done && modelSeen, "INCOMPLETE_STREAM");
  check(
    [...toolNames.values()].every((name) => tools.has(name)),
    "OUTPUT_TOOL_FORBIDDEN",
  );
  check(finish !== "tool_calls" || toolNames.size > 0, "MISSING_OUTPUT_TOOL");
  return validateUsage(usage, finish, body.max_tokens);
}

export async function createLkDiagnosticBroker(options) {
  return createBoundedDiagnosticBroker(options, {
    policy: LK_BROKER,
    route: "/v1/chat/completions",
    basePath: "/v1",
    request: (body, key, config) =>
      requestFixedDiagnosticEndpoint(body, key, config, LK_BROKER),
    body: lkDiagnosticBody,
    sseUsage: lkDiagnosticStreamUsage,
    jsonUsage: lkDiagnosticJsonUsage,
    estimateField: "tokenOnlyEstimateUsd",
    billedField: "actualBilledCostUsd",
    defaultThinkingPreserved: true,
  });
}
