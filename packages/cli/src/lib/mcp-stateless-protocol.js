import { admitMcpToolResult } from "./mcp-tool-result.js";
import { VERSION } from "../constants.js";
import {
  admitMcpTaskResponse,
  mcpTaskError,
  MCP_TASKS_EXTENSION,
  MCP_STATELESS_PROTOCOL_VERSION,
} from "./mcp-tasks.js";

const NAME_FIELDS = Object.freeze({
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
  "tasks/get": "taskId",
  "tasks/update": "taskId",
  "tasks/cancel": "taskId",
});
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () =>
  mcpTaskError(
    "CC_MCP_STATELESS_RESULT_INVALID",
    "MCP stateless response is invalid",
    true,
  );

/** Validate an external MCP tool schema before it reaches a provider API. */
export function validateMcpInputSchema(
  schema,
  { toolName = "unknown", maxBytes = 256 * 1024 } = {},
) {
  const errors = [];
  let encoded = "";
  try {
    encoded = JSON.stringify(schema) || "";
  } catch {
    errors.push({
      tool: toolName,
      path: "$",
      code: "SCHEMA_NOT_SERIALIZABLE",
      message: "inputSchema is not JSON-serializable",
    });
  }
  if (encoded.length > maxBytes)
    errors.push({
      tool: toolName,
      path: "$",
      code: "SCHEMA_TOO_LARGE",
      message: `inputSchema exceeds ${maxBytes} bytes`,
    });
  const visit = (value, path = "$", depth = 0) => {
    if (depth > 32) {
      errors.push({
        tool: toolName,
        path,
        code: "SCHEMA_TOO_DEEP",
        message: "inputSchema nesting exceeds 32 levels",
      });
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push({
        tool: toolName,
        path,
        code: "SCHEMA_NOT_OBJECT",
        message: "schema nodes must be objects",
      });
      return;
    }
    if (value.type !== undefined && typeof value.type !== "string")
      errors.push({
        tool: toolName,
        path: `${path}.type`,
        code: "SCHEMA_TYPE_INVALID",
        message: "type must be a string",
      });
    if (value.properties !== undefined) {
      if (
        !value.properties ||
        typeof value.properties !== "object" ||
        Array.isArray(value.properties)
      )
        errors.push({
          tool: toolName,
          path: `${path}.properties`,
          code: "SCHEMA_PROPERTIES_INVALID",
          message: "properties must be an object",
        });
      else
        for (const [key, child] of Object.entries(value.properties))
          visit(child, `${path}.properties.${key}`, depth + 1);
    }
    if (
      value.required !== undefined &&
      (!Array.isArray(value.required) ||
        value.required.some((key) => typeof key !== "string"))
    )
      errors.push({
        tool: toolName,
        path: `${path}.required`,
        code: "SCHEMA_REQUIRED_INVALID",
        message: "required must be an array of strings",
      });
    for (const key of ["items", "additionalProperties", "contains", "not"])
      if (value[key] && typeof value[key] === "object")
        visit(value[key], `${path}.${key}`, depth + 1);
    for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"])
      if (Array.isArray(value[key]))
        value[key].forEach((child, index) =>
          visit(child, `${path}.${key}[${index}]`, depth + 1),
        );
  };
  if (errors.length === 0) visit(schema);
  return Object.freeze({
    valid: errors.length === 0,
    toolName,
    errors: Object.freeze(errors),
  });
}

/** Only the explicit task API advertises Tasks. Ordinary calls cannot silently
 * create an untracked background operation, and no input/sampling authority is
 * advertised by this polling transport. */
export function statelessMcpRequest(
  method,
  params = {},
  { tasks = false } = {},
) {
  const field = Object.hasOwn(NAME_FIELDS, method) ? NAME_FIELDS[method] : null;
  const name = field ? params[field] : null;
  const encodedName =
    typeof name === "string"
      ? /^[\x21-\x7e]+$/.test(name) && !name.startsWith("=?base64?")
        ? name
        : `=?base64?${Buffer.from(name, "utf8").toString("base64")}?=`
      : null;
  return {
    params: {
      ...params,
      _meta: {
        ...params._meta,
        "io.modelcontextprotocol/protocolVersion":
          MCP_STATELESS_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": {
          name: "chainlesschain-cli",
          version: VERSION,
        },
        "io.modelcontextprotocol/clientCapabilities": tasks
          ? { extensions: { [MCP_TASKS_EXTENSION]: {} } }
          : {},
      },
    },
    headers: {
      "MCP-Protocol-Version": MCP_STATELESS_PROTOCOL_VERSION,
      "Mcp-Method": method,
      ...(encodedName === null ? {} : { "Mcp-Name": encodedName }),
    },
  };
}

/** Map the new wire vocabulary into the existing verified journal shape.
 * Result association comes from the validated tasks/get identity, never from
 * peer-controlled metadata or a synthetic tool/user message. */
export function admitStatelessMcpTask(
  serverName,
  value,
  config,
  { create = false, taskId } = {},
) {
  const wire = admitMcpToolResult(serverName, value, config).result;
  if (
    wire.resultType !== (create ? "task" : "complete") ||
    ["task", "ttl", "pollInterval"].some((key) => Object.hasOwn(wire, key)) ||
    (create &&
      (Object.hasOwn(wire, "isError") ||
        (wire.content !== undefined &&
          (!Array.isArray(wire.content) || wire.content.length !== 0))))
  )
    throw invalid();
  const task = admitMcpTaskResponse(
    serverName,
    {
      taskId: wire.taskId,
      status: wire.status,
      createdAt: wire.createdAt,
      lastUpdatedAt: wire.lastUpdatedAt,
      ttl: wire.ttlMs,
      ...(wire.pollIntervalMs === undefined
        ? {}
        : { pollInterval: wire.pollIntervalMs }),
      ...(wire.statusMessage === undefined
        ? {}
        : { statusMessage: wire.statusMessage }),
    },
    config,
    { kind: "get", taskId },
  );
  if (
    (wire.status !== "completed" && Object.hasOwn(wire, "result")) ||
    (wire.status !== "failed" && Object.hasOwn(wire, "error")) ||
    (wire.status !== "input_required" && Object.hasOwn(wire, "inputRequests"))
  )
    throw invalid();
  if (
    wire.status === "input_required" &&
    (!object(wire.inputRequests) ||
      Object.keys(wire.inputRequests).length === 0)
  )
    throw invalid();
  if (
    wire.status === "failed" &&
    (!object(wire.error) ||
      !Number.isInteger(wire.error.code) ||
      typeof wire.error.message !== "string")
  )
    throw invalid();
  let result;
  if (wire.status === "completed" && Object.hasOwn(wire, "result")) {
    if (
      !object(wire.result) ||
      (wire.result._meta !== undefined && !object(wire.result._meta)) ||
      (wire.result.resultType !== undefined &&
        wire.result.resultType !== "complete")
    )
      throw invalid();
    const related = wire.result._meta?.["io.modelcontextprotocol/related-task"];
    if (related !== undefined && related?.taskId !== task.taskId)
      throw invalid();
    result = admitMcpTaskResponse(
      serverName,
      {
        ...wire.result,
        _meta: {
          ...wire.result._meta,
          "io.modelcontextprotocol/related-task": { taskId: task.taskId },
        },
      },
      config,
      { kind: "result", taskId: task.taskId },
    );
  } else if (!create && wire.status === "completed") throw invalid();
  return Object.freeze({ task, ...(result ? { result } : {}) });
}

export function assertStatelessMcpAck(serverName, value, config) {
  const wire = admitMcpToolResult(serverName, value, config).result;
  if (
    wire.resultType !== "complete" ||
    Object.keys(wire).some((key) => !["resultType", "_meta"].includes(key))
  )
    throw invalid();
}
