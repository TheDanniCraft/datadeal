import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { signature } from "./billing";

vi.mock("./reports", async () => ({
  database: process.env.DATADEAL_TEST_DATABASE_URL
    ? (await import("@datadeal/database")).connect(
        process.env.DATADEAL_TEST_DATABASE_URL,
      )
    : null,
}));
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("./auth", () => ({ auth: { api: { getSession } } }));
import { database } from "./reports";
import { POST as checkout } from "../app/api/v1/billing/checkout/route";
import { POST as webhook } from "../app/api/v1/billing/creem/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await database?.close();
});

it.skipIf(!process.env.DATADEAL_TEST_DATABASE_URL).each([false, true])(
  "confirms only the checkout buyer after both signed webhook deliveries (paid first = %s)",
  async (paidFirst) => {
    const buyer = randomUUID(),
      stranger = randomUUID(),
      providerCheckout = "ch_" + buyer,
      subscriptionId = "sub_" + buyer,
      orderId = "ord_" + buyer,
      customerId = "cust_" + buyer;
    const origin = "http://localhost:3000",
      product = "prod_month",
      secret = "local-webhook-test";
    const pool = new Pool({
      connectionString: process.env.DATADEAL_TEST_DATABASE_URL,
    });
    const email = buyer + "@example.test";
    try {
      await pool.query(
        "insert into \"user\"(id,name,email,\"emailVerified\") values($1,'Buyer',$2,true),($3,'Other',$4,true)",
        [buyer, email, stranger, stranger + "@example.test"],
      );
      for (const [k, v] of Object.entries({
        APP_ORIGIN: origin,
        CREEM_API_KEY: "local-test",
        CREEM_WEBHOOK_SECRET: secret,
        CREEM_MODE: "test",
        CREEM_MONTHLY_PRODUCT: product,
        CREEM_YEARLY_PRODUCT: "prod_year",
      }))
        vi.stubEnv(k, v);
      getSession.mockResolvedValue({
        user: { id: buyer, email, emailVerified: true },
      });
      const provider = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          id: providerCheckout,
          checkout_url: "https://test-checkout.creem.io/" + providerCheckout,
        }),
      );
      vi.stubGlobal("fetch", provider);
      const created = await checkout(
        new Request(origin + "/api/v1/billing/checkout", {
          method: "POST",
          headers: { origin },
          body: JSON.stringify({ plan: "monthly" }),
        }),
      );
      expect(created.status).toBe(200);
      const payload = JSON.parse(String(provider.mock.calls[0]?.[1]?.body));
      expect(payload.success_url).toBe(
        origin + "/account/billing/return/" + payload.request_id,
      );
      const common = { metadata: payload.metadata, mode: "test" };
      const sub = {
        id: subscriptionId,
        product,
        customer: customerId,
        status: "active",
      };
      const build = (eventType: string, object: object) =>
        JSON.stringify({
          id: "evt_" + randomUUID(),
          eventType,
          created_at: Date.now(),
          object,
        });
      const completed = build("checkout.completed", {
        ...common,
        id: providerCheckout,
        object: "checkout",
        status: "completed",
        request_id: payload.request_id,
        product: { id: product, billing_type: "recurring" },
        customer: { id: customerId },
        subscription: sub,
        order: {
          id: orderId,
          status: "paid",
          type: "recurring",
          product,
          customer: customerId,
        },
      });
      const paid = build("subscription.paid", {
        ...sub,
        ...common,
        product: { id: product },
        customer: { id: customerId },
        current_period_end_date: new Date(Date.now() + 86400000).toISOString(),
      });
      const deliver = (body: string) =>
        webhook(
          new Request(origin + "/api/v1/billing/creem", {
            method: "POST",
            headers: { "creem-signature": signature(secret, body) },
            body,
          }),
        );
      const events = paidFirst ? [paid, completed] : [completed, paid];
      expect((await deliver(events[0]!)).status).toBe(200);
      expect(
        await database!.proCheckoutReceipt(buyer, payload.request_id),
      ).toBe("pending");
      expect((await deliver(events[1]!)).status).toBe(200);
      expect((await deliver(completed)).status).toBe(200);
      for (const reference of [payload.request_id, providerCheckout, orderId]) {
        expect(await database!.proCheckoutReceipt(buyer, reference)).toBe(
          "confirmed",
        );
        expect(
          await database!.proCheckoutReceipt(stranger, reference),
        ).toBeNull();
      }
    } finally {
      try {
        await pool.query('delete from "user" where id in ($1,$2)', [
          buyer,
          stranger,
        ]);
      } finally {
        await pool.end();
      }
    }
  },
);
