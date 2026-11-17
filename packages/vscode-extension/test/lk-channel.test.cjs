const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const catalog = require("../src/vendor/lk-channel-presets.json");
const { PROVIDER_PRESETS } = require("../src/llm-config");
const { validateAnswers } = require("../src/ui/llm-config-panel");

function page() {
  const elements = new Map();
  const messages = [];
  let receive;
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        options: [],
        checked: false,
        addEventListener() {},
        append(option) {
          this.options.push(option);
        },
        replaceChildren() {
          this.options = [];
        },
      });
    return elements.get(id);
  };
  element("protocol").options = ["openai", "anthropic", "gemini", "ollama"].map(
    (value) => ({ value }),
  );
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../media/llm-config.js"), "utf8"),
    {
      URL,
      document: { getElementById: element, createElement: () => ({}) },
      acquireVsCodeApi: () => ({
        postMessage: (value) => messages.push(value),
      }),
      window: {
        addEventListener: (_, callback) => {
          receive = callback;
        },
      },
    },
  );
  const load = (current) =>
    receive({
      data: {
        type: "config",
        current,
        presets: PROVIDER_PRESETS,
        lkCatalog: catalog,
      },
    });
  return { element, load, messages };
}

test("LK preset chooses exact alias and isolates every protocol's models", () => {
  const { element: e, load, messages } = page();
  load({
    provider: "openai",
    model: "old",
    baseUrl: "https://api.openai.com/v1",
    hasKey: true,
  });
  e("apiKey").value = "old-key";
  e("preset").value = "lk";
  e("preset").onchange();
  assert.equal(e("model").value, "tt-6-luna");
  assert.equal(e("apiKey").value, "");
  assert.equal(e("baseUrl").value, "https://api.vv666.ai/v1");
  assert.doesNotMatch(e("key-hint").textContent, /可留空/);
  for (const [protocol, model, provider] of [
    ["openai", "tt-6-luna", "custom"],
    ["anthropic", "fb-5-2", "anthropic"],
    ["gemini", "gem-3.8-flash", "gemini"],
  ]) {
    e("protocol").value = protocol;
    e("protocol").onchange();
    assert.equal(e("model").value, model);
    assert.equal(
      e("lk-model").options.length,
      catalog.models.filter((m) => m.type === "chat" && m.protocol === protocol)
        .length,
    );
    e("lk-address").value = "backup";
    e("lk-address").onchange();
    assert.ok(e("baseUrl").value.startsWith("https://api.lk666.ai/"));
    e("form").onsubmit({ preventDefault() {} });
    assert.equal(messages.at(-1).answers.provider, provider);
  }
});

test("LK saved alias survives reread and never reveals its stored key", () => {
  const { element: e, load } = page();
  load({
    provider: "custom",
    model: "team/future",
    baseUrl: "https://api.lk666.ai/v1",
    hasKey: true,
  });
  assert.equal(e("preset").value, "lk");
  assert.equal(e("lk-address").value, "backup");
  assert.equal(e("model").value, "team/future");
  assert.equal(e("apiKey").value, "");
});

test("LK rejects incompatible media/chat protocols and foreign credential reuse", () => {
  const draft = {
    provider: "custom",
    model: "tt-6-luna",
    baseUrl: "https://api.vv666.ai/v1",
    apiKey: "",
    visionModel: "",
  };
  assert.throws(
    () =>
      validateAnswers(draft, {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        hasKey: true,
      }),
    /API Key/,
  );
  assert.throws(
    () => validateAnswers({ ...draft, apiKey: "key", model: "fb-5-2" }),
    /协议/,
  );
  assert.equal(validateAnswers({ ...draft, apiKey: "key" }).provider, "custom");
});
