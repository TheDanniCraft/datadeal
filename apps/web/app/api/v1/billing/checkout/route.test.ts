import { afterEach, expect, it, vi } from "vitest";
import { checkoutBinding } from "../../../../../lib/billing";
import { POST } from "./route";

vi.mock("../../../../../lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: "reader", email: "reader@example.test" },
      }),
    },
  },
}));
const { billingSummary, recordProCheckout } = vi.hoisted(() => ({
  billingSummary: vi.fn(),
  recordProCheckout: vi.fn(),
}));
vi.mock("../../../../../lib/reports", () => ({
  database: { billingSummary, recordProCheckout },
}));

afterEach(() => {
  billingSummary.mockReset();
  recordProCheckout.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const origin = "https://datadeal.example";
const checkout = (plan: "monthly" | "yearly" = "monthly") =>
  POST(
    new Request(`${origin}/api/v1/billing/checkout`, {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({ plan }),
    }),
  );

function mockProvider(checkoutUrl: string) {
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("CREEM_MODE", "test");
  vi.stubEnv("CREEM_API_KEY", "test-key");
  vi.stubEnv("CREEM_WEBHOOK_SECRET", "test-secret");
  vi.stubEnv("CREEM_MONTHLY_PRODUCT", "prod_monthly");
  vi.stubEnv("CREEM_YEARLY_PRODUCT", "prod_yearly");
  const provider = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ checkout_url: checkoutUrl, id: "ch_example" }),
    );
  vi.stubGlobal("fetch", provider);
  return provider;
}

it.each(["monthly", "yearly"] as const)(
  "creates a %s test checkout with Creem's documented request fields",
  async (plan) => {
    const url = `https://creem.io/test/checkout/prod_${plan}/ch_example`;
    const provider = mockProvider(url);
    const response = await checkout(plan);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ url });
    const [endpoint, options] = provider.mock.calls[0];
    expect(endpoint).toBe("https://test-api.creem.io/v1/checkouts");
    expect(options?.redirect).toBe("error");
    expect(options?.headers).toMatchObject({ "x-api-key": "test-key" });
    const payload = JSON.parse(String(options?.body));
    expect(payload).toMatchObject({
      product_id: "prod_" + plan,
      request_id: expect.any(String),
      success_url: `${origin}/account/billing/return/${payload.request_id}`,
      customer: { email: "reader@example.test" },
      metadata: {
        datadeal_user: "reader",
        datadeal_pro_request: payload.request_id,
        datadeal_binding: checkoutBinding(
          "test-secret",
          "reader",
          "prod_" + plan,
        ),
      },
    });
    expect(recordProCheckout).toHaveBeenCalledExactlyOnceWith({
      requestId: payload.request_id,
      checkoutId: "ch_example",
      userId: "reader",
      product: "prod_" + plan,
      mode: "test",
    });
  },
);

it("does not send the customer to a checkout without a saved ownership record", async () => {
  mockProvider("https://test-checkout.creem.io/ch_example");
  recordProCheckout.mockRejectedValueOnce(new Error("database unavailable"));
  expect((await checkout()).status).toBe(503);
});

it.each([
  { has_access: true, needs_management: false },
  { has_access: false, needs_management: true },
])(
  "returns to the existing subscription without opening another checkout",
  async (summary) => {
    const provider = mockProvider("https://checkout.creem.io");
    billingSummary.mockResolvedValue(summary);
    expect((await checkout()).status).toBe(409);
    expect(provider).not.toHaveBeenCalled();
  },
);

it.each([
  "https://checkout.creem.io.example.test/ch_example",
  "https://checkout.creem.io:444/ch_example",
  "https://creem.io/dashboard",
  "https://creem.io/test/checkout/prod_yearly/ch_example",
  "https://creem.io/checkout/prod_monthly/ch_example",
])("rejects unsupported checkout redirects (%s)", async (url) => {
  mockProvider(url);
  expect((await checkout()).status).toBe(502);
});

it.each([
  "https://creem.io/test/checkout/prod_monthly/ch_example",
  "https://test-checkout.creem.io/ch_example",
])("rejects sandbox-only destination %s in live mode", async (url) => {
  mockProvider(url);
  vi.stubEnv("CREEM_MODE", "live");
  expect((await checkout()).status).toBe(502);
});
