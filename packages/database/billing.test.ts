import { expect, it, vi } from "vitest";
import postgres from "postgres";
import { connect } from "./index";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
it.skipIf(!url)(
  "serializes confirmed closure with paid deliveries and retries an incomplete cancellation",
  async () => {
    const db = connect(url!),
      sql = postgres(url!);
    const userId = "billing-closure";
    const paid = {
      id: "closure-paid",
      userId,
      subscription: "sub_closure",
      customer: "cust_closure",
      product: "monthly",
      status: "active",
      time: 100,
      accessUntil: "2099-01-01T00:00:00Z",
    };
    try {
      await sql`insert into "user"(id,name,email) values (${userId},'Closure','closure@example.test')`;
      await db.applyBillingEvent(paid);
      await expect(
        db.prepareBillingClosure(userId, async () => {
          throw new Error("provider offline");
        }),
      ).rejects.toThrow();
      expect(await db.hasPro(userId)).toBe(true);
      let started!: () => void, finish!: () => void;
      const running = new Promise<void>((r) => {
        started = r;
      });
      const release = new Promise<void>((r) => {
        finish = r;
      });
      const cancel = vi.fn(async () => {
        started();
        await release;
      });
      const closing = db.prepareBillingClosure(userId, cancel);
      await running;
      const late = {
        ...paid,
        id: "closure-late",
        subscription: "sub_other",
        time: 101,
      };
      const delivery = db.applyBillingEvent(late);
      finish();
      await closing;
      expect(cancel).toHaveBeenCalledExactlyOnceWith(
        "sub_closure",
        "cust_closure",
      );
      expect(await delivery).toBe("cancel_subscription");
      await sql`delete from "user" where id=${userId}`;
      expect(await db.applyBillingEvent(late)).toBe("cancel_subscription");
      expect(
        await sql`select id from subscriptions where user_id=${userId}`,
      ).toHaveLength(0);
    } finally {
      await sql.end();
      await db.close();
    }
  },
);
it.skipIf(!url)(
  "grants paid access, ignores stale and duplicate events, and expires access",
  async () => {
    const db = connect(url!);
    const sql = postgres(url!);
    try {
      await sql`insert into "user"(id, name, email) values ('billing', 'Billing Test', 'billing@example.test')`;
      const paid = {
        id: "event-paid",
        time: 100,
        subscription: "sub-test",
        customer: "customer-test",
        product: "prod-test",
        userId: "billing",
        status: "active",
        accessUntil: "2099-01-01T00:00:00Z",
      };
      await db.applyBillingEvent(paid);
      expect(await db.billingCustomer("billing")).toBe("customer-test");
      expect(await db.billingCustomer("other-user")).toBeNull();
      expect(await db.hasPro("billing")).toBe(true);
      await db.applyBillingEvent({
        ...paid,
        id: "other-customer-paid",
        subscription: "other-subscription",
        customer: "other-customer",
        accessUntil: "2100-01-01T00:00:00Z",
      });
      await db.applyBillingEvent({
        ...paid,
        id: "other-customer-paused",
        time: 101,
        subscription: "other-subscription",
        customer: "other-customer",
        status: "paused",
        accessUntil: undefined,
      });
      expect(await db.billingCustomer("billing")).toBe("customer-test");
      await db.applyBillingEvent({ ...paid, status: "expired" });
      await db.applyBillingEvent({
        ...paid,
        id: "event-stale",
        time: 99,
        status: "expired",
      });
      expect(await db.hasPro("billing")).toBe(true);
      await db.applyBillingEvent({
        ...paid,
        id: "event-past-due",
        time: 101,
        status: "past_due",
        accessUntil: "2101-01-01T00:00:00Z",
      });
      expect(
        (await db.billingSummary("billing"))?.access_until.toISOString(),
      ).toBe("2099-01-01T00:00:00.000Z");
      await db.applyBillingEvent({
        ...paid,
        id: "event-canceled",
        time: 102,
        status: "canceled",
        accessUntil: undefined,
      });
      expect(await db.hasPro("billing")).toBe(true);
      await db.applyBillingEvent({
        ...paid,
        id: "event-expired",
        time: 103,
        status: "expired",
      });
      expect(await db.hasPro("billing")).toBe(false);
      expect(await db.billingSummary("billing")).toMatchObject({
        customer_id: "other-customer",
        status: "paused",
        has_access: false,
        needs_management: true,
      });
      const renewal = {
        ...paid,
        id: "renew-rotated",
        time: 105,
        existingProductOnly: true,
        userId: undefined,
      };
      await db.applyBillingEvent({
        ...renewal,
        id: "wrong-product",
        product: "unrelated",
      });
      await db.applyBillingEvent({
        ...renewal,
        id: "wrong-customer",
        customer: "other",
      });
      expect(await db.hasPro("billing")).toBe(false);
      await db.applyBillingEvent(renewal);
      expect(await db.hasPro("billing")).toBe(true);
    } finally {
      await sql.end();
      await db.close();
    }
  },
);
