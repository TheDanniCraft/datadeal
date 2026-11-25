import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/v1/billing/checkout/route";
import { checkoutBinding, creditPackBinding } from "./billing";
import { creditServiceAccessible } from "./credit-service-access";
vi.mock("./credit-service-access", () => ({
  creditServiceAccessible: vi.fn(),
}));

const { getSession, billingSummary, recordSandboxCreditProduct } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    billingSummary: vi.fn(),
    recordSandboxCreditProduct: vi.fn(),
  }),
);
vi.mock("./auth", () => ({ auth: { api: { getSession } } }));
vi.mock("./reports", () => ({
  database: {
    billingSummary,
    recordSandboxCreditProduct,
    recordProCheckout: vi.fn(),
  },
}));
vi.mock("./developer-token", () => ({
  developerApiPreview: true,
  developerReportReadCost: 1,
  developerScanCost: null,
}));

const origin = "http://localhost:3000";
const user = {
  id: "account-1",
  email: "reader@example.test",
  emailVerified: true,
};
const secret = "sandbox-signing-secret";
const checkoutUrl = "https://checkout.creem.io/ch_sandbox";

function configure() {
  vi.mocked(creditServiceAccessible).mockResolvedValue(true);
  for (const [key, value] of Object.entries({
    APP_ORIGIN: origin,
    CREEM_MODE: "test",
    CREEM_API_KEY: "sandbox-test-key",
    CREEM_WEBHOOK_SECRET: secret,
    CREEM_MONTHLY_PRODUCT: "prod_month",
    CREEM_YEARLY_PRODUCT: "prod_year",
    CREEM_CREDIT_PACK_PRODUCT: "prod_pack",
    CREEM_CREDIT_PACK_CREDITS: "10",
    CREEM_CREDIT_PACK_PRICE_CENTS: "499",
  })) {
    vi.stubEnv(key, value);
  }
  getSession.mockResolvedValue({ user });
  billingSummary.mockResolvedValue(null);
  const provider = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        Response.json({ checkout_url: checkoutUrl, id: "ch_sandbox" }),
      ),
    );
  vi.stubGlobal("fetch", provider);
  return provider;
}

function request(plan: string, from = origin) {
  return new Request(origin + "/api/v1/billing/checkout", {
    method: "POST",
    headers: { Origin: from },
    body: JSON.stringify({ plan, product_id: "client-controlled" }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("withholds the pack checkout when the store cannot access Customer Credits", async () => {
  const provider = configure();
  vi.mocked(creditServiceAccessible).mockResolvedValue(false);
  expect((await POST(request("api-credits"))).status).toBe(503);
  expect(provider).not.toHaveBeenCalled();
});

it("requires a verified account email before opening a credit pack checkout", async () => {
  const provider = configure();
  getSession.mockResolvedValueOnce({ user: { ...user, emailVerified: false } });
  const response = await POST(request("api-credits"));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Verify your email before buying API credits.",
  });
  expect(creditServiceAccessible).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
  expect(recordSandboxCreditProduct).not.toHaveBeenCalled();
});

it.each([
  ["monthly", "prod_month", "/account/billing/return/"],
  ["yearly", "prod_year", "/account/billing/return/"],
  ["api-credits", "prod_pack", "/account/developer/return/"],
])(
  "creates an account-bound sandbox checkout for %s",
  async (plan, product, returnPath) => {
    const provider = configure();
    const response = await POST(request(plan));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ url: checkoutUrl });
    if (plan === "api-credits")
      expect(recordSandboxCreditProduct).toHaveBeenCalledExactlyOnceWith(
        product,
      );
    else expect(recordSandboxCreditProduct).not.toHaveBeenCalled();
    const [[url, options]] = provider.mock.calls;
    expect(url).toBe("https://test-api.creem.io/v1/checkouts");
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { "x-api-key": "sandbox-test-key" },
    });
    const payload = JSON.parse(options.body);
    expect(payload).toMatchObject({
      product_id: product,
      request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      success_url: origin + returnPath + payload.request_id,
      customer: { email: user.email },
      metadata: {
        datadeal_user: user.id,
        datadeal_binding:
          plan === "api-credits"
            ? creditPackBinding(
                secret,
                user.id,
                product,
                payload.request_id,
                10,
                499,
              )
            : checkoutBinding(secret, user.id, product),
      },
    });
  },
);

it("does not create checkout for untrusted origins, guests, or an existing Pro subscription", async () => {
  const provider = configure();
  expect(
    (await POST(request("monthly", "https://elsewhere.example"))).status,
  ).toBe(403);
  getSession.mockResolvedValueOnce(null);
  expect((await POST(request("monthly"))).status).toBe(401);
  billingSummary.mockResolvedValueOnce({ has_access: true });
  expect((await POST(request("monthly"))).status).toBe(409);
  expect(provider).not.toHaveBeenCalled();
});

it("keeps the sandbox credit checkout closed on a hosted origin", async () => {
  const provider = configure();
  const deployed = "https://datadeal.example";
  vi.stubEnv("APP_ORIGIN", deployed);
  expect((await POST(request("api-credits", deployed))).status).toBe(503);
  expect(provider).not.toHaveBeenCalled();
});

it("rejects a provider response that points outside Creem", async () => {
  const provider = configure();
  provider.mockResolvedValueOnce(
    Response.json({
      checkout_url: "https://checkout.creem.io.elsewhere.example/",
    }),
  );
  expect((await POST(request("yearly"))).status).toBe(502);
});

it("withholds the hosted pack URL if its product cannot be recorded for refunds", async () => {
  configure();
  recordSandboxCreditProduct.mockRejectedValueOnce(
    Error("database unavailable"),
  );
  const response = await POST(request("api-credits"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Checkout unavailable" });
});
