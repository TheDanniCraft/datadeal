import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, it } from "vitest";
import { proCheckoutStorage } from "./pro-checkouts";

it.skipIf(!process.env.DATADEAL_TEST_DATABASE_URL)(
  "shows the plan and access date for the selected receipt when one account has two subscriptions",
  async () => {
    const sql = postgres(process.env.DATADEAL_TEST_DATABASE_URL!);
    const db = proCheckoutStorage(sql),
      buyer = randomUUID(),
      other = randomUUID();
    const records: Array<{ reference: string; product: string; end: string }> =
      [];
    try {
      await sql`insert into "user"(id,name,email,"emailVerified") values(${buyer},'Buyer',${buyer + "@example.test"},true),(${other},'Other',${other + "@example.test"},true)`;
      for (const [product, end] of [
        ["monthly", "2099-05-01"],
        ["annual", "2099-12-01"],
      ] as const) {
        const requestId = randomUUID();
        const receipt = {
          userId: buyer,
          requestId,
          product,
          checkoutId: "ch_" + requestId,
          subscriptionId: "sub_" + requestId,
          customerId: "cust_" + buyer,
          orderId: "ord_" + requestId,
          mode: "test" as const,
        };
        const until = end + "T00:00:00.000Z";
        await db.recordProCheckout(receipt);
        await db.completeProCheckout(receipt);
        await sql`insert into subscriptions(id,user_id,customer_id,product_id,status,access_until,event_time)
        values(${receipt.subscriptionId},${buyer},${receipt.customerId},${product},'active',${until},1)`;
        for (const reference of [
          requestId,
          receipt.subscriptionId,
          receipt.orderId,
          receipt.checkoutId,
        ])
          records.push({ reference, product, end: until });
      }
      expect((await db.billingSummary(buyer))?.product_id).toBe("annual");
      const pending = randomUUID();
      await db.recordProCheckout({
        userId: buyer,
        product: "monthly",
        requestId: pending,
        checkoutId: "ch_" + pending,
        mode: "test",
      });
      const exported = await db.exportProBilling(buyer);
      expect(exported.subscriptions.map((row) => row.productId)).toEqual([
        "annual",
        "monthly",
      ]);
      expect(exported.checkouts).toHaveLength(3);
      expect(exported.checkouts).toContainEqual({
        productId: "monthly",
        mode: "test",
        requestId: pending,
        checkoutId: "ch_" + pending,
        orderId: null,
        subscriptionId: null,
      });
      expect(await db.exportProBilling(other)).toEqual({
        subscriptions: [],
        checkouts: [],
      });
      for (const { reference, product, end } of records) {
        expect(await db.billingSummary(buyer, reference)).toMatchObject({
          product_id: product,
          access_until: new Date(end),
        });
        expect(await db.billingSummary(other, reference)).toBeUndefined();
      }
      expect(await db.billingSummary(buyer, "ord_unknown")).toBeUndefined();
    } finally {
      try {
        await sql`delete from "user" where id in (${buyer},${other})`;
      } finally {
        await sql.end();
      }
    }
  },
);

it.skipIf(!process.env.DATADEAL_TEST_DATABASE_URL)(
  "looks up only the buyer's exact checkout and handles checkout and payment deliveries in either order",
  async () => {
    const sql = postgres(process.env.DATADEAL_TEST_DATABASE_URL!);
    const db = proCheckoutStorage(sql);
    const userId = randomUUID(),
      other = randomUUID();
    try {
      await sql`insert into "user"(id,name,email,"emailVerified") values(${userId},'Buyer',${userId + "@example.test"},true),(${other},'Other',${other + "@example.test"},true)`;
      for (const paidFirst of [false, true]) {
        const requestId = randomUUID();
        const receipt = {
          requestId,
          userId,
          product: "pro",
          mode: "test" as const,
          checkoutId: "ch_" + requestId,
          subscriptionId: "sub_" + requestId,
          customerId: "cust_" + userId,
          orderId: "ord_" + requestId,
        };
        const pay =
          () => sql`insert into subscriptions(id,user_id,customer_id,product_id,status,access_until,event_time)
        values(${receipt.subscriptionId},${userId},${receipt.customerId},${receipt.product},'active',now()+interval '1 day',1)`;
        await db.recordProCheckout(receipt);
        if (paidFirst) await pay();
        expect(await db.proCheckoutReceipt(userId, requestId)).toBe("pending");
        expect(await db.proCheckoutReceipt(userId, receipt.checkoutId)).toBe(
          "pending",
        );
        expect(await db.proCheckoutReceipt(userId, receipt.orderId)).toBeNull();
        for (const changed of [
          { userId: other },
          { product: "other" },
          { mode: "live" as const },
          { checkoutId: "ch_other" },
        ])
          expect(await db.completeProCheckout({ ...receipt, ...changed })).toBe(
            false,
          );
        expect(
          await db.completeProCheckout({ ...receipt, orderId: undefined }),
        ).toBe(true);
        expect(
          await Promise.all([
            db.completeProCheckout(receipt),
            db.completeProCheckout(receipt),
          ]),
        ).toEqual([true, true]);
        if (!paidFirst) {
          expect(await db.proCheckoutReceipt(userId, receipt.orderId)).toBe(
            "pending",
          );
          await pay();
        }
        expect(
          await db.completeProCheckout({
            ...receipt,
            orderId: "ord_different",
          }),
        ).toBe(false);
        expect(
          await db.completeProCheckout({
            ...receipt,
            subscriptionId: "sub_different",
          }),
        ).toBe(false);
        for (const ref of [requestId, receipt.checkoutId, receipt.orderId]) {
          expect(await db.proCheckoutReceipt(userId, ref)).toBe("confirmed");
          expect(await db.proCheckoutReceipt(other, ref)).toBeNull();
        }
        await sql`update subscriptions set status='expired' where id=${receipt.subscriptionId}`;
        expect(await db.proCheckoutReceipt(userId, requestId)).toBe("inactive");
        expect(await db.proCheckoutReceipt(userId, "ord_legacy")).toBeNull();
      }
    } finally {
      try {
        await sql`delete from "user" where id in (${userId},${other})`;
      } finally {
        await sql.end();
      }
    }
  },
);
