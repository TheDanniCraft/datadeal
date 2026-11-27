import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { connect } from "./index";
import { pointPackReference } from "./points";
import { applyReportPoints } from "./report-points";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function verify(
  run: (fixture: {
    db: ReturnType<typeof connect>;
    sql: ReturnType<typeof postgres>;
    user: string;
    email: string;
    host: string;
    balance: () => Promise<number>;
    award: (points: number) => Promise<unknown>;
  }) => Promise<void>,
) {
  const db = connect(url!),
    sql = postgres(url!);
  const user = randomUUID(),
    email = user + "@example.test",
    host = `points-${randomUUID()}.example.com`;
  const daily =
    "daily:account:" + createHash("sha256").update(user).digest("hex");
  try {
    await sql`insert into "user"(id,name,email,"emailVerified") values(${user},'Points test',${email},true)`;
    await sql`insert into domains(name) values(${host})`;
    const balance = async () =>
      Number(
        (
          await sql`select balance from report_point_accounts where user_id=${user}`
        )[0]?.balance ?? 0,
      );
    const award = (points: number) =>
      sql.begin((tx) =>
        applyReportPoints(tx, {
          userId: user,
          delta: points,
          operation: "test_award",
          referenceId: randomUUID(),
        }),
      );
    await run({ db, sql, user, email, host, balance, award });
  } finally {
    await sql`delete from point_pack_purchases where user_id=${user} or order_id like ${"ord_" + user + "%"}`;
    await sql`delete from "user" where id=${user}`;
    await sql`delete from scans where domain=${host}`;
    await sql`delete from domains where name=${host}`;
    await sql`delete from scan_request_limits where bucket=${daily}`;
    await Promise.all([sql.end(), db.close()]);
  }
}

describe.skipIf(!url)("Points currency", () => {
  it("grants a pack once per order, rejects conflicts and refunds once without going below zero", () =>
    verify(async ({ db, sql, user, email, balance, award }) => {
      const orderId = "ord_" + user;
      const requestId = randomUUID();
      const purchase = {
        userId: user,
        email,
        orderId,
        requestId,
        points: 25000,
        priceCents: 1100,
      };
      const results = await Promise.all(
        Array.from({ length: 4 }, () => db.settlePointPackPurchase(purchase)),
      );
      expect(results.filter((r) => r === "applied")).toHaveLength(1);
      expect(results.filter((r) => r === "replayed")).toHaveLength(3);
      expect(await balance()).toBe(25000);
      for (const conflicting of [
        { ...purchase, points: 50000 },
        { ...purchase, userId: randomUUID() },
        { ...purchase, requestId: randomUUID() },
        { ...purchase, orderId: orderId + "_other" },
      ])
        expect(await db.settlePointPackPurchase(conflicting)).toBe("conflict");
      expect(
        await db.settlePointPackPurchase({
          ...purchase,
          orderId: orderId + "_email",
          requestId: randomUUID(),
          email: "someone@example.test",
        }),
      ).toBe("conflict");
      await sql`update "user" set "emailVerified"=false where id=${user}`;
      expect(
        await db.settlePointPackPurchase({
          ...purchase,
          orderId: orderId + "_unverified",
          requestId: randomUUID(),
        }),
      ).toBe("conflict");
      await sql`update "user" set "emailVerified"=true where id=${user}`;
      expect(await balance()).toBe(25000);
      expect(await db.pointPackReceipt(user, requestId)).toEqual({
        status: "confirmed",
        points: 25000,
      });

      // 20,000 points were already spent: the refund takes the other 5,000.
      await award(-20000);
      expect(await db.refundPointPackPurchase(orderId)).toBe("applied");
      expect(await db.refundPointPackPurchase(orderId)).toBe("replayed");
      expect(await db.refundPointPackPurchase("ord_missing_" + user)).toBe(
        "missing",
      );
      expect(await balance()).toBe(0);
      expect(await db.pointPackPurchases(user)).toMatchObject([
        { orderId, points: 25000, priceCents: 1100, refundedPoints: 5000 },
      ]);
      expect(await db.pointPackReceipt(user, { orderId })).toEqual({
        status: "refunded",
        points: 25000,
      });
      const ledger = await sql<{ operation: string; delta: number }[]>`
        select operation, delta from report_point_ledger
        where user_id=${user} and reference_id=${pointPackReference(orderId)} order by delta desc`;
      expect(ledger).toEqual([
        { operation: "point_pack", delta: 25000 },
        { operation: "point_pack_refund", delta: -5000 },
      ]);
      // A replayed checkout after the refund never grants again.
      expect(await db.settlePointPackPurchase(purchase)).toBe("replayed");
      expect(await balance()).toBe(0);
    }));

  it("charges API reads before serving, replays by key and hash, and refuses a short balance", () =>
    verify(async ({ db, sql, user, host, balance, award }) => {
      await award(300);
      const charge = {
        key: "read-1",
        requestHash: hash("report:read\0" + host),
        points: 150,
      };
      const report = { domain: host, report: { demo: false } };
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          db.chargeApiPoints(user, charge, host, "report_read", report),
        ),
      );
      expect(results.filter((r) => r.code === "applied")).toHaveLength(1);
      expect(results.filter((r) => r.code === "replayed")).toHaveLength(3);
      expect(
        results.every(
          (r) =>
            "response" in r &&
            (r.response as { domain?: string }).domain === host,
        ),
      ).toBe(true);
      expect(await balance()).toBe(150);
      expect(
        await db.pointApiReplay(user, "read-1", charge.requestHash),
      ).toMatchObject({ code: "replayed" });
      expect(
        await db.chargeApiPoints(
          user,
          { ...charge, requestHash: hash("other") },
          host,
          "report_read",
          report,
        ),
      ).toEqual({ code: "conflict" });
      expect(
        await db.chargeApiPoints(
          user,
          { ...charge, key: "read-2" },
          host,
          "report_read",
          report,
        ),
      ).toMatchObject({ code: "applied" });
      expect(
        await db.chargeApiPoints(
          user,
          { ...charge, key: "read-3" },
          host,
          "report_read",
          report,
        ),
      ).toEqual({ code: "insufficient" });
      expect(await balance()).toBe(0);
      expect(
        await sql`select 1 from point_api_operations where user_id=${user}`,
      ).toHaveLength(2);
      expect(await db.pointApiOperations(user)).toHaveLength(2);
    }));

  it("charges an API scan, rolls back a rejected or unaffordable one, and refunds a failed scan once", () =>
    verify(async ({ db, sql, user, host, balance, award }) => {
      const charge = {
        key: "scan-1",
        requestHash: hash("scan:request\0" + host),
        points: 150,
      };
      expect(await db.chargeApiPoints(user, charge, host, "scan")).toEqual({
        code: "insufficient",
      });
      expect(await sql`select 1 from scans where domain=${host}`).toHaveLength(
        0,
      );
      await award(150);
      const accepted = await db.chargeApiPoints(user, charge, host, "scan");
      if (accepted.code !== "applied") throw Error("Expected an API scan");
      const id = (accepted.response as { id: string }).id;
      expect(await balance()).toBe(0);
      await award(150);
      // The same domain is already queued: nothing is charged.
      expect(
        await db.chargeApiPoints(
          user,
          { ...charge, key: "scan-2" },
          host,
          "scan",
        ),
      ).toMatchObject({ code: "scan_in_progress" });
      expect(await balance()).toBe(150);
      expect(await db.apiScanStatus(user, id)).toMatchObject({
        pointsCharged: 150,
        pointsRefunded: 0,
      });
      const owner = randomUUID();
      await sql`update scan_jobs set owner=${owner},lease_until=now()+interval '5 minutes' where scan_id=${id}`;
      expect(await db.finish(id, owner, null)).toBe(true);
      expect(await db.finish(id, owner, null)).toBe(false);
      expect(await balance()).toBe(300);
      expect(await db.apiScanStatus(user, id)).toMatchObject({
        pointsCharged: 150,
        pointsRefunded: 150,
      });
      expect(
        await sql`select 1 from report_point_ledger where operation='api_scan_refund' and user_id=${user}`,
      ).toHaveLength(1);
      expect(
        await db.chargeApiPoints(user, charge, host, "scan"),
      ).toMatchObject({ code: "replayed", response: { id } });
      expect(await balance()).toBe(300);
    }));
});
