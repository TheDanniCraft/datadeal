import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { creditPackBinding, signature } from "./billing";

const { database } = vi.hoisted(() => ({
  database: {
    hasPro: vi.fn(),
    recordSandboxCreditProduct: vi.fn(),
    wasSandboxCreditProductOffered: vi.fn(),
    settlePointPackPurchase: vi.fn(),
    refundPointPackPurchase: vi.fn(),
    settleCreemCreditPurchase: vi.fn(),
    reverseCreemCreditPurchase: vi.fn(),
    recordApiCreditPaymentRefund: vi.fn(),
    applyBillingEvent: vi.fn(),
  },
}));
vi.mock("./reports", () => ({ database }));
vi.mock("./local-reward", () => ({ localPointsEnabled: () => true }));
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

const origin = "http://localhost:3000";

beforeEach(() => {
  for (const [name, value] of Object.entries({
    APP_ORIGIN: origin,
    CREEM_MODE: "test",
    CREEM_API_KEY: "test-key",
    CREEM_WEBHOOK_SECRET: "test-secret",
    CREEM_MONTHLY_PRODUCT: "",
    CREEM_YEARLY_PRODUCT: "",
    CREEM_POINT_PACKS: "10000:500:prod_small,25000:1100:prod_pack",
  }))
    vi.stubEnv(name, value);
  database.settlePointPackPurchase.mockResolvedValue("applied");
  database.refundPointPackPurchase.mockResolvedValue("missing");
  database.reverseCreemCreditPurchase.mockResolvedValue("missing");
  database.recordApiCreditPaymentRefund.mockResolvedValue("missing");
  database.wasSandboxCreditProductOffered.mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

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

function completed(
  requestId: string,
  metadata: Record<string, unknown>,
  product = "prod_pack",
  price = 1100,
) {
  return {
    id: "evt_pack",
    eventType: "checkout.completed",
    created_at: 1_700_000_000_000,
    object: {
      object: "checkout",
      status: "completed",
      mode: "sandbox",
      request_id: requestId,
      customer: { id: "cust_test_owner", email: "api@example.com" },
      metadata,
      product: { id: product, billing_type: "onetime", currency: "EUR", price },
      order: {
        id: "ord_paid",
        product,
        status: "paid",
        currency: "EUR",
        amount: price,
        amount_due: price + 95,
        amount_paid: price + 95,
      },
    },
  };
}

it("grants a signed point pack checkout's points through the local ledger only", async () => {
  const provider = vi.fn(async (_url: string, _options: RequestInit) =>
    Response.json({ checkout_url: "https://test-checkout.creem.io/test" }),
  );
  vi.stubGlobal("fetch", provider);
  const checkout = await startCheckout(
    new Request(origin + "/checkout", {
      method: "POST",
      headers: { origin },
      body: JSON.stringify({ plan: "points", pack: "prod_pack" }),
    }),
  );
  expect(checkout.status).toBe(200);
  const sent = JSON.parse(String(provider.mock.calls[0][1].body));
  expect(sent).toMatchObject({
    product_id: "prod_pack",
    success_url: origin + "/account/developer/return/" + sent.request_id,
    metadata: { datadeal_pack_points: "25000", datadeal_price_cents: "1100" },
  });
  const event = completed(sent.request_id, sent.metadata);

  expect((await deliver(event, "wrong-secret")).status).toBe(401);
  expect(
    (await deliver({ ...event, object: { ...event.object, mode: "live" } }))
      .status,
  ).toBe(200);
  const order = event.object.order;
  expect(
    (
      await deliver({
        ...event,
        object: { ...event.object, order: { ...order, amount: 1 } },
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
  // A changed owner, amount or price no longer matches the signed binding.
  for (const metadata of [
    { ...sent.metadata, datadeal_user: "wrong-owner" },
    { ...sent.metadata, datadeal_pack_points: "50000" },
    { ...sent.metadata, datadeal_price_cents: "100" },
  ])
    expect(
      (await deliver({ ...event, object: { ...event.object, metadata } }))
        .status,
    ).toBe(200);
  expect(
    (
      await deliver({
        ...event,
        object: { ...event.object, order: { ...order, amount_paid: 0 } },
      })
    ).status,
  ).toBe(422);
  expect(database.settlePointPackPurchase).not.toHaveBeenCalled();

  expect((await deliver(event)).status).toBe(200);
  expect(database.settlePointPackPurchase).toHaveBeenCalledExactlyOnceWith({
    userId: "owner",
    email: "api@example.com",
    orderId: "ord_paid",
    requestId: sent.request_id,
    points: 25000,
    priceCents: 1100,
  });
  database.settlePointPackPurchase.mockResolvedValueOnce("conflict");
  expect((await deliver(event)).status).toBe(409);
  database.settlePointPackPurchase.mockResolvedValueOnce("replayed");
  expect((await deliver(event)).status).toBe(200);
  database.settlePointPackPurchase.mockRejectedValueOnce(Error("offline"));
  expect((await deliver(event)).status).toBe(503);
  expect(database.settleCreemCreditPurchase).not.toHaveBeenCalled();
  expect(database.applyBillingEvent).not.toHaveBeenCalled();
});

it("honours an earlier signed credit pack checkout in points", async () => {
  const requestId = "0a05c6a0-deca-4b2a-8d88-9fba1f76c756";
  const event = completed(
    requestId,
    {
      datadeal_user: "owner",
      datadeal_pack_credits: "25",
      datadeal_price_cents: "499",
      datadeal_binding: creditPackBinding(
        "test-secret",
        "owner",
        "prod_credit",
        requestId,
        25,
        499,
      ),
    },
    "prod_credit",
    499,
  );
  expect((await deliver(event)).status).toBe(200);
  expect(database.settlePointPackPurchase).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ points: 2500, priceCents: 499 }),
  );
  expect(database.settleCreemCreditPurchase).not.toHaveBeenCalled();
});

it("removes a refunded pack's points once and keeps earlier credit refunds as history", async () => {
  const transaction = {
    id: "tran_complete",
    object: "transaction",
    type: "payment",
    mode: "sandbox",
    currency: "EUR",
    status: "refunded",
    amount_paid: 1195,
    refunded_amount: 1195,
    order: "ord_complete",
  };
  const lookup = vi.fn();
  vi.stubGlobal("fetch", lookup);
  const refund = (changes: Record<string, unknown> = {}) =>
    deliver({
      id: "evt_refund",
      eventType: "refund.created",
      created_at: 1700000000000,
      object: {
        object: "refund",
        status: "succeeded",
        mode: "sandbox",
        refund_currency: "EUR",
        subscription: null,
        order: { id: transaction.order, product: "prod_pack" },
        transaction,
        ...changes,
      },
    });
  // A partial refund or another kind of transaction never removes points.
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
  ])
    expect((await refund(changes)).status).toBe(200);
  expect(database.refundPointPackPurchase).not.toHaveBeenCalled();

  database.refundPointPackPurchase.mockResolvedValueOnce("applied");
  expect((await refund()).status).toBe(200);
  database.refundPointPackPurchase.mockResolvedValueOnce("replayed");
  expect((await refund()).status).toBe(200);
  expect(database.refundPointPackPurchase).toHaveBeenCalledWith("ord_complete");
  expect(database.reverseCreemCreditPurchase).not.toHaveBeenCalled();

  // Before checkout.completed for an offered pack: retry later.
  expect((await refund()).status).toBe(503);
  expect(database.recordApiCreditPaymentRefund).toHaveBeenLastCalledWith(
    "creem:test:ord_complete",
  );
  // An order for an unrelated product is ignored.
  expect(
    (await refund({ order: { product: "different-product" } })).status,
  ).toBe(200);
  expect(database.wasSandboxCreditProductOffered).toHaveBeenCalledWith(
    "different-product",
  );
  // An earlier credit pack's refund is still recorded for its history.
  database.recordApiCreditPaymentRefund.mockResolvedValueOnce("applied");
  expect((await refund()).status).toBe(200);
  expect(lookup).not.toHaveBeenCalled();
});
