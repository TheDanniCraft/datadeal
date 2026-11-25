import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { creditPackBinding, signature } from "./billing";

vi.mock("./reports", async () => ({
  database: process.env.DATADEAL_TEST_DATABASE_URL
    ? (await import("@datadeal/database")).connect(
        process.env.DATADEAL_TEST_DATABASE_URL,
      )
    : null,
}));
import { database } from "./reports";
import { POST } from "../app/api/v1/billing/creem/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it.skipIf(!process.env.DATADEAL_TEST_DATABASE_URL)(
  "retries a denied signed checkout and records the native purchase and refund exactly once",
  async () => {
    const userId = randomUUID();
    const customerId = "cust_" + userId;
    const orderId = "ord_" + userId;
    const email = userId + "@example.test";
    const sql = new Pool({
      connectionString: process.env.DATADEAL_TEST_DATABASE_URL,
    });
    const product = "prod_pack",
      requestId = randomUUID(),
      secret = "signed-test-event";
    for (const [key, val] of Object.entries({
      CREEM_MODE: "test",
      CREEM_API_KEY: "test-key",
      CREEM_WEBHOOK_SECRET: secret,
      CREEM_CREDIT_PACK_PRODUCT: product,
      CREEM_CREDIT_PACK_PRICE_CENTS: "499",
      CREEM_CREDIT_PACK_CREDITS: "25",
    }))
      vi.stubEnv(key, val);
    const deliver = (eventType: string, object: object) => {
      const body = JSON.stringify({
        id: "evt_" + randomUUID(),
        created_at: Date.now(),
        eventType,
        object,
      });
      return POST(
        new Request("http://localhost/creem", {
          method: "POST",
          headers: { "creem-signature": signature(secret, body) },
          body,
        }),
      );
    };
    const checkout = {
      object: "checkout",
      mode: "sandbox",
      status: "completed",
      request_id: requestId,
      customer: { id: customerId, email },
      product: {
        id: product,
        billing_type: "onetime",
        price: 499,
        currency: "EUR",
      },
      order: {
        id: orderId,
        status: "paid",
        product,
        customer: customerId,
        currency: "EUR",
        amount: 499,
        amount_paid: 594,
        amount_due: 594,
      },
      metadata: {
        datadeal_user: userId,
        datadeal_binding: creditPackBinding(
          secret,
          userId,
          product,
          requestId,
          25,
          499,
        ),
      },
    };
    const refund = {
      object: "refund",
      mode: "sandbox",
      status: "succeeded",
      refund_currency: "EUR",
      subscription: null,
      order: { id: orderId, product },
      transaction: {
        id: "txn_checkout",
        object: "transaction",
        mode: "sandbox",
        type: "payment",
        status: "refunded",
        currency: "EUR",
        order: orderId,
        amount_paid: 594,
        refunded_amount: 594,
      },
    };
    const accountId = "cca_" + userId,
      transactionId = "cct_" + userId,
      reversalId = "cct_rev_" + userId;
    const entry = {
      id: "cce_" + userId,
      transaction_id: transactionId,
      account_id: accountId,
      side: "credit",
      amount: "25",
      created_at: "2026-01-01T12:00:00Z",
    };
    const credit = {
      id: transactionId,
      reference: "datadeal:pack:" + orderId,
      idempotency_key: "datadeal:pack:" + orderId,
      entries: [entry],
    };
    const calls: string[] = [];
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: { code: "forbidden" } }, { status: 403 }),
      )
      .mockImplementation(async (url, init) => {
        const path = new URL(String(url)).pathname;
        expect(new URL(String(url)).origin).toBe("https://test-api.creem.io");
        calls.push(path);
        if (path.endsWith("/accounts")) {
          const data = JSON.parse(String(init?.body));
          return Response.json({
            id: accountId,
            customer_id: customerId,
            name: data.name,
            unit_label: "credits",
          });
        }
        if (path.endsWith("/credit")) return Response.json(credit);
        if (path.endsWith("/transactions/" + transactionId))
          return Response.json(credit);
        if (path.endsWith("/entries"))
          return Response.json({ data: [entry], has_more: false });
        if (path.endsWith("/reverse"))
          return Response.json({
            id: reversalId,
            reversal_of: transactionId,
            entries: [
              {
                ...entry,
                id: "cce_rev_" + userId,
                transaction_id: reversalId,
                side: "debit",
              },
            ],
          });
        throw Error("Unexpected provider route");
      });
    vi.stubGlobal("fetch", transport);
    try {
      await sql.query(
        'insert into "user"(id,email,name,"emailVerified") values($1,$2,$3,true)',
        [userId, email, "Credit buyer"],
      );
      expect((await deliver("checkout.completed", checkout)).status).toBe(503);
      expect(await database!.creemCreditPurchases(userId)).toEqual([]);
      await expect(
        database!.creditCheckoutReceipt(userId, requestId),
      ).resolves.toBe("pending");
      for (let i = 0; i < 2; i++)
        expect((await deliver("checkout.completed", checkout)).status).toBe(
          200,
        );
      await expect(
        database!.creditCheckoutReceipt(userId, requestId),
      ).resolves.toBe("confirmed");
      for (let i = 0; i < 2; i++)
        expect((await deliver("refund.created", refund)).status).toBe(200);
      await expect(
        database!.creditCheckoutReceipt(userId, requestId),
      ).resolves.toBe("refunded");
      expect(await database!.creemCreditPurchases(userId)).toMatchObject([
        { orderId, credits: 25, transactionId, reversalId },
      ]);
      expect(calls.filter((p) => p.endsWith("/credit"))).toHaveLength(1);
      expect(calls.filter((p) => p.endsWith("/reverse"))).toHaveLength(1);
      expect(
        (
          await sql.query(
            "select id from api_credit_entries where user_id=$1",
            [userId],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await sql.query('delete from "user" where id=$1', [userId]);
      await Promise.all([database?.close(), sql.end()]);
    }
  },
);
