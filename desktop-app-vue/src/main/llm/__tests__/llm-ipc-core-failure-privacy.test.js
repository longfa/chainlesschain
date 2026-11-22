import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { registerCoreHandlers } = require("../llm-ipc-core");
const { createLlmIpcPrivacy } = require("../llm-ipc-privacy");

describe("LLM core IPC failure privacy", () => {
  const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let handlers;
  let managerRef;
  let getLLMConfig;

  beforeEach(() => {
    vi.resetAllMocks();
    handlers = {};
    managerRef = { current: {} };
    getLLMConfig = vi.fn();
    registerCoreHandlers({
      ipcMain: {
        handle(channel, handler) {
          handlers[channel] = handler;
        },
      },
      managerRef,
      detectTaskType: vi.fn(() => "general"),
      isTestMode: false,
      getLLMConfig,
      llmPrivacy: createLlmIpcPrivacy("core", sink),
      coreAuthorization: { authorize: vi.fn(async () => Object.freeze({})) },
    });
  });

  it("projects every top-level handler failure", async () => {
    const secret = "sk-core-secret-prompt-response";
    const hostileError = new Proxy(new Error(secret), {
      get() {
        throw new Error("caught error accessor was invoked");
      },
    });
    const reject = vi.fn(async () => {
      throw hostileError;
    });
    managerRef.current = {
      checkStatus: reject,
      query: reject,
      queryStream: reject,
      listModels: reject,
      clearContext() {
        throw hostileError;
      },
      embeddings: reject,
    };
    getLLMConfig.mockImplementation(() => {
      throw hostileError;
    });

    const status = await handlers["llm:check-status"]();
    expect(status).toMatchObject({
      available: false,
      error: "LLM service unavailable",
      code: "CC_LLM_IPC_UNAVAILABLE",
      component: "core",
      operation: "check-status",
    });

    const failures = [
      ["llm:query", [null, secret, {}], "query"],
      ["llm:query-stream", [null, secret, {}], "query-stream"],
      ["llm:get-config", [], "get-config"],
      ["llm:lk-account", [], "lk-account"],
      ["llm:set-config", [null, { apiKey: secret }], "set-config"],
      ["llm:clear-context", [null, secret], "clear-context"],
      ["llm:embeddings", [null, secret], "embeddings"],
    ];

    for (const [channel, args, operation] of failures) {
      await expect(handlers[channel](...args)).rejects.toMatchObject({
        message: "LLM IPC operation failed",
        code: "CC_LLM_IPC_OPERATION_FAILED",
        component: "core",
        operation,
      });
    }

    await expect(handlers["llm:list-models"]()).resolves.toEqual([]);

    managerRef.current = null;
    await expect(
      handlers["llm:chat"](null, { messages: [] }),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      operation: "chat",
    });
    await expect(
      handlers["llm:chat-with-template"](null, {
        templateId: secret,
        variables: { text: secret },
      }),
    ).rejects.toMatchObject({
      code: "CC_LLM_IPC_OPERATION_FAILED",
      operation: "chat-with-template",
    });

    expect(JSON.stringify(sink.error.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(status)).not.toContain(secret);
  });

  it("refreshes LK models over the fixed public endpoint without a credential", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        code: 200,
        data: {
          chat: [
            {
              mingcheng: "next-model",
              api_xieyi: "openai",
              other: "private-field",
            },
          ],
          image: [],
          video: [],
          audio: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      const result = await handlers["llm:lk-models"](null, {
        baseUrl: "https://foreign.example",
        apiKey: "draft-key",
      });
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, options] = fetcher.mock.calls[0];
      expect(url).toMatch(/^https:\/\/api\.cc888\.ai\/gongkai\/apidoc\//);
      expect(options.headers).toEqual({ Accept: "application/json" });
      expect(result).toMatchObject({
        source: "live",
        models: [{ id: "next-model" }],
      });
      expect(JSON.stringify(result)).not.toContain("private-field");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("queries LK billing with the desktop saved credential and never returns it", async () => {
    const apiKey = "fixture-desktop-account-key";
    getLLMConfig.mockReturnValue({
      getAll: () => ({
        provider: "anthropic",
        anthropic: {
          baseURL: "https://api.lk666.ai",
          model: "claude-opus-5-5",
          apiKey,
        },
      }),
    });
    const fetcher = vi.fn(
      async () => new Response("unauthorized", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      const result = await handlers["llm:lk-account"](null, {
        days: 7,
        apiKey: "foreign-key",
        baseUrl: "https://foreign.example",
      });
      expect(fetcher).toHaveBeenCalledTimes(4);
      for (const [url, options] of fetcher.mock.calls) {
        expect(url).toMatch(/^https:\/\/api\.lk666\.ai\/v1\/skills\//);
        expect(options.headers.Authorization).toBe(`Bearer ${apiKey}`);
      }
      expect(result.partial).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(
        /fixture-desktop-account-key|foreign-key/,
      );
      expect(result.formattedText).toContain("未知");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves the governance code without returning the original error", async () => {
    const original = Object.assign(new Error("private governed failure"), {
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      cause: new Error("private cause"),
    });
    managerRef.current = {
      query: vi.fn(async () => {
        throw original;
      }),
    };

    let received;
    try {
      await handlers["llm:query"](null, "private prompt", {});
    } catch (error) {
      received = error;
    }

    expect(received).not.toBe(original);
    expect(received).toMatchObject({
      message: "Governed Desktop model request failed",
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      component: "core",
      operation: "query",
    });
    expect(received.cause).toBeUndefined();
  });

  it("projects private config values before returning to the renderer", async () => {
    const secret = "sk-core-config-secret";
    getLLMConfig.mockReturnValue({
      getAll: () => ({
        provider: "openai",
        openai: {
          apiKey: secret,
          baseURL: "https://private-tenant.example.test/v1",
          organization: "private-org",
          model: "gpt-safe-model",
        },
        systemPrompt: "private system prompt",
        options: { temperature: 0.2 },
        streamEnabled: true,
      }),
    });

    const result = await handlers["llm:get-config"]();

    expect(result.openai).toMatchObject({
      apiKey: "",
      apiKeyConfigured: true,
      baseURL: "",
      baseURLConfigured: true,
      organization: "",
      organizationConfigured: true,
      model: "gpt-safe-model",
    });
    expect(result.systemPrompt).toBe("");
    expect(result.systemPromptConfigured).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("private-tenant");
    expect(JSON.stringify(result)).not.toContain("private system prompt");
  });

  it("keeps top-level core catches on the privacy boundary", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "llm-ipc-core.js"),
      "utf8",
    );
    const retiredMessages = [
      "LLM查询失败",
      "LLM 聊天失败",
      "模板聊天失败",
      "LLM流式查询失败",
      "获取LLM配置失败",
      "设置LLM配置失败",
      "列出模型失败",
      "清除上下文失败",
      "生成嵌入失败",
    ];

    for (const message of retiredMessages) {
      expect(source).not.toContain(message);
    }
    expect(source).not.toMatch(/error\s*:\s*error\.message/u);
    expect(source).not.toContain("errorMonitor.analyzeError(error)");
    expect(source).not.toMatch(/utils\/logger\.js/u);
    expect(source).not.toMatch(
      /\blogger\.(?:debug|info|warn|error|fatal)\s*\(/u,
    );
    expect(source).not.toMatch(/console\.(?:debug|info|warn|error|log)\s*\(/u);
  });

  it("keeps internal event names on a fixed allowlist", () => {
    const privacy = createLlmIpcPrivacy("core", sink);
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "llm-ipc-core.js"),
      "utf8",
    );
    const eventNames = [
      ...source.matchAll(/privacy\.event\("([a-z-]+)"\)/gu),
    ].map((match) => match[1]);

    expect(eventNames.length).toBeGreaterThan(0);
    for (const eventName of eventNames) {
      privacy.event(eventName);
      expect(sink.info).toHaveBeenLastCalledWith("[LLM IPC] internal event", {
        component: "core",
        event: eventName,
      });
    }

    privacy.event("private-session-agent-model-tool-template");

    expect(sink.info).toHaveBeenCalledWith("[LLM IPC] internal event", {
      component: "core",
      event: "unknown",
    });
  });
});
