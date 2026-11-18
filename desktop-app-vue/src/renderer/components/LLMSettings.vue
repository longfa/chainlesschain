<template>
  <div class="llm-settings">
    <a-card title="LLM 服务设置" :loading="loading">
      <a-form
        :model="form"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
        @finish="handleSave"
      >
        <a-form-item v-if="form.savedConnections?.length" label="已保存渠道">
          <a-select
            v-model:value="form.restoreConnectionId"
            placeholder="选择后保存，自动恢复该渠道凭证"
            :options="
              form.savedConnections.map((row) => ({
                value: row.id,
                label: `${row.channel === 'lk' ? 'LK API' : row.provider} · ${row.model}`,
              }))
            "
          />
        </a-form-item>
        <a-form-item label="渠道预设">
          <a-space wrap>
            <span>LK API</span>
            <a-select
              v-model:value="lkProtocol"
              style="width: 235px"
              @change="handleLkProtocolChange"
            >
              <a-select-option
                v-for="(protocol, id) in LK_CHANNEL.protocols"
                :key="id"
                :value="id"
              >
                {{ protocol.label }}
              </a-select-option>
            </a-select>
            <a-select
              v-model:value="lkModel"
              show-search
              style="width: 290px"
              placeholder="选择模型"
            >
              <a-select-option
                v-for="model in lkChatModels"
                :key="model.id"
                :value="model.id"
                >{{ model.label }} ({{ model.id }})</a-select-option
              >
            </a-select>
            <a-select v-model:value="lkAddress" style="width: 265px">
              <a-select-option value="primary">主 api.vv666.ai</a-select-option>
              <a-select-option value="backup"
                >备用 api.lk666.ai</a-select-option
              >
            </a-select>
            <a-button @click="applyLkPreset">使用此渠道</a-button>
          </a-space>
          <div class="form-hint">
            主备地址为同一服务，访问不畅时可手动切换。FB-5.2 使用 Anthropic
            协议。
            <a
              :href="LK_CHANNEL.documentationUrl"
              target="_blank"
              rel="noopener noreferrer"
              >开发文档</a
            >
            ·
            <a
              :href="`${LK_CHANNEL.pricingUrl}?model=${encodeURIComponent(lkModel)}`"
              target="_blank"
              rel="noopener noreferrer"
              >模型定价</a
            >
          </div>
          <details class="form-hint">
            <summary>五类协议与接口地址</summary>
            <div v-for="(path, name) in LK_CHANNEL.endpoints" :key="name">
              {{ name }}: {{ LK_CHANNEL.addresses[lkAddress] }}{{ path }}
            </div>
            <div>
              图片接口仅部分图片模型可用；媒体生成与 Skills 在此提供接口参考。
            </div>
            <div v-for="type in ['image', 'video', 'audio']" :key="type">
              {{ type }} 模型：
              <a
                v-for="model in LK_MODELS.filter(
                  (entry) => entry.type === type,
                )"
                :key="model.id"
                :href="`${LK_CHANNEL.documentationUrl}#model/${encodeURIComponent(model.id)}`"
                target="_blank"
                rel="noopener noreferrer"
                style="margin-right: 8px"
                >{{ model.label }}</a
              >
            </div>
          </details>
        </a-form-item>
        <a-form-item label="LK 价格与实际账单">
          <a-space wrap
            ><a-select
              v-model:value="accountDays"
              :options="[
                { value: 1, label: '最近 1 天' },
                { value: 7, label: '最近 7 天' },
                { value: 30, label: '最近 30 天' },
              ]"
            /><a-select
              v-model:value="accountScope"
              :options="[
                { value: 'key', label: '当前 Key API 用量' },
                { value: 'user', label: '全部 Key API 用量' },
              ]"
            /><a-button :loading="accountLoading" @click="refreshAccount"
              >刷新价格与余额</a-button
            ></a-space
          >
          <p>
            查询已保存 LK 连接；修改后请先保存。Token
            统计与平台实扣算力分开展示。
          </p>
          <pre
            v-if="accountText"
            style="white-space: pre-wrap; max-height: 420px; overflow: auto"
            >{{ accountText }}</pre>
        </a-form-item>
        <!-- 提供商选择 -->
        <a-form-item label="服务提供商">
          <a-radio-group
            v-model:value="form.provider"
            @change="handleProviderChange"
          >
            <a-radio-button value="ollama"> Ollama (本地) </a-radio-button>
            <a-radio-button value="openai"> OpenAI </a-radio-button>
            <a-radio-button value="anthropic">
              Claude (Anthropic)
            </a-radio-button>
            <a-radio-button value="volcengine"> 豆包 (字节) </a-radio-button>
            <a-radio-button value="deepseek"> DeepSeek </a-radio-button>
            <a-radio-button value="gemini"> Gemini </a-radio-button>
            <a-radio-button value="custom"> 自定义API </a-radio-button>
          </a-radio-group>
          <div class="form-hint">选择LLM服务提供商</div>
        </a-form-item>

        <!-- Ollama 配置 -->
        <template v-if="form.provider === 'ollama'">
          <a-divider orientation="left"> Ollama 配置 </a-divider>

          <a-form-item label="服务地址">
            <a-input
              v-model:value="form.ollama.url"
              placeholder="http://localhost:11434"
            />
            <div class="form-hint">
              Ollama 服务的地址，默认为 http://localhost:11434
            </div>
          </a-form-item>

          <a-form-item label="模型">
            <a-input
              v-model:value="form.ollama.model"
              placeholder="输入模型名称，如 llama3.2, qwen2.5, mistral"
            />
            <div class="form-hint">
              常用模型: llama3.2, llama3.1, qwen2.5, qwen2, mistral, codellama,
              gemma2
            </div>
          </a-form-item>
        </template>

        <!-- OpenAI 配置 -->
        <template v-if="form.provider === 'openai'">
          <a-divider orientation="left"> OpenAI 配置 </a-divider>

          <a-form-item label="API Key" required>
            <a-input-password
              v-model:value="form.openai.apiKey"
              placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <div class="form-hint">OpenAI API 密钥</div>
          </a-form-item>

          <a-form-item label="API 地址">
            <a-input
              v-model:value="form.openai.baseURL"
              placeholder="https://api.openai.com/v1"
            />
            <div class="form-hint">默认为官方API地址，使用代理时可修改</div>
          </a-form-item>

          <a-form-item label="模型">
            <a-input
              v-model:value="form.openai.model"
              placeholder="输入模型名称，如 gpt-4o, gpt-4-turbo, gpt-3.5-turbo"
            />
            <div class="form-hint">
              常用模型: gpt-4o, gpt-4-turbo, gpt-4, gpt-3.5-turbo, gpt-4o-mini
            </div>
          </a-form-item>

          <a-form-item label="Organization ID">
            <a-input
              v-model:value="form.openai.organization"
              placeholder="org-xxxxxxxxxxxxxxxx (可选)"
            />
            <div class="form-hint">组织ID（可选）</div>
          </a-form-item>
        </template>

        <!-- Anthropic Claude 配置 -->
        <template v-if="form.provider === 'anthropic'">
          <a-divider orientation="left"> Claude (Anthropic) 配置 </a-divider>

          <a-form-item label="API Key" required>
            <a-input-password
              v-model:value="form.anthropic.apiKey"
              placeholder="sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <div class="form-hint">Anthropic API 密钥</div>
          </a-form-item>

          <a-form-item label="API 地址">
            <a-input
              v-model:value="form.anthropic.baseURL"
              placeholder="https://api.anthropic.com"
            />
            <div class="form-hint">默认官方 API 地址，可用于代理/私有部署</div>
          </a-form-item>

          <a-form-item label="模型">
            <a-input
              v-model:value="form.anthropic.model"
              placeholder="输入模型名称，如 claude-sonnet-4-6"
            />
            <div class="form-hint">
              常用模型: claude-sonnet-4-6, claude-opus-4-8, claude-haiku-4-5
            </div>
          </a-form-item>
        </template>

        <!-- DeepSeek 配置 -->
        <template v-if="form.provider === 'deepseek'">
          <a-divider orientation="left"> DeepSeek 配置 </a-divider>

          <a-form-item label="API 地址">
            <a-input
              v-model:value="form.deepseek.baseURL"
              placeholder="https://api.deepseek.com/v1"
            />
            <div class="form-hint">
              DeepSeek API 地址（可选，默认使用官方地址）
            </div>
          </a-form-item>

          <a-form-item label="API Key" required>
            <a-input-password
              v-model:value="form.deepseek.apiKey"
              placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <div class="form-hint">DeepSeek API 密钥</div>
          </a-form-item>

          <a-form-item label="模型">
            <a-input
              v-model:value="form.deepseek.model"
              placeholder="输入模型名称，如 deepseek-chat, deepseek-coder"
            />
            <div class="form-hint">常用模型: deepseek-chat, deepseek-coder</div>
          </a-form-item>
        </template>

        <!-- 豆包（火山引擎）配置 -->
        <template v-if="form.provider === 'volcengine'">
          <a-divider orientation="left"> 豆包（火山引擎）配置 </a-divider>

          <a-form-item label="API 地址">
            <a-input
              v-model:value="form.volcengine.baseURL"
              placeholder="https://ark.cn-beijing.volces.com/api/v3"
            />
            <div class="form-hint">
              火山引擎 API 地址（可选，默认使用官方地址）
            </div>
          </a-form-item>

          <a-form-item label="API Key" required>
            <a-input-password
              v-model:value="form.volcengine.apiKey"
              placeholder="输入火山引擎 API Key"
            />
            <div class="form-hint">
              火山引擎 API 密钥，从 https://console.volcengine.com/ark 获取
            </div>
          </a-form-item>

          <a-form-item label="模型">
            <a-select
              v-model:value="form.volcengine.model"
              placeholder="选择或输入模型名称"
              :options="volcengineModelOptions"
              show-search
              allow-clear
              :filter-option="filterOption"
            />
            <div class="form-hint">
              选择常用模型或输入自定义模型名称（必须包含年月版本号，如
              doubao-pro-32k-241202）
            </div>
          </a-form-item>
        </template>

        <template v-if="form.provider === 'gemini'">
          <a-divider orientation="left">Gemini 配置</a-divider>
          <a-form-item label="API 地址" required>
            <a-input v-model:value="form.gemini.baseURL" />
          </a-form-item>
          <a-form-item label="API Key" required>
            <a-input-password v-model:value="form.gemini.apiKey" />
          </a-form-item>
          <a-form-item label="模型名称" required>
            <a-input
              v-model:value="form.gemini.model"
              placeholder="填写渠道模型标识符"
            />
          </a-form-item>
        </template>

        <!-- 自定义 API 配置 -->
        <template v-if="form.provider === 'custom'">
          <a-divider orientation="left"> 自定义 API 配置 </a-divider>

          <a-form-item label="服务名称">
            <a-input
              v-model:value="form.custom.name"
              placeholder="自定义服务名称"
            />
          </a-form-item>

          <a-form-item label="API 地址" required>
            <a-input
              v-model:value="form.custom.baseURL"
              placeholder="https://api.example.com/v1"
            />
            <div class="form-hint">
              兼容 OpenAI API 格式的服务地址；支持力数、vLLM、SGLang
              等本地算力平台，例如 http://192.168.1.100:8000/v1
            </div>
          </a-form-item>

          <a-form-item label="API Key">
            <a-input-password
              v-model:value="form.custom.apiKey"
              placeholder="API密钥（如需要）"
            />
          </a-form-item>

          <a-form-item label="模型名称" required>
            <a-input
              v-model:value="form.custom.model"
              placeholder="model-name"
            />
            <div class="form-hint">
              填写平台 API 返回的模型标识符，可能与管理页显示名称不同
            </div>
          </a-form-item>
        </template>

        <!-- 通用选项 -->
        <a-divider orientation="left"> 生成参数 </a-divider>

        <a-form-item label="Temperature">
          <a-slider
            v-model:value="form.options.temperature"
            :min="0"
            :max="2"
            :step="0.1"
            :marks="{ 0: '0', 1: '1', 2: '2' }"
          />
          <div class="form-hint">
            控制随机性。值越高，输出越随机；值越低，输出越确定。推荐 0.7
          </div>
        </a-form-item>

        <a-form-item label="Top P">
          <a-slider
            v-model:value="form.options.top_p"
            :min="0"
            :max="1"
            :step="0.05"
            :marks="{ 0: '0', 0.5: '0.5', 1: '1' }"
          />
          <div class="form-hint">核采样参数。推荐 0.9</div>
        </a-form-item>

        <a-form-item label="Top K">
          <a-input-number
            v-model:value="form.options.top_k"
            :min="1"
            :max="100"
            style="width: 120px"
          />
          <div class="form-hint">仅保留概率最高的K个词。推荐 40</div>
        </a-form-item>

        <a-form-item label="最大Token数">
          <a-input-number
            v-model:value="form.options.max_tokens"
            :min="100"
            :max="32000"
            :step="100"
            style="width: 150px"
          />
          <div class="form-hint">单次生成的最大token数量</div>
        </a-form-item>

        <a-form-item label="超时时间">
          <a-input-number
            v-model:value="timeoutSeconds"
            :min="10"
            :max="300"
            style="width: 120px"
          />
          <span class="unit-text">秒</span>
          <div class="form-hint">API请求超时时间</div>
        </a-form-item>

        <!-- 系统提示词 -->
        <a-divider orientation="left"> 系统设置 </a-divider>

        <a-form-item label="系统提示词">
          <a-textarea
            v-model:value="form.systemPrompt"
            :rows="4"
            placeholder="输入系统提示词..."
          />
          <div class="form-hint">定义AI助手的角色和行为</div>
        </a-form-item>

        <a-form-item label="启用流式输出">
          <a-switch v-model:checked="form.streamEnabled" />
          <div class="form-hint">启用后，响应将逐字显示</div>
        </a-form-item>

        <a-form-item label="自动保存对话">
          <a-switch v-model:checked="form.autoSaveConversations" />
          <div class="form-hint">自动保存对话历史到数据库</div>
        </a-form-item>

        <!-- 操作按钮 -->
        <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
          <a-space>
            <a-button type="primary" html-type="submit" :loading="saving">
              保存设置
            </a-button>
            <a-button :loading="testing" @click="handleTest">
              测试连接
            </a-button>
            <a-button @click="handleReset"> 恢复默认 </a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- 连接状态 -->
    <a-card title="服务状态" class="status-card" style="margin-top: 16px">
      <a-descriptions bordered :column="2">
        <a-descriptions-item label="服务状态">
          <a-tag v-if="status.available" color="success"> 可用 </a-tag>
          <a-tag v-else color="error"> 不可用 </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="当前提供商">
          {{ getProviderName(status.provider) }}
        </a-descriptions-item>
        <a-descriptions-item v-if="status.models" label="可用模型数" :span="2">
          {{ status.models.length }}
        </a-descriptions-item>
        <a-descriptions-item v-if="status.error" label="错误信息" :span="2">
          <a-typography-text type="danger">
            {{ status.error }}
          </a-typography-text>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- Token 使用概览卡片 -->
    <TokenStatsCard />
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, reactive, computed, onMounted, watch } from "vue";
import { message } from "ant-design-vue";
import TokenStatsCard from "./TokenStatsCard.vue";
const accountDays = ref(1),
  accountScope = ref("key"),
  accountLoading = ref(false),
  accountText = ref("");
let accountGeneration = 0;
const refreshAccount = async () => {
  accountLoading.value = true;
  accountText.value = "";
  const generation = ++accountGeneration;
  try {
    const result = await window.electronAPI.llm.getLkAccount({
      days: accountDays.value,
      scope: accountScope.value,
    });
    if (generation === accountGeneration)
      accountText.value = result.formattedText;
  } catch {
    if (generation === accountGeneration)
      accountText.value = "查询失败，请确认已保存 LK 连接及 Key 后重试";
  } finally {
    accountLoading.value = false;
  }
};
import {
  LK_CHANNEL,
  LK_MODELS,
  resolveLkConnection,
} from "../../../../packages/cli/src/lib/llm-channel-presets.js";

const lkProtocol = ref("openai");
const lkAddress = ref("primary");
const lkModel = ref("gpt-6.1-sol");
const lkChatModels = computed(() =>
  LK_MODELS.filter(
    (model) =>
      model.type === "chat" &&
      model.compatibleProtocols.includes(lkProtocol.value),
  ),
);
const handleLkProtocolChange = () => {
  lkModel.value = LK_CHANNEL.protocols[lkProtocol.value].defaultModel;
};
const applyLkPreset = () => {
  const connection = resolveLkConnection(lkProtocol.value, lkAddress.value, {
    desktop: true,
    model: lkModel.value,
  });
  const previous = form[connection.provider] || {};
  const sameChannel = Object.values(LK_CHANNEL.addresses).some((origin) =>
    [origin, `${origin}/v1`, `${origin}/v1beta`].includes(previous.baseURL),
  );
  form[connection.provider] = {
    ...previous,
    name: LK_CHANNEL.name,
    baseURL: connection.baseUrl,
    apiKey: sameChannel ? previous.apiKey : "",
    apiKeyConfigured: form.savedConnections.some(
      (row) => row.channel === "lk" && row.hasKey,
    ),
    model: connection.model,
  };
  form.provider = connection.provider;
};

// 状态
const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const modelsLoading = ref(false);
const availableModels = ref([]);
const status = ref({
  available: false,
  provider: "",
  models: [],
  error: null,
});

// 火山引擎模型选项
const volcengineModelOptions = [
  {
    label: "deepseek-v4-1-flash-economy-261017（默认）",
    value: "deepseek-v4-1-flash-economy-261017",
  },
  {
    label: "deepseek-v4-1-flash-260910",
    value: "deepseek-v4-1-flash-260910",
  },
  // Doubao Seed 1.6 系列
  {
    label: "doubao-seed-1-6-251015（支持reasoning_effort）",
    value: "doubao-seed-1-6-251015",
  },
  {
    label: "doubao-seed-1-6-250615（支持thinking控制）",
    value: "doubao-seed-1-6-250615",
  },

  // Doubao 1.5 系列
  {
    label: "doubao-1-5-pro-32k-250115（高性能32k）",
    value: "doubao-1-5-pro-32k-250115",
  },
  {
    label: "doubao-1-5-lite-250115（轻量版）",
    value: "doubao-1-5-lite-250115",
  },
  {
    label: "doubao-1-5-vision-pro-250115（视觉模型）",
    value: "doubao-1-5-vision-pro-250115",
  },

  // Doubao Pro 系列
  {
    label: "doubao-pro-32k-241215（高性能32k）",
    value: "doubao-pro-32k-241215",
  },
  { label: "doubao-pro-32k-240828", value: "doubao-pro-32k-240828" },

  // 其他版本
  { label: "doubao-lite-32k（轻量32k）", value: "doubao-lite-32k" },
];

// 过滤选项
const filterOption = (input, option) => {
  return (
    option.value.toLowerCase().includes(input.toLowerCase()) ||
    option.label.toLowerCase().includes(input.toLowerCase())
  );
};

// 表单数据
const form = reactive({
  savedConnections: [],
  restoreConnectionId: "",
  provider: "ollama",

  ollama: {
    url: "http://localhost:11434",
    model: "llama2",
  },

  openai: {
    apiKey: "",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-3.5-turbo",
    organization: "",
  },

  anthropic: {
    apiKey: "",
    baseURL: "https://api.anthropic.com",
    model: "claude-opus-4-8",
    version: "2023-06-01",
  },

  deepseek: {
    apiKey: "",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },

  volcengine: {
    apiKey: "",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    model: "deepseek-v4-1-flash-economy-261017",
  },

  custom: {
    name: "Custom Provider",
    apiKey: "",
    baseURL: "",
    model: "",
  },

  gemini: {
    apiKey: "",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    model: "",
  },

  options: {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 2000,
    timeout: 120000,
  },

  systemPrompt:
    "You are a helpful AI assistant for a knowledge management system.",
  streamEnabled: true,
  autoSaveConversations: true,
});

// 超时时间（秒）
watch(
  () => [
    form.provider,
    form[form.provider]?.baseURL,
    form[form.provider]?.model,
    form.restoreConnectionId,
    accountDays.value,
    accountScope.value,
  ],
  () => {
    accountGeneration++;
    accountText.value = "";
  },
);
const timeoutSeconds = computed({
  get: () => Math.round(form.options.timeout / 1000),
  set: (val) => {
    form.options.timeout = val * 1000;
  },
});

// 加载配置
const loadConfig = async () => {
  loading.value = true;
  try {
    const config = await window.electronAPI.llm.getConfig();
    if (config) {
      Object.assign(form, config);
    }
  } catch (error) {
    logger.error("加载配置失败:", error);
    message.error("加载配置失败: " + error.message);
  } finally {
    loading.value = false;
  }
};

// 保存配置
const handleSave = async () => {
  saving.value = true;
  try {
    // 转换为普通对象以避免结构化克隆错误
    const plainConfig = JSON.parse(JSON.stringify(form));
    await window.electronAPI.llm.setConfig(plainConfig);
    await loadConfig();
    message.success("配置已保存");
    await checkStatus();
  } catch (error) {
    logger.error("保存配置失败:", error);
    message.error("保存配置失败: " + error.message);
  } finally {
    saving.value = false;
  }
};

// 测试连接
const handleTest = async () => {
  testing.value = true;
  try {
    if (form.restoreConnectionId) {
      await window.electronAPI.llm.setConfig(JSON.parse(JSON.stringify(form)));
      await loadConfig();
    }
    // 验证必填字段
    const activeConfig = form[form.provider];
    if (form.provider !== "ollama" && !activeConfig?.model?.trim()) {
      throw new Error("请先输入模型名称");
    }
    if (
      form.provider === "gemini" &&
      !form.gemini.apiKey &&
      !form.gemini.apiKeyConfigured
    ) {
      throw new Error("请先输入 Gemini API Key");
    }
    if (
      form.provider === "openai" &&
      !form.openai.apiKey &&
      !form.openai.apiKeyConfigured
    ) {
      throw new Error("请先输入 OpenAI API Key");
    }
    if (
      form.provider === "anthropic" &&
      !form.anthropic.apiKey &&
      !form.anthropic.apiKeyConfigured
    ) {
      throw new Error("请先输入 Claude API Key");
    }
    if (
      form.provider === "volcengine" &&
      !form.volcengine.apiKey &&
      !form.volcengine.apiKeyConfigured
    ) {
      throw new Error("请先输入火山引擎 API Key");
    }
    if (
      form.provider === "deepseek" &&
      !form.deepseek.apiKey &&
      !form.deepseek.apiKeyConfigured
    ) {
      throw new Error("请先输入 DeepSeek API Key");
    }
    if (
      form.provider === "custom" &&
      !form.custom.baseURL &&
      !form.custom.baseURLConfigured
    ) {
      throw new Error("请先输入自定义 API 地址");
    }

    // 先保存配置（转换为普通对象）
    const plainConfig = JSON.parse(JSON.stringify(form));
    await window.electronAPI.llm.setConfig(plainConfig);

    // 检查状态
    const result = await window.electronAPI.llm.checkStatus();

    if (result.available) {
      message.success("连接成功！服务正常运行");
      status.value = result;
    } else {
      message.error("连接失败: " + (result.error || "未知错误"));
      status.value = result;
    }
  } catch (error) {
    logger.error("测试连接失败:", error);
    message.error("测试失败: " + error.message);
  } finally {
    testing.value = false;
  }
};

// 恢复默认设置
const handleReset = () => {
  form.provider = "ollama";
  form.ollama = {
    url: "http://localhost:11434",
    model: "llama2",
  };
  form.openai = {
    apiKey: "",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-3.5-turbo",
    organization: "",
  };
  form.anthropic = {
    apiKey: "",
    baseURL: "https://api.anthropic.com",
    model: "claude-opus-4-8",
    version: "2023-06-01",
  };
  form.deepseek = {
    apiKey: "",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  };
  form.volcengine = {
    apiKey: "",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    model: "deepseek-v4-1-flash-economy-261017",
  };
  form.custom = {
    name: "Custom Provider",
    apiKey: "",
    baseURL: "",
    model: "",
  };
  form.gemini = {
    apiKey: "",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    model: "",
  };
  form.options = {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 2000,
    timeout: 120000,
  };
  form.systemPrompt =
    "You are a helpful AI assistant for a knowledge management system.";
  form.streamEnabled = true;
  form.autoSaveConversations = true;

  message.info("已恢复默认设置");
};

// 检查服务状态
const checkStatus = async () => {
  try {
    const result = await window.electronAPI.llm.checkStatus();
    status.value = result;
  } catch (error) {
    logger.error("检查状态失败:", error);
  }
};

// 加载可用模型
const loadModels = async () => {
  if (form.provider !== "ollama") {
    return;
  }

  modelsLoading.value = true;
  try {
    const models = await window.electronAPI.llm.listModels();
    availableModels.value = models;
  } catch (error) {
    logger.error("加载模型列表失败:", error);
  } finally {
    modelsLoading.value = false;
  }
};

// 模型下拉框显示时加载
const handleModelsDropdown = (visible) => {
  if (visible && availableModels.value.length === 0) {
    loadModels();
  }
};

// 提供商改变时
const handleProviderChange = () => {
  if (form.provider === "ollama") {
    loadModels();
  }
};

// 获取提供商名称
const getProviderName = (provider) => {
  const names = {
    ollama: "Ollama (本地)",
    openai: "OpenAI",
    anthropic: "Claude (Anthropic)",
    deepseek: "DeepSeek",
    gemini: "Gemini",
    volcengine: "豆包（火山引擎）",
    custom: "自定义API",
  };
  return names[provider] || provider;
};

// 格式化大小
const formatSize = (bytes) => {
  if (!bytes) {
    return "";
  }
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)}GB`;
};

// 组件挂载时
onMounted(() => {
  loadConfig();
  checkStatus();
});
</script>

<style scoped>
.llm-settings {
  height: 100%;
}

.llm-settings :deep(.ant-card) {
  max-width: 900px;
}

.form-hint {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  margin-top: 4px;
}

.unit-text {
  margin-left: 8px;
  color: rgba(0, 0, 0, 0.45);
}

.model-size {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  margin-left: 4px;
}

.status-card :deep(.ant-descriptions-item-label) {
  font-weight: 500;
}
</style>
