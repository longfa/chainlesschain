import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { setupMcpFromConfig } from "../../src/runtime/mcp-config.js";
import { sessionPath } from "../../src/harness/jsonl-session-store.js";
import { McpLifecycleAuthority } from "../../src/lib/mcp-lifecycle-authority.js";
import { runAgentHeadless } from "../helpers/test-model-egress.js";

it("keeps rejected MCP schemas out of the active headless transcript and model catalog", async () => {
  const root = mkdtempSync(join(tmpdir(), "cc-mcp-schema-session-"));
  const cwd = join(root, "workspace");
  mkdirSync(cwd);
  const userHome = join(root, "user-home");
  mkdirSync(userHome);
  const profile = join(root, "config");
  vi.stubEnv("HOME", userHome);
  vi.stubEnv("USERPROFILE", userHome);
  vi.stubEnv("CHAINLESSCHAIN_HOME", profile);
  vi.stubEnv("CHAINLESSCHAIN_SECURITY_ANCHOR_HOME", join(root, "security"));
  vi.stubEnv("APPDATA", profile);
  vi.stubEnv("XDG_CONFIG_HOME", profile);
  const sessionId = "schema-admission-fixture";
  const toolName = "invalid_fixture";
  const privateMarker = "fixture schema description must not be persisted";
  const methods = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET") return response.writeHead(405).end();
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString());
    methods.push(message.method);
    if (message.id == null) return response.writeHead(202).end();
    let result = {};
    if (message.method === "initialize") {
      result = {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "schema-fixture", version: "1" },
        capabilities: { tools: {} },
      };
    } else if (message.method === "tools/list") {
      result = {
        tools: [
          {
            name: toolName,
            inputSchema: {
              type: "object",
              properties: {
                field: {
                  type: "broken",
                  description: privateMarker.repeat(1000),
                },
              },
            },
          },
        ],
      };
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  const errors = [];
  const chat = vi.fn(async () => ({
    message: { role: "assistant", content: "normal answer" },
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
  let mcp;
  let before;
  let after;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}/mcp`;
    const outcome = await runAgentHeadless(
      {
        cwd,
        sessionId,
        persistSession: true,
        prompt: "check the admitted catalog",
        outputFormat: "json",
        provider: "mock",
        model: "fixture",
        chatFn: chat,
        runnableProviderFallback: false,
        useRegisteredMcp: false,
        expandFileRefs: false,
        slashMacros: false,
      },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: () => {},
        writeErr: (text) => errors.push(text),
        resolveAgentMcp: async () => {
          before = readFileSync(sessionPath(sessionId));
          mcp = await setupMcpFromConfig(
            { broken: { url, transport: "http" } },
            {
              sessionId,
              mcpLifecycleAuthority: new McpLifecycleAuthority({
                statePath: join(root, "lifecycle.json"),
              }),
              writeErr: (text) => errors.push(text),
            },
          );
          after = readFileSync(sessionPath(sessionId));
          return mcp;
        },
      },
    );

    expect(outcome).toMatchObject({ exitCode: 0, result: "normal answer" });
    expect(methods).toContain("tools/list");
    expect(methods).not.toContain("tools/call");
    expect(before.length).toBeGreaterThan(0);
    expect(after.equals(before)).toBe(true);
    expect(mcp.extraToolDefinitions).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(1);
    const [modelMessages, { extraToolDefinitions }] = chat.mock.calls[0];
    expect(
      JSON.stringify([modelMessages, extraToolDefinitions ?? []]),
    ).not.toContain(toolName);
    expect(errors.join("")).toContain('$.properties."field".type');
    expect(errors.join("")).not.toContain(privateMarker);
    const transcript = readFileSync(sessionPath(sessionId), "utf8");
    expect(transcript).toContain("normal answer");
    expect(transcript).not.toContain(privateMarker);
    expect(transcript).not.toContain(toolName);
  } finally {
    await mcp?.mcpClient.disconnectAll();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
