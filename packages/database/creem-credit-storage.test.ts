import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, it, vi } from "vitest";
import { creemCreditStorage } from "./creem-credit-storage";

it.skipIf(!process.env.DATADEAL_TEST_DATABASE_URL)(
  "remembers sandbox credit products once across concurrent offers",
  async () => {
    const sql = postgres(process.env.DATADEAL_TEST_DATABASE_URL!);
    const db = creemCreditStorage(sql);
    const product = "prod_" + randomUUID();
    try {
      expect(await db.wasSandboxCreditProductOffered(product)).toBe(false);
      await Promise.all([
        db.recordSandboxCreditProduct(product),
        db.recordSandboxCreditProduct(product),
      ]);
      expect(await db.wasSandboxCreditProductOffered(product)).toBe(true);
      expect(
        await sql`select product_id from creem_sandbox_credit_products where product_id=${product}`,
      ).toHaveLength(1);
    } finally {
      await sql`delete from creem_sandbox_credit_products where product_id=${product}`;
      await sql.end();
    }
  },
);

it.skipIf(!process.env.DATADEAL_TEST_DATABASE_URL)(
  "binds the verified buyer once and settles concurrent purchases and refunds on Creem",
  async () => {
    const sql = postgres(process.env.DATADEAL_TEST_DATABASE_URL!);
    const db = creemCreditStorage(sql);
    const id = randomUUID();
    const buyer = {
      userId: id,
      customerId: "cust_" + id,
      email: id + "@example.test",
      orderId: "ord_" + id,
      requestId: randomUUID(),
      credits: 25,
    };
    const other = randomUUID();
    const legacy = "legacy_" + id;
    const legacyRequest = randomUUID();
    const client = {
      ensureAccount: vi.fn().mockResolvedValue("cca_" + id),
      credit: vi.fn().mockResolvedValue({ id: "cct_" + id }),
      reverse: vi.fn().mockResolvedValue({ id: "cct_rev_" + id }),
      summary: vi.fn(),
      debit: vi.fn(),
    };
    try {
      await sql`insert into "user"(id,name,email,"emailVerified") values(${id},'Test',${buyer.email},true),(${other},'Other',${other + "@example.test"},true)`;
      await expect(
        db.settleCreemCreditPurchase(client, {
          ...buyer,
          email: other + "@example.test",
        }),
      ).resolves.toBe("conflict");
      expect(client.ensureAccount).not.toHaveBeenCalled();
      await sql`insert into api_credit_entries(user_id,kind,reference,delta) values(${id},'purchase',${"creem:test:" + legacy},25)`;
      await expect(
        db.settleCreemCreditPurchase(client, {
          ...buyer,
          orderId: legacy,
          requestId: legacyRequest,
        }),
      ).resolves.toBe("replayed");
      await expect(db.creditCheckoutReceipt(id, legacyRequest)).resolves.toBe(
        "confirmed",
      );
      await expect(db.creditCheckoutReceipt(id, buyer.requestId)).resolves.toBe(
        "pending",
      );
      await sql`insert into api_credit_entries(user_id,kind,reference,delta) values(${id},'payment_refund',${"creem:test:" + legacy},-25)`;
      await expect(db.creditCheckoutReceipt(id, legacyRequest)).resolves.toBe(
        "refunded",
      );
      expect(client.credit).not.toHaveBeenCalled();
      const purchases = await Promise.all([
        db.settleCreemCreditPurchase(client, buyer),
        db.settleCreemCreditPurchase(client, buyer),
      ]);
      expect(purchases.sort()).toEqual(["applied", "replayed"]);
      await expect(db.creditCheckoutReceipt(id, buyer.requestId)).resolves.toBe(
        "confirmed",
      );
      await expect(
        db.creditCheckoutReceipt(other, buyer.requestId),
      ).resolves.toBe("pending");
      await expect(
        db.settleCreemCreditPurchase(client, {
          ...buyer,
          orderId: "ord_conflict_" + id,
        }),
      ).resolves.toBe("conflict");
      await expect(
        db.settleCreemCreditPurchase(client, {
          ...buyer,
          requestId: randomUUID(),
        }),
      ).resolves.toBe("conflict");
      // A signed replay of a native receipt created before migration 0032 can attach its request.
      await sql`delete from creem_credit_checkout_requests where request_id=${buyer.requestId}`;
      await expect(db.creditCheckoutReceipt(id, buyer.requestId)).resolves.toBe(
        "pending",
      );
      await expect(db.settleCreemCreditPurchase(client, buyer)).resolves.toBe(
        "replayed",
      );
      await expect(
        db.checkoutReceipt(id, "credits", buyer.orderId),
      ).resolves.toBe("confirmed");
      await expect(
        db.checkoutReceipt(other, "credits", buyer.orderId),
      ).resolves.toBe("pending");
      expect(client.credit).toHaveBeenCalledTimes(1);
      expect(await db.creemCreditAccount(id)).toEqual({
        accountId: "cca_" + id,
        customerId: buyer.customerId,
      });
      await expect(
        db.settleCreemCreditPurchase(client, {
          ...buyer,
          userId: other,
          email: other + "@example.test",
          orderId: "other_" + id,
        }),
      ).resolves.toBe("conflict");
      expect(client.credit).toHaveBeenCalledTimes(1);
      const refunds = await Promise.all([
        db.reverseCreemCreditPurchase(client, buyer.orderId),
        db.reverseCreemCreditPurchase(client, buyer.orderId),
      ]);
      expect(refunds.sort()).toEqual(["applied", "replayed"]);
      await expect(db.creditCheckoutReceipt(id, buyer.requestId)).resolves.toBe(
        "refunded",
      );
      await expect(
        db.checkoutReceipt(id, "credits", buyer.orderId),
      ).resolves.toBe("refunded");
      expect(client.reverse).toHaveBeenCalledTimes(1);
      const refs = ["cct_" + id, "cct_rev_" + id];
      expect(await db.creemCreditActivity(id, refs)).toEqual(
        expect.arrayContaining([
          { transactionId: refs[0], kind: "pack", context: buyer.orderId },
          {
            transactionId: refs[1],
            kind: "pack_refund",
            context: buyer.orderId,
          },
        ]),
      );
      expect(await db.creemCreditActivity(other, refs)).toEqual([]);
      expect(await db.creemCreditPurchases(id)).toMatchObject([
        {
          orderId: buyer.orderId,
          credits: 25,
          reversalId: "cct_rev_" + id,
          transactionId: "cct_" + id,
        },
      ]);
      expect(
        await sql`select id from api_credit_entries where reference=${"creem:test:" + buyer.orderId}`,
      ).toHaveLength(0);
    } finally {
      await sql`delete from "user" where id in (${id},${other})`;
      await sql.end();
    }
  },
);
