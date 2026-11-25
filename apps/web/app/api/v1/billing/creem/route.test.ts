import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkoutBinding, signature } from "../../../../../lib/billing";
import { POST } from "./route";

const { applyBillingEvent, completeProCheckout } = vi.hoisted(() => ({
  applyBillingEvent: vi.fn(),
  completeProCheckout: vi.fn(),
}));
vi.mock("../../../../../lib/reports", () => ({
  database: { applyBillingEvent, completeProCheckout },
}));

const secret = "local-webhook-test";
const endpoint = "http://localhost/api/v1/billing/creem";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CREEM_API_KEY", "placeholder-test-key");
  vi.stubEnv("CREEM_WEBHOOK_SECRET", secret);
  vi.stubEnv("CREEM_MONTHLY_PRODUCT", "monthly");
  vi.stubEnv("CREEM_YEARLY_PRODUCT", "yearly");
  vi.stubEnv("CREEM_MODE", "test");
});
afterEach(() => vi.unstubAllEnvs());

it("links a signed completed Pro checkout once to the issued request without granting access itself", async () => {
  const requestId = "c14a2e16-f39a-49bc-be19-d10b600d44e5";
  const object = {
    object: "checkout",
    id: "ch_new",
    request_id: requestId,
    status: "completed",
    mode: "sandbox",
    metadata: {
      datadeal_user: "buyer",
      datadeal_binding: checkoutBinding(secret, "buyer", "monthly"),
      datadeal_pro_request: requestId,
    },
    product: { id: "monthly" },
    customer: { id: "cust_new" },
    subscription: { id: "sub_new", customer: "cust_new", product: "monthly" },
    order: { id: "ord_new", customer: "cust_new", product: "monthly" },
  };
  const submit = (value: unknown) => {
    const body = JSON.stringify({
      id: "evt_new",
      created_at: 1,
      eventType: "checkout.completed",
      object: value,
    });
    return POST(
      new Request(endpoint, {
        method: "POST",
        headers: { "creem-signature": signature(secret, body) },
        body,
      }),
    );
  };
  completeProCheckout.mockResolvedValue(true);
  expect((await submit(object)).status).toBe(200);
  expect(completeProCheckout).toHaveBeenCalledExactlyOnceWith({
    requestId,
    checkoutId: "ch_new",
    userId: "buyer",
    mode: "test",
    product: "monthly",
    customerId: "cust_new",
    subscriptionId: "sub_new",
    orderId: "ord_new",
  });
  expect((await submit({ ...object, order: null })).status).toBe(200);
  completeProCheckout.mockResolvedValue(false);
  expect((await submit(object)).status).toBe(409);
  const attempts = completeProCheckout.mock.calls.length;
  for (const changed of [
    { mode: "prod" },
    { order: { ...object.order, product: "other" } },
    { request_id: "90a364c6-8fdb-4452-9371-019386780a07" },
    { metadata: { ...object.metadata, datadeal_user: "other" } },
  ])
    expect((await submit({ ...object, ...changed })).status).toBe(422);
  expect(
    (await submit({ ...object, metadata: { datadeal_user: "buyer" } })).status,
  ).toBe(200);
  expect(completeProCheckout).toHaveBeenCalledTimes(attempts);
  expect(applyBillingEvent).not.toHaveBeenCalled();
});

it("passes a signed, account-bound test event to entitlement processing", async () => {
  const body = JSON.stringify({
    id: "test-event",
    eventType: "subscription.paid",
    created_at: 1,
    object: {
      id: "test-subscription",
      product: "monthly",
      customer: "test-customer",
      mode: "test",
      current_period_end_date: "2099-01-01T00:00:00Z",
      metadata: {
        datadeal_user: "test-user",
        datadeal_binding: checkoutBinding(secret, "test-user", "monthly"),
      },
    },
  });
  const submit = (digest: string) =>
    POST(
      new Request(endpoint, {
        method: "POST",
        headers: { "creem-signature": digest },
        body,
      }),
    );
  expect((await submit(signature(secret, body + " "))).status).toBe(401);
  expect(applyBillingEvent).not.toHaveBeenCalled();
  expect((await submit(signature(secret, body))).status).toBe(200);
  expect(applyBillingEvent).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      userId: "test-user",
      status: "active",
      accessUntil: "2099-01-01T00:00:00Z",
    }),
  );
});

it.each([true, false])(
  "processes subscriptions after both checkout products rotate (bound = %s)",
  async (bound) => {
    vi.stubEnv("CREEM_MONTHLY_PRODUCT", "");
    vi.stubEnv("CREEM_YEARLY_PRODUCT", "");
    const body = JSON.stringify({
      id: "event-rotation",
      eventType: "subscription.paid",
      created_at: 100,
      object: {
        id: "sub_prior",
        customer: { id: "cust_prior" },
        product: { id: "old" },
        mode: "sandbox",
        current_period_end_date: "2099-01-01T00:00:00Z",
        metadata: bound
          ? {
              datadeal_user: "buyer",
              datadeal_binding: checkoutBinding(secret, "buyer", "old"),
            }
          : {},
      },
    });
    const response = await POST(
      new Request(endpoint, {
        method: "POST",
        body,
        headers: { "creem-signature": signature(secret, body) },
      }),
    );
    expect(response.status).toBe(200);
    expect(applyBillingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        product: "old",
        customer: "cust_prior",
        existingProductOnly: !bound,
        userId: bound ? "buyer" : undefined,
      }),
    );
  },
);

it("cancels an oversized stream without trusting Content-Length", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(64_001));
      controller.enqueue(new Uint8Array(64_001));
    },
    cancel,
  });
  const response = await POST(
    new Request(endpoint, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }),
  );
  expect(response.status).toBe(413);
  expect(cancel).toHaveBeenCalledOnce();
  expect(applyBillingEvent).not.toHaveBeenCalled();
});
