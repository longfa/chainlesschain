import { describe, it, expect, vi } from "vitest";
import {
  queryLkAccount,
  normalizeLkAccountPart,
  formatLkAccount,
} from "../../src/lib/lk-account.js";

const config = {
  llm: {
    provider: "custom",
    baseUrl: "https://api.lk666.ai/v1",
    model: "tt-6-luna",
    apiKey: "fixture-lk-secret",
  },
};
const fixtures = {
  balance: {
    balance: 0,
    unit: "算力",
    api_key_quota: { used: 3, limit: 0 },
    apiKey: "never-return",
  },
  usage: {
    unit: "算力",
    scope: "key",
    grand_total: { cost: 2, count: 3, refunded_cost: 1 },
    by_model: [],
  },
  records: {
    unit: "算力",
    total: 2,
    limit: 20,
    offset: 0,
    records: [
      { task_id: 12, model: "tt-6-luna", state: "success", cost: 2 },
      {
        task_id: 13,
        model: "tt-6-luna",
        state: "failed",
        cost: 0,
        refunded: true,
        refunded_amount: 1,
        apiKey: "never-return",
      },
    ],
  },
  pricing: {
    name: "tt-6-luna",
    available_for_this_key: true,
    channel_groups: [
      {
        group_name: "test",
        is_active: true,
        in_key_whitelist: true,
        excluded_for_this_key: false,
        billing_method: "按token",
        input_token_price: 2,
        output_token_price: 4,
        current_time_discount: 0.5,
      },
    ],
  },
};
const fetchFixture = (url) => {
  const kind = url.includes("pricing")
    ? "pricing"
    : url.includes("detail=1")
      ? "records"
      : url.includes("usage")
        ? "usage"
        : "balance";
  return Promise.resolve(new Response(JSON.stringify(fixtures[kind])));
};

describe("fresh LK account data", () => {
  it("uses only the saved LK credential and returns explicit schemas, not secrets or inferred token joins", async () => {
    vi.stubEnv("OPENAI_API_KEY", "foreign-key");
    vi.stubEnv("CC_API_KEY", "foreign-key");
    try {
      const fetcher = vi.fn(fetchFixture);
      const result = await queryLkAccount(
        { days: 7, scope: "user", offset: 20 },
        { config, fetcher },
      );
      expect(fetcher).toHaveBeenCalledTimes(4);
      for (const [url, options] of fetcher.mock.calls) {
        expect(url).toMatch(/^https:\/\/api\.lk666\.ai\/v1\/skills\//);
        expect(options.headers.Authorization).toBe("Bearer fixture-lk-secret");
        expect(options.redirect).toBe("error");
      }
      expect(
        fetcher.mock.calls.some(([url]) =>
          url.includes("days=7&scope=user&detail=1&limit=20&offset=20"),
        ),
      ).toBe(true);
      expect(result.balance).toMatchObject({
        balance: 0,
        unit: "算力",
        quota: { unlimited: true, remaining: null },
      });
      expect(result.usage.total.cost).toBe(2); // Already net of refunds.
      expect(result.records.rows[1]).toMatchObject({
        cost: 0,
        refunded: true,
        refundedAmount: 1,
      });
      expect(result.pricing.groups[0].inputPerMillion).toBe(2); // Discount already included.
      expect(result.pricing.tokenDivisor).toBe(1000000);
      expect(JSON.stringify(result)).not.toMatch(
        /never-return|fixture-lk-secret|foreign-key|inputTokens/,
      );
      expect(formatLkAccount(result)).toContain("不限额");
      expect(formatLkAccount(result)).toContain("账户余额：0 算力");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("never sends a foreign provider's credential or falls back to provider env", async () => {
    const fetcher = vi.fn();
    await expect(
      queryLkAccount(
        {},
        {
          config: {
            llm: { ...config.llm, baseUrl: "https://api.openai.com/v1" },
          },
          fetcher,
        },
      ),
    ).rejects.toThrow("LK connection");
    await expect(
      queryLkAccount(
        {},
        { config: { llm: { ...config.llm, apiKey: null } }, fetcher },
      ),
    ).rejects.toThrow("API key");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves partial success and hides upstream errors, HTML, secrets and redirects", async () => {
    const fetcher = vi.fn((url) =>
      url.includes("balance")
        ? Promise.reject(new Error("fixture-lk-secret"))
        : fetchFixture(url),
    );
    const result = await queryLkAccount({}, { config, fetcher });
    expect(result.partial).toBe(true);
    expect(result.balance).toBeNull();
    expect(result.usage.total.cost).toBe(2);
    expect(JSON.stringify(result)).not.toContain("fixture-lk-secret");
    const invalid = await queryLkAccount(
      {},
      { config, fetcher: async () => new Response("<html>private</html>") },
    );
    expect(Object.keys(invalid.errors)).toHaveLength(4);
    expect(invalid.pricing).toBeNull();
  });
  it("validates query bounds before reading config or issuing requests", async () => {
    const fetcher = vi.fn();
    for (const options of [
      { days: 31 },
      { days: 0 },
      { scope: "account" },
      { limit: 201 },
      { offset: -1 },
    ])
      await expect(
        queryLkAccount(options, { config, fetcher }),
      ).rejects.toThrow("days");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not silently coerce missing, negative or string amounts into zero", () => {
    expect(() =>
      normalizeLkAccountPart("balance", { balance: "0", unit: "算力" }),
    ).toThrow();
    expect(() =>
      normalizeLkAccountPart("balance", { balance: 1, unit: "USD" }),
    ).toThrow();
    const result = normalizeLkAccountPart("pricing", {
      channel_groups: [{ input_token_price: -1, output_token_price: "4" }],
    });
    expect(result.groups[0]).toMatchObject({
      inputPerMillion: null,
      outputPerMillion: null,
    });
  });
  it("does not imply model access from a group whitelist when the Key cannot use the model", () => {
    const result = normalizeLkAccountPart("pricing", {
      ...fixtures.pricing,
      available_for_this_key: false,
    });
    expect(result.available).toBe(false);
    expect(result.groups[0].allowed).toBe(false);
  });
  it("does not reuse cached account data after a Key change", async () => {
    const fetcher = vi.fn(fetchFixture);
    await queryLkAccount({}, { config, fetcher });
    await queryLkAccount(
      {},
      { config: { llm: { ...config.llm, apiKey: "second-key" } }, fetcher },
    );
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(fetcher.mock.calls[4][1].headers.Authorization).toBe(
      "Bearer second-key",
    );
  });
});
