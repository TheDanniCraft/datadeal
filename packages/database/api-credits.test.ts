import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, it } from "vitest";
import { connect } from "./index";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
const digest = (request: string) =>
  createHash("sha256").update(request).digest("hex");

it.skipIf(!url)(
  "charges only new queued scans and replays the original scan ID",
  async () => {
    const db = connect(url!);
    const sql = postgres(url!);
    const owner = randomUUID();
    const host = owner + ".example.com";
    const another = "another." + host;
    try {
      await sql`insert into "user"(id, name, email)
      values (${owner}, 'Scan owner', ${owner + "@example.test"})`;
      const charge = {
        key: "scan",
        requestHash: digest("scan:" + host),
        amount: 2,
      };
      expect(await db.requestApiScan(host, owner, charge)).toEqual({
        code: "insufficient",
      });
      expect(await db.list(host)).toEqual([]);
      expect(await db.recordApiCreditPurchase(owner, "test:" + owner, 4)).toBe(
        "applied",
      );
      const requests = await Promise.all([
        db.requestApiScan(host, owner, charge),
        db.requestApiScan(host, owner, charge),
      ]);
      expect(requests.map(({ code }) => code).sort()).toEqual([
        "applied",
        "replayed",
      ]);
      const [scan] = await db.list(host);
      expect(await db.apiScanStatus(owner, scan.id)).toMatchObject({
        id: scan.id,
        domain: host,
        state: "queued",
        creditsCharged: 2,
        creditsRefunded: 0,
        reportPublished: false,
      });
      expect(await db.apiScanStatus(randomUUID(), scan.id)).toBeNull();
      for (const result of requests)
        expect(result).toMatchObject({ response: { id: scan.id } });
      expect(
        await db.requestApiScan(another, owner, {
          ...charge,
          requestHash: digest("scan:" + another),
        }),
      ).toEqual({ code: "conflict" });
      expect(
        await db.requestApiScan(host, owner, { ...charge, key: "other" }),
      ).toEqual({
        code: "rejected",
        result: { code: "scan_in_progress", id: scan.id },
      });
      const [job] =
        await sql`select scan_id from scan_jobs where scan_id = ${scan.id}`;
      expect(job?.scan_id).toBe(scan.id);
      expect((await db.apiCreditSummary(owner)).balance).toBe("2");
      const claimed = await db.claim();
      expect(claimed?.id).toBe(scan.id);
      expect(await db.retryScan(scan.id, claimed!.owner)).toBe(true);
      expect((await db.apiCreditSummary(owner)).balance).toBe("2");
      await sql`update scan_jobs set lease_until = null where scan_id = ${scan.id}`;
      const retried = (await db.claim())!;
      expect(await db.finish(scan.id, claimed!.owner, null)).toBe(false);
      expect(await db.finish(scan.id, retried.owner, null)).toBe(true);
      expect(await db.finish(scan.id, retried.owner, null)).toBe(false);
      expect(await db.apiScanStatus(owner, scan.id)).toMatchObject({
        state: "failed",
        creditsCharged: 2,
        creditsRefunded: 2,
      });
      expect(await db.requestApiScan(host, owner, charge)).toEqual({
        code: "replayed",
        response: { id: scan.id },
      });
      const next = await db.requestApiScan(another, owner, {
        ...charge,
        key: "expired",
        requestHash: digest("scan:" + another),
      });
      expect(next.code).toBe("applied");
      const [expired] = await db.list(another);
      await sql`update scan_jobs set attempts = 3, lease_until = now() - interval '1 second'
      where scan_id = ${expired.id}`;
      expect(await db.claim()).toBeNull();
      expect((await db.list(another))[0].state).toBe("failed");
      const summary = await db.apiCreditSummary(owner);
      expect(summary.balance).toBe("4");
      expect(
        summary.entries.filter((item) => item.kind === "scan_refund"),
      ).toHaveLength(2);
      // Public requests never reserve credits, even when publication is empty.
      const guestHost = "guest." + host;
      const guestScan = await db.enqueue(guestHost);
      const guestJob = await db.claim();
      expect(guestJob?.id).toBe(guestScan);
      await db.finish(guestScan!, guestJob!.owner, {
        id: guestScan,
        domain: guestHost,
        demo: false,
        partial: true,
        completedAt: new Date().toISOString(),
        evidence: [],
        findings: [],
      });
      expect(
        await sql`select scan_id from api_credit_entries where scan_id=${guestScan!}`,
      ).toHaveLength(0);
      expect(
        await sql`select scan_id from creem_api_operations where scan_id=${guestScan!}`,
      ).toHaveLength(0);
    } finally {
      try {
        await sql`delete from scans where domain in (${host}, ${another}, ${"guest." + host})`;
        await sql`delete from domains where name in (${host}, ${another}, ${"guest." + host})`;
        await sql`delete from "user" where id = ${owner}`;
      } finally {
        await Promise.all([db.close(), sql.end()]);
      }
    }
  },
);

it.skipIf(!url)(
  "settles a payment once and stores one response per accepted debit",
  async () => {
    const db = connect(url!);
    const sql = postgres(url!);
    const owner = randomUUID();
    const other = randomUUID();
    try {
      await sql`insert into "user"(id, name, email) values
      (${owner}, 'Owner', ${owner + "@example.test"}),
      (${other}, 'Other', ${other + "@example.test"})`;
      const reference = "creem:" + randomUUID();
      expect(
        (
          await Promise.all([
            db.recordApiCreditPurchase(owner, reference, 5),
            db.recordApiCreditPurchase(owner, reference, 5),
          ])
        ).sort(),
      ).toEqual(["applied", "replayed"]);
      expect(await db.recordApiCreditPurchase(other, reference, 5)).toBe(
        "conflict",
      );
      expect(await db.recordApiCreditPurchase(owner, reference, 6)).toBe(
        "conflict",
      );
      const first = {
        key: "first",
        requestHash: digest("report:example.com"),
        amount: 4,
        response: { domain: "example.com", score: 85 },
      };
      const second = { ...first, key: "second" };
      const results = await Promise.all([
        db.debitApiCredits(owner, first),
        db.debitApiCredits(owner, second),
      ]);
      expect(results.map(({ code }) => code).sort()).toEqual([
        "applied",
        "insufficient",
      ]);
      const applied = results[0].code === "applied" ? first : second;
      expect(
        await db.debitApiCredits(owner, {
          ...applied,
          response: { score: 75 },
        }),
      ).toEqual({
        code: "replayed",
        response: first.response,
      });
      expect(
        await db.debitApiCredits(owner, {
          ...applied,
          requestHash: digest("report:example.org"),
        }),
      ).toEqual({
        code: "conflict",
      });
      const summary = await db.apiCreditSummary(owner);
      expect(summary.balance).toBe("1");
      expect(summary.entries.map(({ delta }) => delta)).toEqual([-4, 5]);
      expect(summary.entries[0]).toMatchObject({
        domain: "example.com",
        scanId: null,
      });
      expect(summary.entries[0]).not.toHaveProperty("response");
      expect(await db.apiCreditSummary(other)).toEqual({
        balance: "0",
        entries: [],
      });
      expect(
        (
          await Promise.all([
            db.recordApiCreditPaymentRefund(reference),
            db.recordApiCreditPaymentRefund(reference),
          ])
        ).sort(),
      ).toEqual(["applied", "replayed"]);
      expect(
        await db.recordApiCreditPaymentRefund("missing:" + reference),
      ).toBe("missing");
      const refunded = await db.apiCreditSummary(owner);
      expect(refunded.balance).toBe("-4");
      expect(
        refunded.entries.filter((entry) => entry.kind === "payment_refund"),
      ).toHaveLength(1);
      await sql`insert into api_credit_entries(user_id, kind, reference, delta)
        select ${owner}, 'purchase', ${owner} || ':' || n, 1 from generate_series(1, 26) n`;
      const recent = await db.apiCreditSummary(owner);
      const full = await db.apiCreditSummary(owner, { fullHistory: true });
      expect(recent.entries).toHaveLength(25);
      expect(full.entries).toHaveLength(29);
      expect(full.balance).toBe(recent.balance);
    } finally {
      try {
        await sql`delete from "user" where id in (${owner}, ${other})`;
      } finally {
        await Promise.all([db.close(), sql.end()]);
      }
    }
  },
);
