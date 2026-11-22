<template>
  <div>
    <div
      style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
      "
    >
      <div>
        <h2 class="page-title">LLM 配置</h2>
        <p class="page-sub">管理 AI 服务提供商</p>
      </div>
      <a-button
        type="primary"
        ghost
        :loading="providersStore.loading"
        @click="providersStore.loadProviders()"
      >
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <!-- Active Provider Banner -->
    <a-alert
      v-if="providersStore.activeProvider"
      type="success"
      style="
        margin-bottom: 20px;
        background: rgba(41, 162, 112, 0.08);
        border-color: rgba(41, 162, 112, 0.3);
      "
      show-icon
    >
      <template #message>
        <span
          >当前激活：<strong>{{ providersStore.activeProvider }}</strong></span
        >
      </template>
    </a-alert>

    <!-- Loading -->
    <div
      v-if="providersStore.loading"
      style="text-align: center; padding: 60px"
    >
      <a-spin size="large" />
      <div style="color: var(--text-muted); margin-top: 12px">
        加载 LLM 信息中...
      </div>
    </div>

    <!-- Providers Grid -->
    <div v-else>
      <div class="providers-grid">
        <a-card
          v-for="provider in providersStore.providers"
          :key="provider.name"
          class="provider-card"
          :class="{ active: provider.active }"
          style="background: var(--bg-card)"
          size="small"
        >
          <div
            style="
              display: flex;
              align-items: center;
              gap: 12px;
              margin-bottom: 12px;
            "
          >
            <span style="font-size: 24px">{{ provider.icon }}</span>
            <div style="flex: 1">
              <div style="color: #e0e0e0; font-weight: 500">
                {{ provider.label }}
              </div>
              <div
                style="
                  color: var(--text-secondary);
                  font-size: 11px;
                  font-family: monospace;
                "
              >
                {{ provider.name }}
              </div>
            </div>
            <div>
              <a-tag v-if="provider.active" color="green">活跃</a-tag>
              <a-badge
                v-else-if="provider.status === 'ok'"
                status="success"
                text=""
              />
              <a-badge
                v-else-if="provider.status === 'error'"
                status="error"
                text=""
              />
            </div>
          </div>

          <div style="display: flex; gap: 8px; justify-content: flex-end">
            <a-button
              size="small"
              style="
                background: var(--bg-card-hover);
                border-color: var(--border-color);
              "
              :loading="providersStore.testing === provider.name"
              @click="test(provider.name)"
            >
              测试
            </a-button>
            <a-button
              v-if="!provider.active"
              size="small"
              type="primary"
              ghost
              @click="switchProvider(provider.name)"
            >
              切换
            </a-button>
            <a-tag v-else color="green" style="margin: 0; line-height: 24px"
              >当前</a-tag
            >
          </div>
        </a-card>
      </div>

      <!-- Local Models (Ollama) -->
      <div v-if="providersStore.localModels.length" style="margin-top: 24px">
        <h3 style="color: #ccc; font-size: 15px; margin-bottom: 12px">
          本地模型（Ollama）
        </h3>
        <a-list
          :data-source="providersStore.localModels"
          size="small"
          style="
            background: var(--bg-card);
            border-radius: 8px;
            border: 1px solid var(--border-color);
          "
        >
          <template #renderItem="{ item }">
            <a-list-item style="padding: 10px 16px; border-color: #252525">
              <span
                style="color: #ccc; font-family: monospace; font-size: 13px"
                >{{ item.name }}</span
              >
              <template #actions>
                <a-tag color="cyan" style="font-size: 10px">{{
                  item.size || "local"
                }}</a-tag>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </div>

      <!-- LLM Parameter Settings -->
      <a-divider
        style="border-color: var(--border-color); margin: 32px 0 24px"
      />

      <a-alert
        v-if="showRestartHint"
        type="warning"
        show-icon
        closable
        style="margin-bottom: 16px"
        message="新的模型连接已保存"
        description="新建聊天或 Agent 会话后使用新连接。正在进行的请求和会话请完成或停止后再切换。"
        @close="showRestartHint = false"
      />

      <div
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        "
      >
        <h3 class="section-title">LLM 参数设置</h3>
        <a-button
          size="small"
          :loading="configLoading"
          @click="loadConfig"
          style="
            background: var(--bg-card-hover);
            border-color: var(--border-color);
          "
        >
          <template #icon><ReloadOutlined /></template>
          加载配置
        </a-button>
      </div>

      <a-card
        class="config-card"
        style="background: var(--bg-card); border-color: var(--border-color)"
      >
        <a-form :model="configForm" layout="vertical" class="config-form">
          <div class="config-grid">
            <a-form-item
              v-if="savedConnections.length"
              label="已保存渠道（自动恢复凭证）"
            >
              <a-select
                placeholder="选择之前保存的渠道"
                :disabled="configSaving || configLoading"
                :options="
                  savedConnections.map((row, index) => ({
                    value: index,
                    label: `${row.provider} · ${row.baseUrl} · ${row.model}`,
                  }))
                "
                @change="
                  (index) => selectSavedConnection(savedConnections[index])
                "
              />
            </a-form-item>
            <a-form-item label="服务渠道">
              <a-select
                v-model:value="channel"
                :disabled="configSaving || configLoading"
                :options="[
                  { value: 'lk', label: 'LK API 聚合平台' },
                  { value: 'manual', label: '官方服务 / 自定义渠道' },
                ]"
                @change="handleChannelChange"
              />
            </a-form-item>
            <a-form-item v-if="channel === 'lk'" label="LK 兼容协议">
              <a-select
                v-model:value="lkProtocol"
                :disabled="configSaving || configLoading"
                :options="
                  Object.entries(lkChannel.protocols).map(([value, entry]) => ({
                    value,
                    label: entry.label,
                  }))
                "
                @change="applyLk(false)"
              />
            </a-form-item>
            <a-form-item
              v-if="channel === 'lk'"
              label="主备地址（同一服务，手动切换）"
            >
              <a-select
                v-model:value="lkAddress"
                :disabled="configSaving || configLoading"
                :options="
                  Object.entries(lkChannel.addresses).map(([value, label]) => ({
                    value,
                    label,
                  }))
                "
                @change="applyLk(true)"
              />
            </a-form-item>
            <a-form-item v-if="channel === 'lk'" label="LK 对话模型目录">
              <a-select
                v-model:value="configForm.model"
                show-search
                option-filter-prop="label"
                :disabled="configSaving || configLoading"
                :options="lkModelOptions"
              />
              <a-button :loading="lkCatalogLoading" @click="refreshLkModels"
                >刷新模型</a-button
              >
              <small>{{
                lkCatalogSource === "live" ? "平台最新目录" : "内置离线目录"
              }}</small>
            </a-form-item>
            <!-- Provider -->
            <a-form-item v-if="channel !== 'lk'" label="Provider（提供商）">
              <a-select
                v-model:value="configForm.provider"
                placeholder="选择 LLM 提供商"
                :options="providerOptions"
                style="width: 100%"
                :disabled="configSaving"
                @change="handleProviderChange"
              />
            </a-form-item>

            <!-- Model -->
            <a-form-item label="Model（模型名称）">
              <a-input
                v-model:value="configForm.model"
                placeholder="例如 doubao-seed-1-6-251015"
                allow-clear
                :disabled="configSaving"
              />
            </a-form-item>

            <!-- API Key -->
            <a-form-item label="API Key">
              <a-input-password
                v-model:value="configForm.apiKey"
                :placeholder="keyPlaceholder"
                autocomplete="new-password"
                :disabled="configSaving"
              />
            </a-form-item>

            <!-- Base URL -->
            <a-form-item label="Base URL">
              <a-input
                v-model:value="configForm.baseUrl"
                :readonly="channel === 'lk'"
                placeholder="例如 https://ark.cn-beijing.volces.com/api/v3"
                allow-clear
                :disabled="configSaving"
              />
            </a-form-item>

            <!-- Temperature -->
            <a-form-item label="Temperature（温度）">
              <div style="display: flex; align-items: center; gap: 12px">
                <a-slider
                  v-model:value="configForm.temperature"
                  :min="0"
                  :max="2"
                  :step="0.1"
                  style="flex: 1"
                  :disabled="configSaving"
                />
                <a-input-number
                  v-model:value="configForm.temperature"
                  :min="0"
                  :max="2"
                  :step="0.1"
                  :precision="1"
                  style="width: 80px"
                  :disabled="configSaving"
                />
              </div>
            </a-form-item>

            <!-- Max Tokens -->
            <a-form-item label="Max Tokens（最大输出长度）">
              <a-input-number
                v-model:value="configForm.maxTokens"
                :min="256"
                :max="128000"
                :step="256"
                style="width: 100%"
                placeholder="4096"
                :disabled="configSaving"
              />
            </a-form-item>
          </div>

          <a-alert
            v-if="channel === 'lk'"
            type="info"
            show-icon
            style="margin-bottom: 16px"
          >
            <template #message
              >模型按协议筛选，支持填写新别名。首次配置填写 LK
              Key，主备和协议切换会恢复已存凭证。</template
            >
            <template #description>
              目录包含 197 个模型，其中 83
              个用于对话；实际可用性以账户权限为准。 媒体接口提供文档参考。<a
                :href="lkChannel.documentationUrl"
                target="_blank"
                rel="noopener noreferrer"
                >开发文档</a
              >
              ·
              <a
                :href="lkChannel.pricingUrl"
                target="_blank"
                rel="noopener noreferrer"
                >定价</a
              >
            </template>
          </a-alert>
          <a-checkbox
            v-if="remoteHttp"
            v-model:checked="configForm.allowHttp"
            :disabled="configSaving"
          >
            允许以未加密 HTTP 访问此远程接口
          </a-checkbox>
          <p style="color: var(--text-muted)">
            密钥留空会恢复该渠道已保存的凭证。首次配置新服务时填写其自己的
            Key。测试连接会发送一次简短请求，可能产生费用。
          </p>

          <div
            style="
              display: flex;
              gap: 12px;
              justify-content: flex-end;
              margin-top: 16px;
            "
          >
            <a-button
              @click="resetForm"
              :disabled="configSaving"
              style="
                background: var(--bg-card-hover);
                border-color: var(--border-color);
              "
            >
              重置
            </a-button>
            <a-button
              :disabled="!configReady || connectionDirty || configSaving"
              :loading="providersStore.testing === configForm.provider"
              @click="testSavedConnection"
              >测试已保存连接</a-button
            >
            <a-button
              type="primary"
              :loading="configSaving"
              :disabled="!configReady || configLoading"
              @click="saveConfig"
            >
              保存配置
            </a-button>
          </div>
        </a-form>
      </a-card>
      <LkAccount
        v-if="channel === 'lk'"
        :disabled="
          !configReady || connectionDirty || configSaving || configLoading
        "
        :connection-id="`${configForm.provider}:${configForm.baseUrl}:${configForm.model}`"
      />
    </div>
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { ReloadOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { useProvidersStore } from "../stores/providers.js";
import { useWsStore } from "../stores/ws.js";
import { useLlmConfiguration } from "../composables/useLlmConfiguration.js";
import LkAccount from "../components/LkAccount.vue";

const providersStore = useProvidersStore();
const ws = useWsStore();

const {
  configForm,
  configLoading,
  configSaving,
  configReady,
  showRestartHint,
  channel,
  lkProtocol,
  lkCatalogSource,
  lkCatalogLoading,
  refreshLkModels,
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
} = useLlmConfiguration(ws, providersStore, message);

const knownProviders = [
  "custom",
  "ollama",
  "volcengine",
  "deepseek",
  "gemini",
  "openai",
  "anthropic",
  "groq",
  "mistral",
  "zhipu",
];

const providerLabels = {
  ollama: "Ollama（本地）",
  openai: "OpenAI",
  anthropic: "Anthropic",
  volcengine: "火山引擎（豆包）",
  deepseek: "DeepSeek",
  gemini: "Google Gemini",
  groq: "Groq",
  mistral: "Mistral",
  custom: "Custom（自定义）",
  zhipu: "智谱 AI",
};

const providerOptions = knownProviders.map((name) => ({
  value: name,
  label: providerLabels[name] || name,
}));

async function switchProvider(name) {
  try {
    await providersStore.switchProvider(name);
    message.success(`已切换到 ${name}`);
  } catch (e) {
    message.error(`切换失败: ${e.message}`);
  }
}

async function test(name) {
  const ok = await providersStore.testProvider(name);
  if (ok) {
    message.success(`${name} 连接正常`);
  } else {
    message.warning(`${name} 连接失败，请检查配置`);
  }
}

onMounted(() => {
  providersStore.loadProviders();
  loadConfig();
});
</script>

<style scoped>
.providers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.provider-card {
  border: 1px solid var(--border-color) !important;
  transition: border-color 0.2s;
}
.provider-card:hover {
  border-color: var(--text-muted) !important;
}
.provider-card.active {
  border-color: #52c41a !important;
  background: rgba(41, 162, 112, 0.08) !important;
}

.section-title {
  color: var(--text-primary, #ccc);
  font-size: 16px;
  font-weight: 500;
  margin: 0;
}

.config-card {
  border-radius: 8px;
}

.config-card :deep(.ant-card-body) {
  padding: 24px;
}

.config-form :deep(.ant-form-item-label > label) {
  color: var(--text-secondary, #aaa);
  font-size: 13px;
}

.config-form :deep(.ant-input),
.config-form :deep(.ant-input-password input),
.config-form :deep(.ant-input-number),
.config-form :deep(.ant-select-selector) {
  background: var(--bg-card-hover, #1a1a1a) !important;
  border-color: var(--border-color, #333) !important;
  color: var(--text-primary, #e0e0e0) !important;
}

.config-form :deep(.ant-input::placeholder),
.config-form :deep(.ant-input-password input::placeholder) {
  color: var(--text-muted, #555) !important;
}

.config-form :deep(.ant-input-number-input) {
  color: var(--text-primary, #e0e0e0) !important;
}

.config-form :deep(.ant-select-selection-item) {
  color: var(--text-primary, #e0e0e0) !important;
}

.config-form :deep(.ant-select-arrow) {
  color: var(--text-muted, #555);
}

.config-form :deep(.ant-slider-rail) {
  background: var(--border-color, #333);
}

.config-form :deep(.ant-slider-track) {
  background: #1890ff;
}

.config-form :deep(.ant-slider-handle) {
  border-color: #1890ff;
}

.config-form :deep(.ant-input-password-icon) {
  color: var(--text-muted, #555);
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 24px;
}

@media (max-width: 640px) {
  .config-grid {
    grid-template-columns: 1fr;
  }
}
</style>
