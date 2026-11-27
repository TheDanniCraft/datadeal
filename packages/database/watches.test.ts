import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  proIncludedWatches,
  proMonthlyBoosts,
  queueBoostCost,
} from "@datadeal/contracts/paper-plane";
import { watchCheckCost } from "@datadeal/contracts/watch-schedule";
import { applyReportPoints, connect, type AlertMailer } from "./index";
import {
  activatePro,
  insertTestUser,
  resetTestQueue,
  testHost,
} from "./test-support";

const url = process.env.DATADEAL_TEST_DATABASE_URL;

describe.skipIf(!url)("Watching sites", () => {
  const sql = url ? postgres(url, { onnotice: () => {} }) : null!;
  const db = url ? connect(url) : null!;
  const users: string[] = [];

  beforeEach(() => resetTestQueue(sql));
  afterAll(async () => {
    if (!url) return;
    if (users.length) await sql`delete from "user" where id = any(${users})`;
    await resetTestQueue(sql);
    await Promise.all([db.close(), sql.end()]);
  });

  async function user(label: string, points = 0) {
    const id = await insertTestUser(sql, label);
    users.push(id);
    if (points)
      await sql.begin((tx) =>
        applyReportPoints(tx, {
          userId: id,
          delta: points,
          operation: "test_grant",
          referenceId: randomUUID(),
        }),
      );
    return id;
  }
  async function balance(userId: string) {
    const [row] = await sql<{ balance: number }[]>`
      select balance from report_point_accounts where user_id = ${userId}`;
    return row?.balance ?? 0;
  }
  async function publishedScan(host: string, age = "0 seconds") {
    const id = randomUUID();
    await sql`insert into domains(name) values (${host}) on conflict do nothing`;
    await sql`insert into scans(id, domain, state, requested_at, report) values
      (${id}, ${host}, 'completed', now() - ${age}::interval,
        ${JSON.stringify({ demo: false })}::text::jsonb)`;
    return id;
  }
  const queued = (host: string) =>
    sql<{ id: string; requested_at: Date }[]>`
      select s.id, s.requested_at from scans s join scan_jobs j on j.scan_id = s.id
      where s.domain = ${host}`;
  const makeDue = (userId: string, host: string) =>
    sql`update site_monitors set next_check_at = now() - interval '1 second'
      where user_id = ${userId} and domain = ${host}`;
  const watchRow = async (userId: string, host: string) =>
    (
      await sql<{ next_check_at: Date; charged_at: Date | null }[]>`
        select next_check_at, charged_at from site_monitors
        where user_id = ${userId} and domain = ${host}`
    )[0];

  it("charges each due check, then lets a fresh scan through for free", async () => {
    const watcher = await user("watch-charged", 500);
    const host = testHost("watch-charged");
    expect(
      await db.startMonitoring(watcher, host, { kind: "days", days: 7 }),
    ).toBe("monitoring");
    const watch = await db.monitorFor(watcher, host);
    expect(watch).toMatchObject({
      schedule: { kind: "days", days: 7 },
      since: expect.any(Date),
    });
    await db.runDueWatches();
    expect(await balance(watcher)).toBe(500 - watchCheckCost);
    const [scan] = await queued(host);
    expect(scan).toBeDefined();
    expect(scan!.requested_at.getTime()).toBeGreaterThanOrEqual(
      watch!.since.getTime() - 1000,
    );
    const after = await watchRow(watcher, host);
    expect(after?.charged_at).not.toBeNull();
    expect(after!.next_check_at.getTime()).toBeGreaterThan(
      Date.now() + 6 * 24 * 3600_000,
    );
    // The next check finds the queued scan: nobody pays, the watch moves on.
    await makeDue(watcher, host);
    await db.runDueWatches();
    expect(await balance(watcher)).toBe(500 - watchCheckCost);
    expect(await queued(host)).toHaveLength(1);
    expect(
      (await watchRow(watcher, host))!.next_check_at.getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it("charges the first check even when someone just scanned the site", async () => {
    const watcher = await user("watch-first", 300);
    const host = testHost("watch-first");
    const earlier = await publishedScan(host);
    expect(
      await db.startMonitoring(watcher, host, { kind: "days", days: 1 }),
    ).toBe("monitoring");
    await db.runDueWatches();
    expect(await balance(watcher)).toBe(300 - watchCheckCost);
    const [own] = await queued(host);
    expect(own?.id).toBeDefined();
    expect(own!.id).not.toBe(earlier);
  });

  it("stops a watch that cannot pay and lists it as stopped", async () => {
    const watcher = await user("watch-stopped", watchCheckCost);
    const host = testHost("watch-stopped");
    const schedule = { kind: "days", days: 3 } as const;
    expect(await db.startMonitoring(watcher, host, schedule)).toBe(
      "monitoring",
    );
    await db.runDueWatches();
    expect(await balance(watcher)).toBe(0);
    // The scan has finished long ago, so the next check needs payment.
    await resetTestQueue(sql);
    await sql`update scans set requested_at = now() - interval '5 days' where domain = ${host}`;
    await makeDue(watcher, host);
    await db.runDueWatches();
    expect(await db.monitorFor(watcher, host)).toBeNull();
    expect(await db.listWatches(watcher)).toEqual([]);
    expect(await db.stoppedWatches(watcher)).toMatchObject([
      { domain: host, schedule, stoppedAt: expect.any(Date) },
    ]);
    expect(await db.startMonitoring(watcher, host, schedule)).toBe(
      "insufficient",
    );
    // Starting again hides the stopped row.
    await sql.begin((tx) =>
      applyReportPoints(tx, {
        userId: watcher,
        delta: watchCheckCost,
        operation: "test_grant",
        referenceId: randomUUID(),
      }),
    );
    expect(await db.startMonitoring(watcher, host, schedule)).toBe(
      "monitoring",
    );
    expect(await db.stoppedWatches(watcher)).toEqual([]);
  });

  it("leaves a watch due and uncharged while the queue is full", async () => {
    const watcher = await user("watch-queue-full", 500);
    const host = testHost("watch-queue-full");
    expect(
      await db.startMonitoring(watcher, host, { kind: "days", days: 7 }),
    ).toBe("monitoring");
    const [{ count }] = await sql<{ count: number }[]>`
      select count(*)::int as count from scan_jobs`;
    const filler = testHost("filler");
    await sql`insert into domains(name) values (${filler})`;
    for (let i = count; i < 50; i++) {
      const id = randomUUID();
      await sql`insert into scans(id, domain, state) values (${id}, ${filler}, 'queued')`;
      await sql`insert into scan_jobs(scan_id) values (${id})`;
    }
    const counts = await db.runDueWatches();
    expect(counts.waiting).toBeGreaterThanOrEqual(1);
    expect(await balance(watcher)).toBe(500);
    expect((await watchRow(watcher, host))!.charged_at).toBeNull();
    expect(
      (await watchRow(watcher, host))!.next_check_at.getTime(),
    ).toBeLessThanOrEqual(Date.now());
    await resetTestQueue(sql);
    await db.runDueWatches();
    expect(await balance(watcher)).toBe(500 - watchCheckCost);
  });

  it("starts only with enough points and changes the schedule of a running watch", async () => {
    const poor = await user("watch-poor", watchCheckCost - 1);
    const host = testHost("watch-schedule");
    expect(
      await db.startMonitoring(poor, host, { kind: "days", days: 7 }),
    ).toBe("insufficient");
    expect(
      await db.startMonitoring(poor, host, { kind: "cron", cron: "* * * * *" }),
    ).toBe("schedule");
    const watcher = await user("watch-change", watchCheckCost);
    expect(
      await db.startMonitoring(watcher, host, { kind: "days", days: 30 }),
    ).toBe("monitoring");
    await db.runDueWatches();
    expect(await balance(watcher)).toBe(0);
    const before = (await watchRow(watcher, host))!.next_check_at.getTime();
    // A running watch can change its schedule with an empty balance.
    expect(
      await db.startMonitoring(watcher, host, { kind: "days", days: 1 }),
    ).toBe("monitoring");
    const after = (await watchRow(watcher, host))!.next_check_at.getTime();
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThanOrEqual(Date.now() + 24 * 3600_000 + 5000);
    expect((await db.monitorFor(watcher, host))?.schedule).toEqual({
      kind: "days",
      days: 1,
    });
  });

  it(`includes ${proIncludedWatches} Pro watches`, async () => {
    const pro = await user("pro-watches");
    await activatePro(db, pro);
    const hosts = [testHost("a"), testHost("b"), testHost("c")];
    for (const host of hosts)
      expect(await db.saveWatchlistDomain(pro, host)).toBe("saved");
    expect(await db.setDocumentAlerts(pro, hosts[0]!, true)).toBe("updated");
    expect(await db.setDocumentAlerts(pro, testHost("unsaved"), true)).toBe(
      "missing",
    );
    expect(await db.setDocumentAlerts(pro, hosts[1]!, true)).toBe("updated");
    expect(await db.setDocumentAlerts(pro, hosts[2]!, true)).toBe("limit");
    // Sites already watched stay watched.
    expect(await db.setDocumentAlerts(pro, hosts[0]!, true)).toBe("updated");
    expect(await db.watchingCount(pro)).toBe(2);
    expect(await db.setDocumentAlerts(pro, hosts[1]!, false)).toBe("updated");
    expect(await db.setDocumentAlerts(pro, hosts[2]!, true)).toBe("updated");
  });

  it("boosts a waiting scan for points, free for Pro five times a month", async () => {
    const buyer = await user("boost-paid", queueBoostCost + 10);
    const first = await db.enqueue(testHost("boost-paid"));
    expect(await db.boostScan(buyer, first!)).toBe("boosted");
    expect(await balance(buyer)).toBe(10);
    expect(await db.boostScan(buyer, first!)).toBe("already_boosted");
    const second = await db.enqueue(testHost("boost-poor"));
    expect(await db.boostScan(buyer, second!)).toBe("insufficient");
    expect(await db.boostScan(buyer, randomUUID())).toBe("not_waiting");
    await sql`update scan_jobs set owner = ${randomUUID()}, lease_until = now() + interval '1 minute'
      where scan_id = ${second}`;
    expect(await db.boostScan(buyer, second!)).toBe("not_waiting");

    const pro = await user("boost-pro", queueBoostCost);
    await activatePro(db, pro);
    expect(await db.proBoostsLeft(pro)).toBe(proMonthlyBoosts);
    for (let i = 0; i < proMonthlyBoosts; i++) {
      const id = await db.enqueue(testHost("boost-pro-" + i));
      expect(await db.boostScan(pro, id!, true)).toBe("boosted");
    }
    expect(await balance(pro)).toBe(queueBoostCost);
    expect(await db.proBoostsLeft(pro)).toBe(0);
    const extra = await db.enqueue(testHost("boost-pro-extra"));
    expect(await db.boostScan(pro, extra!, true)).toBe("boosted");
    expect(await balance(pro)).toBe(0);
  });

  it("emails each watcher about a changed scan at most once", async () => {
    const host = testHost("alert-mail");
    const snapshot = (id: string, hash: string) => ({
      id,
      domain: host,
      completedAt: new Date().toISOString(),
      demo: false,
      partial: true,
      findings: [],
      evidence: [
        {
          id: "privacy",
          url: "https://" + host + "/privacy",
          hash,
          excerpt: "Policy text",
          scanId: id,
          retrievedAt: new Date().toISOString(),
          kind: "declared_first_party",
        },
      ],
    });
    const older = randomUUID();
    await sql`insert into domains(name) values (${host})`;
    await sql`insert into scans(id, domain, state, requested_at, report) values
      (${older}, ${host}, 'partially_completed', now() - interval '2 days',
        ${JSON.stringify(snapshot(older, "before"))}::text::jsonb)`;
    const pointsWatcher = await user("alert-points");
    await sql`insert into site_monitors(user_id, domain, created_at, next_check_at, charged_at)
      values (${pointsWatcher}, ${host}, now() - interval '1 day', now() + interval '6 days', now())`;
    const proWatcher = await user("alert-pro");
    await activatePro(db, proWatcher);
    await db.saveWatchlistDomain(proWatcher, host);
    await db.setDocumentAlerts(proWatcher, host, true);
    // Saved but not watching, and Pro-watching without Pro: no email.
    const bystander = await user("alert-bystander");
    await db.saveWatchlistDomain(bystander, host);
    await sql`update watchlists set document_alerts = true where user_id = ${bystander}`;

    const id = await db.enqueue(host);
    const job = await db.claim();
    expect(job?.id).toBe(id);
    expect(await db.finish(job!.id, job!.owner, snapshot(id!, "after"))).toBe(
      true,
    );
    // Points watchers see the change in their Library too.
    expect(await db.documentAlerts(pointsWatcher)).toMatchObject([
      { scan_id: id, domain: host, document_count: 1 },
    ]);
    expect(await db.documentAlerts(bystander)).toEqual([]);
    // A watch that starts later does not mail about earlier scans.
    const late = await user("alert-late", watchCheckCost);
    await db.startMonitoring(late, host, { kind: "days", days: 7 });

    const sent: Parameters<AlertMailer>[0][] = [];
    const mailer = {
      origin: "https://datadeal.example",
      send: async (mail: Parameters<AlertMailer>[0]) => {
        sent.push(mail);
      },
    };
    const results = await Promise.all([
      db.sendScanAlerts(id!, mailer),
      db.sendScanAlerts(id!, mailer),
    ]);
    expect(results.reduce((sum, r) => sum + r.sent, 0)).toBe(2);
    expect(await db.sendScanAlerts(id!, mailer)).toEqual({
      sent: 0,
      failed: 0,
    });
    const emails = await sql<{ email: string }[]>`
      select email from "user" where id in (${pointsWatcher}, ${proWatcher}) order by email`;
    expect(sent.map((mail) => mail.to).sort()).toEqual(
      emails.map((row) => row.email),
    );
    expect(sent[0]).toMatchObject({
      subject: `${host} changed: 1 privacy document changed`,
    });
    expect(sent[0]!.text).toContain(
      `https://datadeal.example/report/${host}?scan=${id}#history`,
    );
    expect(sent[0]!.text).toContain("https://datadeal.example/account/library");
    expect(
      await sql`select count(*)::int as count from alert_deliveries
        where scan_id = ${id} and sent_at is not null`,
    ).toEqual([{ count: 2 }]);

    // A failed delivery is recorded and not retried.
    const failing = await user("alert-failing");
    await sql`insert into site_monitors(user_id, domain, created_at, next_check_at, charged_at)
      values (${failing}, ${host}, now() - interval '1 day', now() + interval '6 days', now())`;
    const broken = {
      origin: mailer.origin,
      send: async () => {
        throw new Error("offline");
      },
    };
    expect(await db.sendScanAlerts(id!, broken)).toEqual({
      sent: 0,
      failed: 1,
    });
    expect(await db.sendScanAlerts(id!, mailer)).toEqual({
      sent: 0,
      failed: 0,
    });
  });
});
