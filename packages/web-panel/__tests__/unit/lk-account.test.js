import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
const state = vi.hoisted(() => ({ sendRaw: vi.fn() }));
vi.mock("../../src/stores/ws.js", () => ({ useWsStore: () => state }));
import LkAccount from "../../src/components/LkAccount.vue";

const stubs = {
  "a-card": { template: "<section><slot /></section>" },
  "a-space": { template: "<div><slot /></div>" },
  "a-select": true,
  "a-alert": { props: ["message"], template: "<p>{{message}}</p>" },
  "a-button": {
    props: ["disabled"],
    template: '<button :disabled="disabled"><slot /></button>',
  },
  "a-table": true,
};
const account = {
  fetchedAt: "2026-11-15T00:00:00Z",
  origin: "https://api.vv666.ai",
  model: "gpt-6.1-sol",
  days: 1,
  scope: "key",
  balance: { balance: 0, quota: { used: 2, unlimited: true } },
  usage: { total: { cost: 1.5, count: 2 } },
  records: { rows: [], offset: 0, total: 0 },
  pricing: { groups: [] },
  errors: {},
  partial: false,
};
beforeEach(() => {
  state.sendRaw.mockReset();
});
const create = () =>
  mount(LkAccount, {
    props: { connectionId: "saved-connection", disabled: false },
    global: { stubs },
  });

describe("LK account UI", () => {
  it("queries only saved credentials and distinguishes zero balance, unlimited quota and platform charges", async () => {
    state.sendRaw.mockResolvedValue({ success: true, account });
    const wrapper = create();
    await wrapper.find("button").trigger("click");
    await flushPromises();
    expect(state.sendRaw).toHaveBeenCalledWith(
      { type: "llm-account", days: 1, scope: "key", limit: 20, offset: 0 },
      20000,
    );
    expect(wrapper.text()).toContain("账户余额：0 算力");
    expect(wrapper.text()).toContain("Key 剩余：不限额");
    expect(wrapper.text()).toContain("API 实扣：1.5 算力");
    expect(wrapper.text()).toContain("账单不返回 Token 数");
    wrapper.unmount();
  });
  it("discards a late response after the saved connection changes", async () => {
    let finish;
    state.sendRaw.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = create();
    await wrapper.find("button").trigger("click");
    await flushPromises();
    await wrapper.setProps({ connectionId: "another-key" });
    finish({ success: true, account });
    await flushPromises();
    expect(wrapper.text()).not.toContain("API 实扣：1.5");
    wrapper.unmount();
  });
  it("clears previous balances when a refresh fails instead of displaying them as current", async () => {
    state.sendRaw
      .mockResolvedValueOnce({ success: true, account })
      .mockRejectedValueOnce(new Error("private upstream"));
    const wrapper = create();
    await wrapper.find("button").trigger("click");
    await flushPromises();
    await wrapper.find("button").trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("API 实扣：1.5");
    expect(wrapper.text()).toContain("查询失败");
    expect(wrapper.text()).not.toContain("private upstream");
    wrapper.unmount();
  });
});
