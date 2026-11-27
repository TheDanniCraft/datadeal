import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { connect } from "./index";
import { applyReportPoints } from "./report-points";
import { defaultRefreshPointCost as cost } from "@datadeal/contracts/paper-plane";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
async function verify(
  run: (fixture: {
    db: ReturnType<typeof connect>;
    sql: ReturnType<typeof postgres>;
    user: string;
    host: string;
    balance: () => Promise<number>;
  }) => Promise<void>,
) {
  const db = connect(url!),
    sql = postgres(url!);
  const user = randomUUID(),
    host = `refresh-${randomUUID()}.example.com`;
  try {
    await sql`insert into "user"(id,name,email) values(${user},'Refresh test',${user + "@example.test"})`;
    await sql`insert into domains(name) values(${host})`;
    await sql`insert into scans(id,domain,state,requested_at,report) values(${randomUUID()},${host},'completed',now()-interval '2 hours','{"demo":false}'::jsonb)`;
    const balance = async () =>
      Number(
        (
          await sql`select balance from report_point_accounts where user_id=${user}`
        )[0]?.balance ?? 0,
      );
    await run({ db, sql, user, host, balance });
  } finally {
    await sql`delete from "user" where id=${user}`;
    await sql`delete from scans where domain=${host}`;
    await sql`delete from domains where name=${host}`;
    await sql`delete from scan_request_limits where bucket=${"test-points:" + user}`;
    await Promise.all([sql.end(), db.close()]);
  }
}
describe.skipIf(!url)("Optional report-point refresh", () => {
  it("atomically charges one new scan, replays its receipt and refunds one terminal failure", () =>
    verify(async ({ db, sql, user, host, balance }) => {
      await sql.begin((tx) =>
        applyReportPoints(tx, {
          userId: user,
          delta: cost,
          operation: "test_award",
          referenceId: randomUUID(),
        }),
      );
      const key = randomUUID();
      const request = () =>
        db.requestPointRefresh(user, host, key, null, "test-points:" + user);
      const results = await Promise.all(Array.from({ length: 5 }, request));
      const first = results[0];
      if (first.code !== "accepted") throw Error("Expected refresh admission");
      expect(
        results.every((row) => row.code === "accepted" && row.id === first.id),
      ).toBe(true);
      expect(await balance()).toBe(0);
      expect(
        await db.requestPointRefresh(
          user,
          "another.example.com",
          key,
          null,
          null,
        ),
      ).toMatchObject({ code: "conflict" });
      expect(
        await db.requestPointRefresh(user, host, randomUUID(), null, null),
      ).toMatchObject({ code: "scan_in_progress", id: first.id });
      const owner = randomUUID();
      await sql`update scan_jobs set owner=${owner},lease_until=now()+interval '5 minutes' where scan_id=${first.id}`;
      expect(await db.finish(first.id, owner, null)).toBe(true);
      expect(await db.finish(first.id, owner, null)).toBe(false);
      expect(await balance()).toBe(cost);
      expect(await request()).toMatchObject({ code: "refunded", id: first.id });
      expect(
        await db.requestPointRefresh(user, host, randomUUID(), null, null),
      ).toMatchObject({ code: "domain_cooldown" });
      expect(
        await sql`select 1 from report_point_ledger where operation='scan_refresh_refund' and reference_id=${first.id}`,
      ).toHaveLength(1);
    }));
  it("rolls back an unaffordable job, observes ordinary limits, and leaves a free rescan free", () =>
    verify(async ({ db, sql, user, host, balance }) => {
      const daily = "test-points:" + user;
      expect(
        await db.requestPointRefresh(user, host, randomUUID(), null, daily),
      ).toMatchObject({ code: "insufficient_points" });
      expect(
        await sql`select 1 from scans where domain=${host} and state='queued'`,
      ).toHaveLength(0);
      expect(
        await sql`select 1 from scan_request_limits where bucket=${daily}`,
      ).toHaveLength(0);
      await sql.begin((tx) =>
        applyReportPoints(tx, {
          userId: user,
          delta: 100,
          operation: "test_award",
          referenceId: randomUUID(),
        }),
      );
      await sql`insert into scan_request_limits(bucket,hour,hits) values(${daily},date_trunc('day',now(),'UTC'),5)`;
      expect(
        await db.requestPointRefresh(user, host, randomUUID(), null, daily),
      ).toMatchObject({ code: "daily_limit" });
      expect(
        await db.requestPointRefresh(
          user,
          "missing.example.com",
          randomUUID(),
          null,
          null,
        ),
      ).toMatchObject({ code: "no_report" });
      expect(await db.requestScan(host, null, null, user)).toMatchObject({
        code: "accepted",
      });
      expect(await balance()).toBe(100);
      expect(
        await sql`select 1 from report_point_ledger where user_id=${user} and delta<0`,
      ).toHaveLength(0);
    }));
  it("funds only one simultaneous domain refresh with a one-refresh balance", () =>
    verify(async ({ db, sql, user, host, balance }) => {
      const other = "other." + host;
      await sql`insert into domains(name) values(${other})`;
      try {
        await sql`insert into scans(id,domain,state,requested_at,report) values(${randomUUID()},${other},'completed',now()-interval '2 hours','{"demo":false}'::jsonb)`;
        await sql.begin((tx) =>
          applyReportPoints(tx, {
            userId: user,
            delta: cost,
            operation: "test_award",
            referenceId: randomUUID(),
          }),
        );
        const requests = await Promise.all(
          [host, other].map((domain) =>
            db.requestPointRefresh(user, domain, randomUUID(), null, null),
          ),
        );
        expect(requests.map((r) => r.code).sort()).toEqual([
          "accepted",
          "insufficient_points",
        ]);
        expect(await balance()).toBe(0);
        expect(
          await sql`select 1 from scans where domain in (${host},${other}) and state='queued'`,
        ).toHaveLength(1);
      } finally {
        await sql`delete from scans where domain=${other}`;
        await sql`delete from domains where name=${other}`;
      }
    }));
  it("restores the charge when the worker lease expires on its last attempt", () =>
    verify(async ({ db, sql, user, host, balance }) => {
      await sql.begin((tx) =>
        applyReportPoints(tx, {
          userId: user,
          delta: cost,
          operation: "test_award",
          referenceId: randomUUID(),
        }),
      );
      const queued = await db.requestPointRefresh(
        user,
        host,
        randomUUID(),
        null,
        null,
      );
      if (queued.code !== "accepted") throw Error("Expected refresh admission");
      await sql`update scan_jobs set attempts=3,lease_until=now()-interval '1 minute' where scan_id=${queued.id}`;
      await sql`update scans set requested_at=now()-interval '6 years' where id=${queued.id}`;
      expect(await db.claim()).toBeNull();
      expect(await balance()).toBe(cost);
      expect(
        await sql`select 1 from scan_jobs where scan_id=${queued.id}`,
      ).toHaveLength(0);
    }));
});
