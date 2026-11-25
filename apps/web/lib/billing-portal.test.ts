import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/v1/billing/portal/route";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  billingCustomer: vi.fn(),
}));
vi.mock("./auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("./reports", () => ({
  database: { billingCustomer: mocks.billingCustomer },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("uses the current session's customer and returns only a private provider link", async () => {
  for (const [key, value] of Object.entries({
    APP_ORIGIN: "https://datadeal.app",
    CREEM_MODE: "test",
    CREEM_API_KEY: "test",
    CREEM_WEBHOOK_SECRET: "test",
    CREEM_MONTHLY_PRODUCT: "",
    CREEM_YEARLY_PRODUCT: "",
  }))
    vi.stubEnv(key, value);
  mocks.getSession.mockResolvedValue({ user: { id: "self" } });
  mocks.billingCustomer.mockResolvedValue("cust_self");
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      customer_portal_link: "https://creem.io/portal/cust_self?token=sample",
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const request = (origin: string) =>
    new Request("https://datadeal.app/api/v1/billing/portal", {
      method: "POST",
      headers: { origin },
      body: '{"customer_id":"cust_other"}',
    });
  expect((await POST(request("https://other.example"))).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
  const response = await POST(request("https://datadeal.app"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mocks.billingCustomer).toHaveBeenCalledWith("self");
  expect(fetch).toHaveBeenCalledWith(
    "https://test-api.creem.io/v1/customers/billing",
    expect.objectContaining({
      body: '{"customer_id":"cust_self"}',
      redirect: "error",
    }),
  );
  fetch.mockResolvedValue(
    Response.json({ customer_portal_link: "https://creem.io.other.example/" }),
  );
  expect((await POST(request("https://datadeal.app"))).status).toBe(502);
});
