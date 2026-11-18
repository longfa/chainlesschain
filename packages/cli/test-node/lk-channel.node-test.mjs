import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  LK_CHANNEL,
  LK_MODELS,
  canonicalLkModel,
  resolveLkConnection,
} from "../src/lib/llm-channel-presets.js";
import { geminiGenerateContentUrl } from "../src/lib/provider-protocol.js";

test("IDE catalogs remain synchronized with the CLI source", () => {
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../scripts/sync-lk-ide-presets.mjs", import.meta.url),
      ),
      "--check",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.match(output, /synchronized/);
});

test("catalog preserves exact platform aliases, types and protocols", () => {
  assert.equal(
    new Set(LK_MODELS.map((model) => model.id)).size,
    LK_MODELS.length,
  );
  for (const type of ["chat", "image", "video", "audio"])
    assert.ok(LK_MODELS.some((model) => model.type === type));
  assert.equal(
    LK_MODELS.find((model) => model.id === "claude-opus-5-5").protocol,
    "anthropic",
  );
  assert.deepEqual(
    LK_MODELS.find((model) => model.id === "gpt-6.1-sol").compatibleProtocols,
    ["openai", "openai_responses"],
  );
});

for (const address of ["primary", "backup"]) {
  test(`${address}: all chat models route to their documented native protocol`, () => {
    const origin = LK_CHANNEL.addresses[address];
    for (const model of LK_MODELS.filter((entry) => entry.type === "chat")) {
      const connection = resolveLkConnection(model.protocol, address, {
        model: model.id,
      });
      assert.equal(connection.model, model.id);
      if (model.protocol === "anthropic") {
        assert.equal(connection.provider, "anthropic");
        assert.equal(`${connection.baseUrl}/messages`, `${origin}/v1/messages`);
        const desktop = resolveLkConnection(model.protocol, address, {
          desktop: true,
          model: model.id,
        });
        assert.equal(`${desktop.baseUrl}/v1/messages`, `${origin}/v1/messages`);
      } else if (model.protocol === "gemini") {
        assert.equal(connection.provider, "gemini");
        assert.equal(
          geminiGenerateContentUrl(connection.baseUrl, model.id),
          `${origin}/v1beta/models/${encodeURIComponent(model.id)}:generateContent`,
        );
      } else {
        assert.equal(connection.provider, "custom");
        assert.equal(
          `${connection.baseUrl}/chat/completions`,
          `${origin}/v1/chat/completions`,
        );
      }
    }
  });
}

test("known incompatible models and media cannot enter a chat protocol", () => {
  assert.throws(() =>
    resolveLkConnection("openai", "primary", { model: "claude-opus-5-5" }),
  );
  assert.throws(() =>
    resolveLkConnection("anthropic", "primary", { model: "gpt-6.1-sol" }),
  );
  for (const model of LK_MODELS.filter((entry) => entry.type !== "chat"))
    assert.throws(() =>
      resolveLkConnection("openai", "primary", { model: model.id }),
    );
});

test("unknown future aliases remain explicit without replacing them", () => {
  const result = resolveLkConnection("openai", "backup", {
    model: "team/new-model",
  });
  assert.equal(result.model, "team/new-model");
  assert.equal(result.baseUrl, "https://api.lk666.ai/v1");
  assert.throws(() => resolveLkConnection("__proto__"));
  assert.throws(() => resolveLkConnection("anthropic", "constructor"));
});

test("renamed LK aliases preserve the selected model family", () => {
  for (const [oldId, newId] of [
    ["tt-6.1-sol", "gpt-6.1-sol"],
    ["tt-6-luna", "gpt-6-luna"],
    ["fb-5-2", "claude-fable-5-2"],
    ["gem-3.8-flash", "gemini-3.8-flash"],
  ]) {
    assert.ok(LK_MODELS.some((model) => model.id === newId));
    assert.equal(canonicalLkModel(oldId), newId);
  }
  for (const id of ["constructor", "__proto__", "team/custom-model"])
    assert.equal(canonicalLkModel(id), id);
});

function desktopSettings() {
  const source = readFileSync(
    new URL(
      "../../../desktop-app-vue/src/renderer/components/LLMSettings.vue",
      import.meta.url,
    ),
    "utf8",
  );
  const script = source
    .match(/<script setup>([\s\S]*?)<\/script>/)[1]
    .replace(/^import[\s\S]*?from\s*["'][^"']+["'];/gm, "");
  const context = {
    ref: (value) => ({ value }),
    reactive: (value) => value,
    computed: (value) =>
      typeof value === "function"
        ? {
            get value() {
              return value();
            },
          }
        : value,
    onMounted() {},
    watch() {},
    LK_CHANNEL,
    LK_MODELS,
    resolveLkConnection,
  };
  vm.runInNewContext(
    script +
      "\nglobalThis.settings = { form, lkProtocol, lkAddress, lkModel, lkChatModels, applyLkPreset, handleLkProtocolChange };",
    context,
  );
  return context.settings;
}

test("desktop applying LK clears another service credential and selects exact model", () => {
  const state = desktopSettings();
  state.form.custom.apiKey = "official-key";
  state.applyLkPreset();
  assert.equal(state.form.provider, "custom");
  assert.equal(state.form.custom.apiKey, "");
  assert.equal(state.form.custom.model, "gpt-6.1-sol");
  assert.equal(state.form.custom.baseURL, "https://api.vv666.ai/v1");
});

test("desktop manual backup retains only the channel key and chosen model", () => {
  const state = desktopSettings();
  state.applyLkPreset();
  state.form.custom.apiKey = "channel-key";
  state.lkAddress.value = "backup";
  state.applyLkPreset();
  assert.equal(state.form.custom.apiKey, "channel-key");
  assert.equal(state.form.custom.baseURL, "https://api.lk666.ai/v1");
  state.lkProtocol.value = "openai";
  state.handleLkProtocolChange();
  assert.equal(state.lkModel.value, "gpt-6.1-sol");
  assert.ok(
    state.lkChatModels.value.every((model) =>
      model.compatibleProtocols.includes("openai"),
    ),
  );
  state.applyLkPreset();
  assert.equal(state.form.provider, "custom");
  assert.equal(state.form.custom.model, "gpt-6.1-sol");
  assert.equal(state.form.custom.baseURL, "https://api.lk666.ai/v1");
  assert.equal(state.form.custom.apiKey, "channel-key");
});
