<template>
  <a-card title="LK 动态价格与实际账单" style="margin-top: 24px">
    <a-space wrap style="margin-bottom: 16px">
      <a-select
        v-model:value="days"
        :options="[
          { value: 1, label: '最近 1 天' },
          { value: 7, label: '最近 7 天' },
          { value: 30, label: '最近 30 天' },
        ]"
      />
      <a-select
        v-model:value="scope"
        :options="[
          { value: 'key', label: '当前 Key API 用量' },
          { value: 'user', label: '账户全部 Key API 用量' },
        ]"
      />
      <a-button :loading="loading" :disabled="disabled" @click="refresh(0)"
        >刷新价格与余额</a-button
      >
    </a-space>
    <p>
      使用已保存连接的 Key 查询。金额单位为算力，价格为算力 / 百万
      Token；不自动折算充值现金成本。
    </p>
    <a-alert v-if="error" type="error" :message="error" />
    <template v-if="account">
      <p>
        查询时间：{{ account.fetchedAt }} · {{ account.origin }} ·
        {{ account.model }}
      </p>
      <p>
        <strong>账户余额：{{ amount(account.balance?.balance) }} 算力</strong> ·
        Key 已用：{{ amount(account.balance?.quota?.used) }} · Key 剩余：{{
          account.balance?.quota?.unlimited
            ? "不限额"
            : amount(account.balance?.quota?.remaining)
        }}
      </p>
      <p>
        最近 {{ account.days }} 天{{
          account.scope === "user" ? "全部 Key" : "当前 Key"
        }}
        API 实扣：{{ amount(account.usage?.total?.cost) }} 算力 · 请求
        {{ amount(account.usage?.total?.count) }} 次
      </p>
      <a-alert
        v-if="account.partial"
        type="warning"
        :message="
          Object.entries(account.errors)
            .map(([kind, value]) => `${kind}: ${value}`)
            .join('；')
        "
      />
      <a-table
        size="small"
        :pagination="false"
        :columns="priceColumns"
        :data-source="account.pricing?.groups || []"
        :row-key="(_, index) => index"
        :scroll="{ x: 650 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'state'"
            >{{ record.active ? "启用" : "停用" }} /
            {{ record.allowed ? "Key 可用" : "Key 不可用" }}</template
          >
          <template v-else>{{ record[column.dataIndex] ?? "未知" }}</template>
        </template>
      </a-table>
      <p style="margin-top: 16px">
        平台账单（{{ account.records?.total ?? "未知" }} 条）
      </p>
      <a-table
        size="small"
        :pagination="false"
        :columns="billColumns"
        :data-source="account.records?.rows || []"
        row-key="taskId"
        :scroll="{ x: 750 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'refund'">{{
            record.refunded ? `已退 ${amount(record.refundedAmount)}` : "—"
          }}</template>
          <template v-else>{{ record[column.dataIndex] ?? "未知" }}</template>
        </template>
      </a-table>
      <a-space style="margin-top: 12px">
        <a-button
          :disabled="loading || disabled || !account.records?.offset"
          @click="refresh(Math.max(0, account.records.offset - 20))"
          >上一页</a-button
        >
        <a-button
          :disabled="
            loading ||
            disabled ||
            !account.records ||
            account.records.offset + account.records.rows.length >=
              account.records.total
          "
          @click="refresh(account.records.offset + 20)"
          >下一页</a-button
        >
      </a-space>
    </template>
    <p style="margin-top: 16px">
      当前价格已含时段折扣；实际路由分组以账单为准。运行中的费用可能仍为预扣，退款已计入实扣金额。账单保留四位，小额显示
      0 不代表免费。账户余额还包括其他 Key 和网页等消费。
    </p>
    <p>
      模型实际返回的 Token 用量在 Token 统计中查看。平台账单不返回 Token
      数，暂不将本地请求与账单逐条关联。
    </p>
  </a-card>
</template>

<script setup>
import { ref, watch } from "vue";
import { useWsStore } from "../stores/ws.js";
const props = defineProps({ disabled: Boolean, connectionId: String });
const ws = useWsStore();
const loading = ref(false),
  error = ref(""),
  account = ref(null),
  days = ref(1),
  scope = ref("key");
let generation = 0;
watch(
  () => [props.connectionId, props.disabled],
  () => {
    generation++;
    account.value = null;
    error.value = "";
  },
);
watch([days, scope], () => {
  generation++;
  account.value = null;
  error.value = "";
});
const amount = (value) => value ?? "未知";
const priceColumns = [
  { title: "分组", dataIndex: "name" },
  { title: "计费方式", dataIndex: "billingMethod" },
  { title: "基础价格", dataIndex: "basePrice" },
  { title: "输入 / 百万 Token", dataIndex: "inputPerMillion" },
  { title: "输出 / 百万 Token", dataIndex: "outputPerMillion" },
  { title: "状态", key: "state" },
];
const billColumns = [
  { title: "任务", dataIndex: "taskId" },
  { title: "模型", dataIndex: "model" },
  { title: "分组", dataIndex: "group" },
  { title: "状态", dataIndex: "state" },
  { title: "实扣算力", dataIndex: "cost" },
  { title: "退款", key: "refund" },
  { title: "时间", dataIndex: "createdAt" },
];
async function refresh(offset) {
  if (loading.value || props.disabled) return;
  const current = ++generation;
  loading.value = true;
  error.value = "";
  account.value = null;
  try {
    await ws.waitConnected?.(8000);
    const response = await ws.sendRaw(
      {
        type: "llm-account",
        days: days.value,
        scope: scope.value,
        limit: 20,
        offset,
      },
      20000,
    );
    if (!response?.success || !response.account) throw new Error();
    if (current === generation) account.value = response.account;
  } catch {
    if (current === generation)
      error.value = "查询失败，请确认已保存 LK 连接及 Key 后刷新";
  } finally {
    loading.value = false;
  }
}
</script>
