"use strict";
const llm = require("../llm-config");
const lkCatalog = require("../vendor/lk-channel-presets.json");
const { loadLkCatalog } = require("../vendor/lk-public-catalog.cjs");
const { panelHtml, panelOptions } = require("./panel-shell");
let currentPanel = null;
const BODY = `<main class="page"><header class="header"><div><div class="eyebrow">CHAINLESSCHAIN / CONNECTIONS</div><h1>配置大模型</h1><p class="subtitle">连接官方服务、力数等本地算力平台或自定义中转站。配置与 CLI、聊天面板共享。</p></div><span class="badge" id="connection-status">读取配置中</span></header><div id="notice" class="notice" role="status" aria-live="polite">正在读取现有配置，不会显示已保存的密钥。</div><div class="form-grid"><section class="card"><form id="form"><fieldset id="fields"><div class="field"><label for="preset">服务类型</label><select id="preset"><option value="relay">自定义 / 中转站</option></select><span class="hint">本地平台选择 Local compute / OpenAI compatible；模型名称以平台 API 为准。</span></div><div class="field" id="protocol-field"><label for="protocol">兼容协议</label><select id="protocol"><option value="openai">OpenAI 兼容 · Chat Completions</option><option value="anthropic">Anthropic · Messages</option><option value="gemini">Gemini · Generate Content</option><option value="ollama">Ollama · 本地接口</option></select></div><div class="field"><label for="baseUrl">接口基础地址（Base URL）</label><input id="baseUrl" type="url" required spellcheck="false" placeholder="https://your-relay.example/v1"><span id="url-hint" class="hint">填写基础地址（通常包含 /v1），不要填写 /chat/completions。</span></div><div class="field-row"><div class="field"><label for="model">文本模型</label><input id="model" required spellcheck="false" placeholder="填写模型 ID 或中转站别名"><span class="hint">支持自定义名称，无需出现在预设列表中。</span></div><div class="field"><label for="visionModel">视觉模型 · 可选</label><input id="visionModel" spellcheck="false" placeholder="留空使用文本模型 / CLI 默认"><span class="hint">用于截图和图片识别；模型须支持图片输入。</span></div></div><div class="field" id="key-field"><label for="apiKey">API Key</label><input id="apiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="输入此服务的 API Key"><span id="key-hint" class="hint">密钥通过本地 CLI 的安全存储保存，不写入 IDE 设置。</span></div><div class="field" id="http-field" hidden><label class="checkbox"><input id="allowHttp" type="checkbox">此远程接口使用 HTTP，我确认允许以未加密连接访问。</label></div></fieldset><div class="form-footer"><span id="dirty" class="hint">尚未修改</span><div class="actions"><button id="reload" type="button">重新读取</button><button class="primary" id="save" type="submit">保存配置</button><button id="test" type="button">测试已保存连接</button></div></div></form></section><aside><section class="card"><h2>连接只需三步</h2><ol class="steps"><li><strong>选择服务与协议</strong><p>力数、vLLM、SGLang 等选择本地算力平台；中转站可另选协议。</p></li><li><strong>填写地址与模型</strong><p>填写平台 Base URL 与模型 ID。密钥按平台要求填写；换地址不复用原密钥。</p></li><li><strong>保存并测试</strong><p>测试会发送一次简短模型请求，可能产生少量费用。成功后，聊天下一条消息即使用新配置。</p></li></ol><div class="summary-line"><span>当前提供商 / 协议</span><strong id="saved-provider">—</strong></div><div class="summary-line"><span>当前模型</span><strong id="saved-model">—</strong></div><div class="summary-line"><span>当前地址</span><div id="saved-url" class="mono">—</div></div><div class="summary-line"><span>密钥状态</span><strong id="saved-key">—</strong></div></section></aside></div></main>`;

function validateAnswers(
  input,
  current,
  savedConnections = [],
  lkModels = lkCatalog.models,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("无效的配置");
  const answers = {};
  for (const key of ["provider", "model", "baseUrl", "visionModel", "apiKey"]) {
    if (
      typeof input[key] !== "string" ||
      input[key].length > (key === "apiKey" ? 8192 : 2048)
    )
      throw new Error(`无效的字段：${key}`);
    answers[key] = input[key].trim();
  }
  if (!llm.PROVIDER_PRESETS.some((p) => p.id === answers.provider))
    throw new Error("请选择支持的服务或兼容协议");
  if (!answers.model || /[\r\n\0]/.test(answers.model + answers.visionModel))
    throw new Error("请填写正确的模型名称");
  let url;
  try {
    url = new URL(answers.baseUrl);
  } catch {
    throw new Error("请填写完整的接口地址");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "地址需使用 HTTP(S)，且不能包含用户名、密码、查询参数或片段",
    );
  if (
    /\/(chat\/completions|messages|responses|api\/generate)\/?$/.test(
      url.pathname,
    )
  )
    throw new Error(
      "请填写接口基础地址，不要包含 /chat/completions、/messages 等具体接口",
    );
  answers.baseUrl = url.href.replace(/\/+$/, "");
  const lkEndpoint = Object.values(lkCatalog.channel.addresses).some((origin) =>
    [origin + "/v1", origin + "/v1beta"].includes(answers.baseUrl),
  );
  if (lkEndpoint) {
    const model = lkModels.find((entry) => entry.id === answers.model);
    const wire = answers.provider === "custom" ? "openai" : answers.provider;
    if (
      model &&
      (model.type !== "chat" || !model.compatibleProtocols.includes(wire))
    )
      throw new Error("此 LK 模型不支持当前对话协议");
  }
  answers.allowHttp = input.allowHttp === true;
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    !answers.allowHttp
  )
    throw new Error("请先确认允许此远程 HTTP 连接");
  const same =
    current?.provider === answers.provider &&
    String(current.baseUrl || "").replace(/\/+$/, "") === answers.baseUrl;
  if (
    (lkEndpoint || !["ollama", "custom"].includes(answers.provider)) &&
    !answers.apiKey &&
    !(same && current.hasKey) &&
    !savedConnections.some(
      (row) =>
        row.hasKey &&
        ((lkEndpoint && row.channel === "lk") ||
          (row.provider === answers.provider &&
            row.baseUrl.replace(/\/+$/, "") === answers.baseUrl)),
    )
  )
    throw new Error("请输入此服务的 API Key。更换地址时不会复用原服务的密钥。");
  return answers;
}

function openLlmConfigPanel(
  vscode,
  { getCommand, getTestCommand, onConfigured, api = llm } = {},
) {
  if (currentPanel) {
    currentPanel.reveal();
    return currentPanel;
  }
  const panel = vscode.window.createWebviewPanel(
    "chainlesschainLlmConfig",
    "配置大模型",
    vscode.ViewColumn.Active,
    panelOptions(vscode),
  );
  currentPanel = panel;
  let busy = false,
    disposed = false,
    current = null,
    savedConnections = [],
    catalog = { source: "bundled", models: lkCatalog.models };
  const post = (value) => !disposed && panel.webview.postMessage(value);
  const notice = (text, kind = "info") => post({ type: "notice", text, kind });
  const command = () =>
    getCommand?.() || require("../cli-binary").getResolvedCli();
  async function refreshModels() {
    catalog = await (api.loadLkCatalog || loadLkCatalog)(lkCatalog.models);
    post({ type: "lk-catalog", catalog });
  }
  async function read() {
    const options = { command: command() };
    const [provider, model, baseUrl, visionModel, hasKey] = await Promise.all([
      api.getConfiguredProvider(options),
      api.getConfiguredModel(options),
      api.getConfiguredBaseUrl(options),
      api.getConfiguredVisionModel(options),
      api.hasConfiguredApiKey(options),
    ]);
    current = {
      provider: provider || "ollama",
      model: model || "",
      baseUrl:
        baseUrl ||
        api.PROVIDER_PRESETS.find((p) => p.id === (provider || "ollama"))
          ?.baseUrl ||
        "",
      visionModel: visionModel || "",
      hasKey,
    };
    savedConnections = (await api.getSavedLlmConnections?.(options)) || [];
    post({
      type: "config",
      current,
      presets: api.PROVIDER_PRESETS,
      lkCatalog: { ...lkCatalog, ...catalog },
      savedConnections,
    });
  }
  panel.webview.onDidReceiveMessage(async (message) => {
    if (
      busy ||
      disposed ||
      !["ready", "reload", "lk-models", "save", "test", "account"].includes(
        message?.type,
      )
    )
      return;
    busy = true;
    post({ type: "busy", value: true });
    try {
      if (["ready", "reload"].includes(message.type)) {
        await read();
        notice(
          "已读取现有配置。修改后保存，密钥留空可保留同一服务的现有密钥。",
        );
        await refreshModels();
      } else if (message.type === "lk-models") {
        await refreshModels();
      } else if (message.type === "account") {
        const result = await api.queryLkAccount({ command: command() });
        post({ type: "account", text: result.detail });
      } else if (message.type === "save") {
        const answers = validateAnswers(
          message.answers,
          current,
          savedConnections,
          catalog.models,
        );
        notice("正在保存连接配置…");
        const result = await api.applyLlmConnection({
          command: command(),
          answers,
        });
        if (!result.ok) throw new Error(result.error || "保存失败");
        await read();
        if (
          current.provider !== answers.provider ||
          current.model !== answers.model ||
          current.baseUrl !== answers.baseUrl ||
          current.visionModel !== answers.visionModel ||
          ((!["ollama", "custom"].includes(answers.provider) ||
            answers.apiKey) &&
            !current.hasKey)
        )
          throw new Error(
            "配置写入后的回读结果与提交内容不一致，请重新读取并确认保存状态。",
          );
        await onConfigured?.();
        notice(
          "配置已保存。可以测试连接；聊天的下一条消息将使用新配置。",
          "success",
        );
      } else {
        notice("正在测试已保存的连接，通常需要几秒…");
        // configurationCliPath may point at a newer CLI only for saving. Test
        // the runtime used by chat, which can remain a different installation.
        const result = await api.testLlm({
          command:
            getTestCommand?.() || require("../cli-binary").getResolvedCli(),
        });
        notice(
          result.ok
            ? `连接成功。${result.detail || ""}`
            : result.failureKind === "cli"
              ? `未执行连接测试：${result.detail}`
              : `连接未通过：${result.detail || "请检查接口地址、协议、模型权限和账户余额。"}`,
          result.ok ? "success" : "error",
        );
      }
    } catch (error) {
      notice(error.message, "error");
    } finally {
      busy = false;
      post({ type: "busy", value: false });
    }
  });
  panel.onDidDispose(() => {
    disposed = true;
    if (currentPanel === panel) currentPanel = null;
  });
  panel.webview.html = panelHtml(vscode, panel.webview, {
    title: "配置大模型",
    body: BODY.replace(
      '<div class="field"><label for="preset">',
      '<div class="field"><label for="saved-connection">已保存渠道 · 自动恢复凭证</label><select id="saved-connection"><option value="">选择已保存渠道</option></select></div><div class="field"><label for="preset">',
    )
      .replace(
        "</aside>",
        '<section class="card"><h2>LK 动态价格与账单</h2><p class="hint">查询已保存连接，最近 1 天当前 Key 的 API 实扣及账户余额。更多范围与翻页：cc llm account --help</p><button id="account" type="button">刷新价格与余额</button><pre id="account-result" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></section></aside>',
      )
      .replace(
        '<div class="field" id="protocol-field">',
        '<div class="field" id="lk-address-field" hidden><label for="lk-address">LK 主备地址</label><select id="lk-address"><option value="primary">主 api.vv666.ai</option><option value="backup">备用 api.lk666.ai</option></select></div>' +
          '<div class="field" id="lk-model-field" hidden><label for="lk-model">LK 模型目录</label><select id="lk-model"></select><button id="lk-model-refresh" type="button">刷新模型</button><span id="lk-model-source" class="hint" role="status">内置离线目录</span><span class="hint">按协议筛选对话模型；下方仍可填写新模型 ID。媒体模型通过文档查看。</span><a href="https://chainlesschain.net/apidoc">开发文档</a> · <a href="https://chainlesschain.net/api/pricing">模型定价</a></div>' +
          '<div class="field" id="protocol-field">',
      ),
    script: "llm-config.js",
  });
  return panel;
}
module.exports = { openLlmConfigPanel, validateAnswers };
