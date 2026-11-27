import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/v1/billing/checkout/route";
import { checkoutBinding } from "./billing";
import { pointPackBinding } from "./point-packs";
import { pointsEnabled } from "./local-reward";
vi.mock("./local-reward", () => ({ pointsEnabled: vi.fn() }));

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

const origin = "http://localhost:3000";
const user = {
  id: "account-1",
  email: "reader@example.test",
  emailVerified: true,
};
const secret = "sandbox-signing-secret";
const checkoutUrl = "https://checkout.creem.io/ch_sandbox";

function configure() {
  vi.mocked(pointsEnabled).mockReturnValue(true);
  for (const [key, value] of Object.entries({
    APP_ORIGIN: origin,
    CREEM_MODE: "test",
    CREEM_API_KEY: "sandbox-test-key",
    CREEM_WEBHOOK_SECRET: secret,
    CREEM_MONTHLY_PRODUCT: "prod_month",
    CREEM_YEARLY_PRODUCT: "prod_year",
    CREEM_POINT_PACKS: "10000:500:prod_small,25000:1100:prod_pack",
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

function request(plan: string, from = origin, pack = "prod_pack") {
  return new Request(origin + "/api/v1/billing/checkout", {
    method: "POST",
    headers: { Origin: from },
    body: JSON.stringify({
      plan,
      product_id: "client-controlled",
      ...(plan === "points" && { pack }),
    }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("withholds point packs while points are off and rejects unknown packs", async () => {
  const provider = configure();
  vi.mocked(pointsEnabled).mockReturnValue(false);
  expect((await POST(request("points"))).status).toBe(503);
  vi.mocked(pointsEnabled).mockReturnValue(true);
  expect((await POST(request("points", origin, "prod_other"))).status).toBe(
    400,
  );
  // The earlier single credit pack plan no longer exists.
  expect((await POST(request("api-credits"))).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
});

it("never sells a point pack that shares a Pro product", async () => {
  const provider = configure();
  vi.stubEnv("CREEM_POINT_PACKS", "10000:500:prod_month");
  expect((await POST(request("points", origin, "prod_month"))).status).toBe(
    503,
  );
  expect(provider).not.toHaveBeenCalled();
});

it("requires a verified account email before opening a point pack checkout", async () => {
  const provider = configure();
  getSession.mockResolvedValueOnce({ user: { ...user, emailVerified: false } });
  const response = await POST(request("points"));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Verify your email before buying points.",
  });
  expect(provider).not.toHaveBeenCalled();
  expect(recordSandboxCreditProduct).not.toHaveBeenCalled();
});

it.each([
  ["monthly", "prod_month", "/account/billing/return/"],
  ["yearly", "prod_year", "/account/billing/return/"],
  ["points", "prod_pack", "/account/developer/return/"],
])(
  "creates an account-bound sandbox checkout for %s",
  async (plan, product, returnPath) => {
    const provider = configure();
    const response = await POST(request(plan));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ url: checkoutUrl });
    if (plan === "points")
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
          plan === "points"
            ? pointPackBinding(
                secret,
                user.id,
                product,
                payload.request_id,
                25000,
                1100,
              )
            : checkoutBinding(secret, user.id, product),
      },
    });
    if (plan === "points")
      expect(payload.metadata).toMatchObject({
        datadeal_pack_points: "25000",
        datadeal_price_cents: "1100",
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

it("opens a live point checkout on a hosted origin", async () => {
  const provider = configure();
  const deployed = "https://datadeal.example";
  vi.stubEnv("APP_ORIGIN", deployed);
  vi.stubEnv("CREEM_MODE", "live");
  provider.mockImplementationOnce(() =>
    Promise.resolve(
      Response.json({ checkout_url: "https://checkout.creem.io/ch_live" }),
    ),
  );
  expect((await POST(request("points", deployed))).status).toBe(200);
  const [[url, options]] = provider.mock.calls;
  expect(url).toBe("https://api.creem.io/v1/checkouts");
  expect(JSON.parse(options.body).success_url).toMatch(
    deployed + "/account/developer/return/",
  );
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
  const response = await POST(request("points"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Checkout unavailable" });
});
