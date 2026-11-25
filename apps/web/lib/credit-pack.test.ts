import { afterEach, expect, it, vi } from "vitest";
import { signature } from "./billing";
vi.mock("./credit-service-access", () => ({
  creditServiceAccessible: async () => true,
}));

const { database } = vi.hoisted(() => ({
  database: {
    hasPro: vi.fn(),
    recordSandboxCreditProduct: vi.fn(),
    wasSandboxCreditProductOffered: vi.fn().mockResolvedValue(false),
    settleCreemCreditPurchase: vi.fn().mockResolvedValue("applied"),
    reverseCreemCreditPurchase: vi.fn().mockResolvedValue("missing"),
    recordApiCreditPaymentRefund: vi.fn(),
    applyBillingEvent: vi.fn(),
  },
}));
vi.mock("./reports", () => ({ database }));
vi.mock("./developer-token", () => ({
  developerApiPreview: true,
  developerReportReadCost: 1,
  developerScanCost: null,
}));
vi.mock("./auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: "owner", email: "api@example.com", emailVerified: true },
      }),
    },
  },
}));

import { POST as startCheckout } from "../app/api/v1/billing/checkout/route";
import { POST as settleWebhook } from "../app/api/v1/billing/creem/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("opens a sandbox pack checkout and credits only the matching signed paid order", async () => {
  for (const [name, value] of Object.entries({
    APP_ORIGIN: "http://localhost:3000",
    CREEM_MODE: "test",
    CREEM_API_KEY: "test-key",
    CREEM_WEBHOOK_SECRET: "test-secret",
    CREEM_MONTHLY_PRODUCT: "",
    CREEM_YEARLY_PRODUCT: "",
    CREEM_CREDIT_PACK_PRODUCT: "prod_pack",
    CREEM_CREDIT_PACK_CREDITS: "25",
    CREEM_CREDIT_PACK_PRICE_CENTS: "499",
  }))
    vi.stubEnv(name, value);
  const provider = vi.fn(async (_url: string, _options: RequestInit) =>
    Response.json({ checkout_url: "https://test-checkout.creem.io/test" }),
  );
  vi.stubGlobal("fetch", provider);
  const origin = "http://localhost:3000";
  const checkout = await startCheckout(
    new Request(origin + "/checkout", {
      method: "POST",
      headers: { origin },
      body: JSON.stringify({ plan: "api-credits" }),
    }),
  );
  expect(checkout.status).toBe(200);
  expect(provider.mock.calls[0][0]).toBe(
    "https://test-api.creem.io/v1/checkouts",
  );
  expect(database.hasPro).not.toHaveBeenCalled();
  const sent = JSON.parse(String(provider.mock.calls[0][1].body));
  expect(sent).toMatchObject({
    product_id: "prod_pack",
    success_url: origin + "/account/developer/return/" + sent.request_id,
    metadata: { datadeal_pack_credits: "25", datadeal_price_cents: "499" },
  });
  const event = {
    id: "evt_pack",
    eventType: "checkout.completed",
    created_at: 1_700_000_000_000,
    object: {
      object: "checkout",
      status: "completed",
      mode: "sandbox",
      request_id: sent.request_id,
      customer: { id: "cust_test_owner", email: "api@example.com" },
      metadata: sent.metadata,
      product: {
        id: "prod_pack",
        billing_type: "onetime",
        currency: "EUR",
        price: 499,
      },
      order: {
        id: "ord_paid",
        product: "prod_pack",
        status: "paid",
        currency: "EUR",
        amount: 499,
        amount_due: 594,
        amount_paid: 594,
      },
    },
  };
  const deliver = async (data: object, secret = "test-secret") => {
    const body = JSON.stringify(data);
    return settleWebhook(
      new Request(origin + "/creem", {
        method: "POST",
        body,
        headers: { "creem-signature": signature(secret, body) },
      }),
    );
  };
  expect((await deliver(event, "wrong-secret")).status).toBe(401);
  expect(
    (await deliver({ ...event, object: { ...event.object, mode: "live" } }))
      .status,
  ).toBe(200);
  expect(
    (
      await deliver({
        ...event,
        object: {
          ...event.object,
          order: { ...event.object.order, amount: 1 },
        },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await deliver({
        ...event,
        object: {
          ...event.object,
          customer: { ...event.object.customer, email: "" },
        },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await deliver({
        ...event,
        object: {
          ...event.object,
          metadata: { ...sent.metadata, datadeal_user: "wrong-owner" },
        },
      })
    ).status,
  ).toBe(200);
  expect(database.settleCreemCreditPurchase).not.toHaveBeenCalled();
  for (const amount_paid of [0, 1]) {
    await deliver({
      ...event,
      object: {
        ...event.object,
        order: { ...event.object.order, amount_paid },
      },
    });
  }
  expect(
    (
      await deliver({
        ...event,
        object: {
          ...event.object,
          order: {
            ...event.object.order,
            amount_due: undefined,
            amount_paid: 1,
          },
        },
      })
    ).status,
  ).toBe(422);
  expect(database.settleCreemCreditPurchase).not.toHaveBeenCalled();
  // Checkout is already open when the next pack is put on sale.
  vi.stubEnv("CREEM_CREDIT_PACK_PRODUCT", "prod_next_pack");
  vi.stubEnv("CREEM_CREDIT_PACK_CREDITS", "100");
  vi.stubEnv("CREEM_CREDIT_PACK_PRICE_CENTS", "999");
  for (const metadata of [
    { ...sent.metadata, datadeal_pack_credits: "100" },
    { ...sent.metadata, datadeal_price_cents: "100" },
    { ...sent.metadata, datadeal_price_cents: undefined },
  ]) {
    await deliver({ ...event, object: { ...event.object, metadata } });
  }
  expect(database.settleCreemCreditPurchase).not.toHaveBeenCalled();
  expect(
    (
      await deliver({
        ...event,
        object: {
          ...event.object,
          product: { ...event.object.product, price: 999 },
        },
      })
    ).status,
  ).toBe(200);
  expect(database.settleCreemCreditPurchase).toHaveBeenCalledExactlyOnceWith(
    expect.any(Object),
    {
      userId: "owner",
      customerId: "cust_test_owner",
      email: "api@example.com",
      orderId: "ord_paid",
      requestId: sent.request_id,
      credits: 25,
    },
  );
  expect(database.applyBillingEvent).not.toHaveBeenCalled();

  const refund = {
    id: "evt_refund",
    eventType: "refund.created",
    created_at: 1_700_000_000_001,
    object: {
      object: "refund",
      status: "succeeded",
      refund_currency: "EUR",
      transaction: { id: "tran_refund", status: "refunded" },
    },
  };
  provider.mockImplementation(async () =>
    Response.json({
      id: "tran_refund",
      object: "transaction",
      type: "payment",
      mode: "sandbox",
      currency: "EUR",
      status: "refunded",
      order: "ord_paid",
    }),
  );
  database.recordApiCreditPaymentRefund
    .mockResolvedValueOnce("missing")
    .mockResolvedValueOnce("applied");
  const sendRefund = (data: typeof refund) => {
    const body = JSON.stringify(data);
    return settleWebhook(
      new Request(origin + "/creem", {
        method: "POST",
        body,
        headers: { "creem-signature": signature("test-secret", body) },
      }),
    );
  };
  expect(
    (
      await sendRefund({
        ...refund,
        object: {
          ...refund.object,
          transaction: {
            ...refund.object.transaction,
            status: "partially_refunded",
          },
        },
      })
    ).status,
  ).toBe(200);
  expect(database.recordApiCreditPaymentRefund).not.toHaveBeenCalled();
  expect((await sendRefund(refund)).status).toBe(503);
  expect((await sendRefund(refund)).status).toBe(200);
  expect(database.recordApiCreditPaymentRefund).toHaveBeenLastCalledWith(
    "creem:test:ord_paid",
  );
  expect(database.applyBillingEvent).not.toHaveBeenCalled();
});

it("uses the signed expanded transaction for a full sandbox refund and ignores unrelated orders", async () => {
  vi.stubEnv("CREEM_MODE", "test");
  vi.stubEnv("CREEM_API_KEY", "test-key");
  vi.stubEnv("CREEM_WEBHOOK_SECRET", "test-secret");
  vi.stubEnv("CREEM_CREDIT_PACK_PRODUCT", "prod_pack");
  const lookup = vi.fn();
  vi.stubGlobal("fetch", lookup);
  const transaction = {
    id: "tran_complete",
    object: "transaction",
    type: "payment",
    mode: "sandbox",
    currency: "EUR",
    status: "refunded",
    amount_paid: 594,
    refunded_amount: 594,
    order: "ord_complete",
  };
  const deliver = (changes: Record<string, unknown> = {}) => {
    const body = JSON.stringify({
      id: "evt_refund_complete",
      eventType: "refund.created",
      created_at: 1700000000000,
      object: {
        object: "refund",
        status: "succeeded",
        mode: "sandbox",
        refund_currency: "EUR",
        refund_amount: 594,
        subscription: null,
        order: { id: transaction.order, product: "prod_pack" },
        transaction,
        ...changes,
      },
    });
    return settleWebhook(
      new Request("http://localhost/creem", {
        method: "POST",
        body,
        headers: { "creem-signature": signature("test-secret", body) },
      }),
    );
  };
  for (const changes of [
    { mode: "prod" },
    { transaction: { ...transaction, type: "invoice" } },
    {
      transaction: {
        ...transaction,
        status: "partialRefund",
        refunded_amount: 100,
      },
    },
  ]) {
    expect((await deliver(changes)).status).toBe(200);
  }
  expect(database.recordApiCreditPaymentRefund).not.toHaveBeenCalled();
  database.reverseCreemCreditPurchase.mockResolvedValueOnce("applied");
  expect((await deliver()).status).toBe(200);
  expect(database.reverseCreemCreditPurchase).toHaveBeenCalledExactlyOnceWith(
    expect.any(Object),
    "ord_complete",
  );
  database.recordApiCreditPaymentRefund.mockResolvedValue("missing");
  expect(
    (await deliver({ order: { product: "different-product" } })).status,
  ).toBe(200);
  expect(database.wasSandboxCreditProductOffered).toHaveBeenCalledWith(
    "different-product",
  );
  vi.stubEnv("CREEM_CREDIT_PACK_PRODUCT", "prod_new_pack");
  database.wasSandboxCreditProductOffered.mockResolvedValueOnce(true);
  expect((await deliver()).status).toBe(503);
  expect(database.wasSandboxCreditProductOffered).toHaveBeenLastCalledWith(
    "prod_pack",
  );
  database.reverseCreemCreditPurchase.mockResolvedValueOnce("applied");
  expect((await deliver()).status).toBe(200);
  vi.stubEnv("CREEM_CREDIT_PACK_PRODUCT", "prod_pack");
  expect((await deliver()).status).toBe(503);
  expect(lookup).not.toHaveBeenCalled();
});
