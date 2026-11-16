import { computed, reactive, ref } from "vue";
import { readLlmConnection, saveLlmConnection } from "../utils/llm-config.js";
import {
  lkChannel,
  lkModels,
  lkConnection,
  lkSelection,
} from "../utils/lk-channel.js";

const normalized = (value) =>
  String(value || "")
    .trim()
    .replace(/\/+$/, "");
const connectionKeys = ["provider", "model", "baseUrl", "visionModel"];
const matches = (left, right) =>
  connectionKeys.every((key) =>
    key === "baseUrl"
      ? normalized(left[key]) === normalized(right[key])
      : String(left[key] || "") === String(right[key] || ""),
  );

export function useLlmConfiguration(ws, providersStore, message) {
  const configLoading = ref(false),
    configSaving = ref(false),
    configReady = ref(false);
  const showRestartHint = ref(false),
    loaded = ref(null);
  const savedConnections = ref([]);
  const channel = ref("lk"),
    lkProtocol = ref("openai"),
    lkAddress = ref("primary");
  const configForm = reactive({
    provider: undefined,
    model: "",
    baseUrl: "",
    visionModel: "",
    apiKey: "",
    temperature: 0.7,
    maxTokens: 4096,
    allowHttp: false,
  });
  const lkModelOptions = computed(() =>
    lkModels
      .filter(
        (model) =>
          model.type === "chat" &&
          model.compatibleProtocols.includes(lkProtocol.value),
      )
      .map((model) => ({
        value: model.id,
        label: `${model.label} (${model.id})`,
      })),
  );
  const sameDestination = computed(
    () =>
      loaded.value &&
      configForm.provider === loaded.value.provider &&
      normalized(configForm.baseUrl) === normalized(loaded.value.baseUrl),
  );
  const keyPlaceholder = computed(() =>
    hasSavedKey.value
      ? "此渠道密钥已保存 · 留空自动恢复"
      : "输入此渠道的 API Key",
  );
  const hasSavedKey = computed(
    () =>
      (sameDestination.value && loaded.value?.hasKey) ||
      savedConnections.value.some(
        (row) =>
          row.hasKey &&
          ((lkSelection(configForm) && row.channel === "lk") ||
            (row.provider === configForm.provider &&
              normalized(row.baseUrl) === normalized(configForm.baseUrl))),
      ),
  );
  const connectionDirty = computed(
    () =>
      !loaded.value ||
      !matches(configForm, loaded.value) ||
      Boolean(configForm.apiKey.trim()),
  );
  const remoteHttp = computed(() => {
    try {
      const url = new URL(configForm.baseUrl);
      return (
        url.protocol === "http:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      );
    } catch {
      return false;
    }
  });

  function showSnapshot(snapshot) {
    // Whitelist the snapshot too: no response may populate the password field.
    const safe = {};
    for (const key of [...connectionKeys, "hasKey", "temperature", "maxTokens"])
      safe[key] = snapshot[key];
    loaded.value = safe;
    savedConnections.value =
      snapshot.savedConnections || savedConnections.value;
    Object.assign(configForm, {
      provider: safe.provider,
      model: safe.model || "",
      baseUrl: safe.baseUrl || "",
      visionModel: safe.visionModel || "",
      apiKey: "",
      allowHttp: false,
      temperature: safe.temperature ?? 0.7,
      maxTokens: safe.maxTokens ?? 4096,
    });
    const selection = lkSelection(safe);
    channel.value = selection || !safe.provider ? "lk" : "manual";
    if (selection) {
      lkProtocol.value = selection.protocol;
      lkAddress.value = selection.address;
    }
  }

  function applyLk(keepModel = false) {
    const connection = lkConnection(
      lkProtocol.value,
      lkAddress.value,
      keepModel ? configForm.model : undefined,
    );
    Object.assign(configForm, connection, {
      apiKey: "",
      visionModel: "",
      allowHttp: false,
    });
  }
  function handleChannelChange() {
    configForm.apiKey = "";
    if (channel.value === "lk") {
      const saved = savedConnections.value.find((row) => row.channel === "lk");
      if (saved) selectSavedConnection(saved);
      else applyLk();
    }
  }
  function handleProviderChange() {
    configForm.apiKey = "";
    const saved = savedConnections.value.find(
      (row) => row.provider === configForm.provider && row.channel !== "lk",
    );
    if (saved) selectSavedConnection(saved);
  }
  function selectSavedConnection(saved) {
    Object.assign(configForm, {
      provider: saved.provider,
      model: saved.model,
      baseUrl: saved.baseUrl,
      visionModel: saved.visionModel || "",
      apiKey: "",
      allowHttp: false,
    });
    const selected = lkSelection(saved);
    channel.value = selected ? "lk" : "manual";
    if (selected) {
      lkProtocol.value = selected.protocol;
      lkAddress.value = selected.address;
    }
  }
  function resetForm() {
    if (loaded.value) showSnapshot(loaded.value);
  }

  async function loadConfig() {
    configLoading.value = true;
    try {
      showSnapshot(await readLlmConnection(ws));
      configReady.value = true;
      message.success("配置已加载");
    } catch (error) {
      configReady.value = false;
      message.error(`加载配置失败: ${error.message}`);
    } finally {
      configLoading.value = false;
    }
  }

  async function saveConfig() {
    if (!configReady.value || configSaving.value) return;
    configSaving.value = true;
    const changedConnection = connectionDirty.value;
    const draft = Object.fromEntries(
      connectionKeys.map((key) => [key, String(configForm[key] || "").trim()]),
    );
    draft.apiKey = configForm.apiKey.trim();
    draft.allowHttp = configForm.allowHttp === true;
    const errors = [];
    let saved = 0;
    try {
      const selection = lkSelection(draft);
      if (selection) {
        lkConnection(selection.protocol, selection.address, draft.model);
        if (!draft.apiKey && !hasSavedKey.value)
          throw new Error("新 LK 地址需要填写渠道 API Key");
      }
      for (const key of ["temperature", "maxTokens"]) {
        const value = configForm[key];
        if (
          !Number.isFinite(value) ||
          (key === "temperature"
            ? value < 0 || value > 2
            : !Number.isInteger(value) || value < 256 || value > 128000)
        )
          throw new Error("请填写有效的温度和最大输出长度");
      }
      if (changedConnection) {
        const result = await saveLlmConnection(ws, draft);
        if (!result || !matches(result, draft))
          throw new Error("连接保存结果未确认，请重新加载配置");
        saved++;
      }
      for (const key of ["temperature", "maxTokens"]) {
        const value = configForm[key];
        if (value === loaded.value[key]) continue;
        try {
          const result = await ws.execute(
            `config set llm.${key} ${value}`,
            10000,
          );
          if (result.exitCode !== undefined && result.exitCode !== 0)
            throw new Error("写入失败");
          saved++;
        } catch {
          errors.push(key);
        }
      }
      const snapshot = await readLlmConnection(ws);
      if (
        changedConnection &&
        (!matches(snapshot, draft) || (draft.apiKey && !snapshot.hasKey))
      )
        throw new Error("保存后回读的连接不一致，请重新加载配置");
      showSnapshot(snapshot);
      if (errors.length)
        message.warning(`部分参数保存失败: ${errors.join(", ")}`);
      else if (saved) message.success("配置已保存并回读确认");
      else message.info("没有检测到配置变更");
      if (changedConnection) {
        showRestartHint.value = true;
        await providersStore.loadProviders();
      }
    } catch (error) {
      message.error(`保存配置失败: ${error.message}`);
    } finally {
      configSaving.value = false;
    }
  }

  async function testSavedConnection() {
    if (!configReady.value || connectionDirty.value || configSaving.value)
      return;
    const ok = await providersStore.testProvider(configForm.provider);
    if (ok) message.success("已保存连接测试成功");
    else message.warning("连接测试失败，请核对账户权限、余额和协议");
  }

  return {
    configForm,
    configLoading,
    configSaving,
    configReady,
    showRestartHint,
    channel,
    lkProtocol,
    lkAddress,
    lkChannel,
    lkModelOptions,
    keyPlaceholder,
    savedConnections,
    selectSavedConnection,
    connectionDirty,
    remoteHttp,
    applyLk,
    handleChannelChange,
    handleProviderChange,
    loadConfig,
    saveConfig,
    resetForm,
    testSavedConnection,
  };
}
