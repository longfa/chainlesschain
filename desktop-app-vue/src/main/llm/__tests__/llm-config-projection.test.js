import { describe, expect, it } from "vitest";

const {
  mergeLlmConfigWrite,
  projectLlmConfigForRenderer,
} = require("../llm-config-projection");

function privateConfig() {
  return {
    provider: "openai",
    openai: {
      apiKey: "sk-openai-secret",
      baseURL: "https://tenant.example.test/private",
      organization: "org-private",
      model: "gpt-private",
      embeddingModel: "embed-private",
      arbitrary: "must-not-cross",
    },
    anthropic: {
      apiKey: "sk-anthropic-secret",
      baseURL: "https://anthropic.example.test/private",
      model: "claude-private",
      embeddingModel: "",
      version: "2023-06-01",
    },
    custom: {
      apiKey: "sk-custom-secret",
      baseURL: "https://custom.example.test/tenant",
      name: "Private Custom",
      model: "custom-model",
      embeddingModel: "custom-embed",
    },
    options: {
      temperature: 0.3,
      max_tokens: 512,
      arbitrary: "must-not-cross",
    },
    systemPrompt: "private system prompt",
    streamEnabled: true,
    autoSaveConversations: false,
    arbitrary: "must-not-cross",
  };
}

describe("LLM config renderer projection", () => {
  it("retains separate endpoint credentials and restores LK across protocols without exposing saved secrets", () => {
    let config = privateConfig();
    config = mergeLlmConfigWrite(
      {
        custom: {
          baseURL: "https://api.vv666.ai/v1",
          apiKey: "lk-secret",
          model: "gpt-6.1-sol",
        },
        provider: "custom",
      },
      config,
    );
    config = mergeLlmConfigWrite(
      {
        provider: "volcengine",
        volcengine: {
          baseURL: "https://ark.cn-beijing.volces.com/api/v3",
          apiKey: "volc-secret",
          model: "ep-model",
        },
      },
      config,
    );
    config = mergeLlmConfigWrite(
      {
        provider: "anthropic",
        anthropic: {
          baseURL: "https://api.lk666.ai/v1",
          apiKey: "",
          model: "claude-opus-5-5",
        },
      },
      config,
    );
    expect(config.anthropic.apiKey).toBe("lk-secret");
    const projected = projectLlmConfigForRenderer(config);
    const original = projected.savedConnections.find(
      (row) => row.provider === "openai",
    );
    const restored = mergeLlmConfigWrite(
      { restoreConnectionId: original.id },
      config,
    );
    expect(restored.openai.apiKey).toBe("sk-openai-secret");
    expect(restored.volcengine.apiKey).toBe("volc-secret");
    const foreign = mergeLlmConfigWrite(
      { openai: { baseURL: "https://unknown.example/v1", apiKey: "" } },
      restored,
    );
    expect(foreign.openai.apiKey).toBe("");
    expect(JSON.stringify(projected)).not.toMatch(
      /lk-secret|volc-secret|sk-openai-secret|tenant.example.test/,
    );
  });
  it("returns configured receipts without private values", () => {
    const projected = projectLlmConfigForRenderer(privateConfig());
    const serialized = JSON.stringify(projected);

    expect(projected).toMatchObject({
      provider: "openai",
      systemPrompt: "",
      systemPromptConfigured: true,
      openai: {
        apiKey: "",
        apiKeyConfigured: true,
        baseURL: "",
        baseURLConfigured: true,
        organization: "",
        organizationConfigured: true,
        model: "gpt-private",
        embeddingModel: "embed-private",
      },
      custom: {
        apiKey: "",
        apiKeyConfigured: true,
        baseURL: "",
        baseURLConfigured: true,
      },
      options: { temperature: 0.3, max_tokens: 512 },
    });
    expect(serialized).not.toContain("sk-openai-secret");
    expect(serialized).not.toContain("tenant.example.test");
    expect(serialized).not.toContain("private system prompt");
    expect(serialized).not.toContain("must-not-cross");
  });

  it("preserves hidden values on blank writes and drops receipt fields", () => {
    const current = privateConfig();
    const merged = mergeLlmConfigWrite(
      {
        ...projectLlmConfigForRenderer(current),
        openai: {
          ...projectLlmConfigForRenderer(current).openai,
          model: "gpt-updated",
        },
        arbitrary: "must-not-persist",
      },
      current,
    );

    expect(merged.openai).toEqual({
      apiKey: "sk-openai-secret",
      baseURL: "https://tenant.example.test/private",
      organization: "org-private",
      model: "gpt-updated",
      embeddingModel: "embed-private",
    });
    expect(merged.systemPrompt).toBe("private system prompt");
    expect(merged.openai.apiKeyConfigured).toBeUndefined();
    expect(merged.arbitrary).toBeUndefined();
  });

  it("accepts replacements and explicit null clears", () => {
    const merged = mergeLlmConfigWrite(
      {
        provider: "openai",
        openai: {
          apiKey: "sk-replacement",
          baseURL: null,
          organization: null,
          model: "gpt-next",
        },
        systemPrompt: null,
      },
      privateConfig(),
    );

    expect(merged.openai.apiKey).toBe("sk-replacement");
    expect(merged.openai.baseURL).toBe("");
    expect(merged.openai.organization).toBe("");
    expect(merged.systemPrompt).toBe("");
    expect(merged.options).toEqual({ temperature: 0.3, max_tokens: 512 });
  });
});
