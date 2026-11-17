import { describe, it, expect, vi } from "vitest";
import { useLlmConfiguration } from "../../src/composables/useLlmConfiguration.js";
import { lkConnection, lkModels } from "../../src/utils/lk-channel.js";
import {
  readLlmConnection,
  saveLlmConnection,
} from "../../src/utils/llm-config.js";

function setup(initial = {}) {
  let stored = {
    provider: "openai",
    model: "old-model",
    baseUrl: "https://api.openai.com/v1",
    visionModel: "",
    hasKey: true,
    temperature: 0.7,
    maxTokens: 4096,
    ...initial,
  };
  const ws = {
    sendRaw: vi.fn(async (frame) => {
      if (frame.type === "llm-config-get")
        return { success: true, config: { ...stored } };
      if (frame.type === "llm-configure") {
        const { apiKey, allowHttp, ...connection } = frame.connection;
        stored = {
          ...stored,
          ...connection,
          hasKey: Boolean(apiKey || stored.hasKey),
        };
        return { success: true, config: connection };
      }
      throw new Error("Unexpected frame");
    }),
    execute: vi.fn().mockResolvedValue({ exitCode: 0 }),
  };
  const providers = {
    loadProviders: vi.fn(),
    testProvider: vi.fn().mockResolvedValue(true),
  };
  const message = Object.fromEntries(
    ["success", "error", "warning", "info"].map((key) => [key, vi.fn()]),
  );
  return {
    ws,
    providers,
    message,
    form: useLlmConfiguration(ws, providers, message),
  };
}

describe("LK Web configuration", () => {
  it("waits for initial connection or reconnection before configuration frames", async () => {
    for (const action of [readLlmConnection, saveLlmConnection]) {
      let connected;
      const ws = {
        waitConnected: vi.fn(
          () =>
            new Promise((resolve) => {
              connected = resolve;
            }),
        ),
        sendRaw: vi.fn().mockResolvedValue({ success: true, config: {} }),
      };
      const pending = action(ws, { provider: "custom" });
      expect(ws.waitConnected).toHaveBeenCalledWith(8000);
      expect(ws.sendRaw).not.toHaveBeenCalled();
      connected();
      await pending;
      expect(ws.sendRaw).toHaveBeenCalledOnce();
    }
  });
  it("routes every chat model to its documented protocol on both addresses", () => {
    for (const address of ["primary", "backup"]) {
      for (const model of lkModels.filter((entry) => entry.type === "chat")) {
        const result = lkConnection(model.protocol, address, model.id);
        expect(result.model).toBe(model.id);
        expect(result.baseUrl).toBe(
          `https://api.lk${address === "primary" ? "888" : "666"}.ai/${model.protocol === "gemini" ? "v1beta" : "v1"}`,
        );
      }
    }
    expect(() => lkConnection("openai", "primary", "fb-5-2")).toThrow("协议");
    expect(() =>
      lkConnection(
        "openai",
        "primary",
        lkModels.find((entry) => entry.type === "image").id,
      ),
    ).toThrow("协议");
  });

  it("loads saved aliases without returning a stored secret to the form or snapshot", async () => {
    const { form } = setup({
      provider: "custom",
      model: "team/future",
      baseUrl: "https://api.lk666.ai/v1",
      apiKey: "must-not-display",
    });
    await form.loadConfig();
    expect(form.channel.value).toBe("lk");
    expect(form.lkAddress.value).toBe("backup");
    expect(form.configForm.model).toBe("team/future");
    expect(form.configForm.apiKey).toBe("");
    expect(form.keyPlaceholder.value).toContain("自动恢复");
    form.configForm.model = "changed";
    form.resetForm();
    expect(form.configForm.apiKey).toBe("");
    expect(form.configForm.model).toBe("team/future");
  });

  it("isolates protocol choices, clears typed credentials and retains model on host changes", async () => {
    const { form } = setup();
    await form.loadConfig();
    form.configForm.apiKey = "old-service-key";
    form.channel.value = "lk";
    form.handleChannelChange();
    expect(form.configForm).toMatchObject({
      provider: "custom",
      model: "tt-6-luna",
      apiKey: "",
    });
    form.lkProtocol.value = "anthropic";
    form.applyLk();
    expect(form.lkModelOptions.value).toHaveLength(14);
    form.configForm.model = "team/alias";
    form.configForm.apiKey = "typed-channel-key";
    form.lkAddress.value = "backup";
    form.applyLk(true);
    expect(form.configForm).toMatchObject({
      provider: "anthropic",
      model: "team/alias",
      baseUrl: "https://api.lk666.ai/v1",
      apiKey: "",
    });
  });

  it("restores saved Volcengine settings and reuses saved LK credentials across hosts/protocols", async () => {
    const savedConnections = [
      {
        provider: "volcengine",
        model: "ep-saved",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        hasKey: true,
        channel: null,
      },
      {
        provider: "custom",
        model: "tt-6-luna",
        baseUrl: "https://api.vv666.ai/v1",
        hasKey: true,
        channel: "lk",
      },
    ];
    const { form, ws, message } = setup({ savedConnections });
    await form.loadConfig();
    form.configForm.provider = "volcengine";
    form.handleProviderChange();
    expect(form.configForm.model).toBe("ep-saved");
    expect(form.keyPlaceholder.value).toContain("自动恢复");
    form.channel.value = "lk";
    form.handleChannelChange();
    form.lkProtocol.value = "anthropic";
    form.lkAddress.value = "backup";
    form.applyLk();
    expect(form.keyPlaceholder.value).toContain("自动恢复");
    await form.saveConfig();
    expect(message.error).not.toHaveBeenCalled();
    expect(ws.sendRaw).toHaveBeenCalledWith(
      {
        type: "llm-configure",
        connection: expect.objectContaining({
          provider: "anthropic",
          baseUrl: "https://api.lk666.ai/v1",
          apiKey: "",
        }),
      },
      15000,
    );
    expect(form.configForm.apiKey).toBe("");
  });

  it("requires a channel key before any write to a new LK address", async () => {
    const { form, ws, message } = setup();
    await form.loadConfig();
    form.channel.value = "lk";
    form.handleChannelChange();
    await form.saveConfig();
    expect(
      ws.sendRaw.mock.calls.some(([frame]) => frame.type === "llm-configure"),
    ).toBe(false);
    expect(ws.execute).not.toHaveBeenCalled();
    expect(message.error).toHaveBeenCalledWith(
      expect.stringContaining("API Key"),
    );
    form.resetForm();
    expect(form.configForm.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("atomically saves through structured WS data and confirms a non-secret readback", async () => {
    const { form, ws, providers, message } = setup();
    await form.loadConfig();
    form.channel.value = "lk";
    form.handleChannelChange();
    form.configForm.apiKey = "fixture-channel-key";
    await form.saveConfig();
    expect(ws.sendRaw).toHaveBeenCalledWith(
      {
        type: "llm-configure",
        connection: {
          provider: "custom",
          model: "tt-6-luna",
          baseUrl: "https://api.vv666.ai/v1",
          visionModel: "",
          apiKey: "fixture-channel-key",
          allowHttp: false,
        },
      },
      15000,
    );
    expect(ws.execute).not.toHaveBeenCalled();
    expect(form.configForm.apiKey).toBe("");
    expect(form.connectionDirty.value).toBe(false);
    expect(providers.loadProviders).toHaveBeenCalledOnce();
    expect(message.success).toHaveBeenLastCalledWith("配置已保存并回读确认");
    form.configForm.model = "changed";
    form.resetForm();
    expect(form.configForm.apiKey).toBe("");
  });

  it("does not advance the saved baseline after an unsuccessful or stale write", async () => {
    const { form, ws, message } = setup();
    await form.loadConfig();
    form.channel.value = "lk";
    form.handleChannelChange();
    form.configForm.apiKey = "fixture-key";
    ws.sendRaw.mockImplementation(async (frame) =>
      frame.type === "llm-configure"
        ? { success: true, config: { ...frame.connection } }
        : {
            success: true,
            config: {
              provider: "openai",
              model: "old-model",
              baseUrl: "https://api.openai.com/v1",
              hasKey: true,
            },
          },
    );
    await form.saveConfig();
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining("回读"));
    form.resetForm();
    expect(form.configForm.provider).toBe("openai");
    expect(form.configForm.apiKey).toBe("");
  });

  it("preserves a key only for the same saved destination and tests only saved connections", async () => {
    const { form, providers } = setup({
      provider: "custom",
      model: "tt-6-luna",
      baseUrl: "https://api.vv666.ai/v1",
    });
    await form.loadConfig();
    form.configForm.model = "team/future";
    await form.testSavedConnection();
    expect(providers.testProvider).not.toHaveBeenCalled();
    await form.saveConfig();
    await form.testSavedConnection();
    expect(providers.testProvider).toHaveBeenCalledWith("custom");
  });
});
