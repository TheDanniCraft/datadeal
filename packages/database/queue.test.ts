import { randomUUID } from "node:crypto";
import { methodologyVersion } from "@datadeal/scoring";
import { describe, expect, it } from "vitest";
import { connect } from "./index";
import postgres from "postgres";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
describe.skipIf(!url)("PostgreSQL scan queue", () => {
  it("requires the migrated application schema for readiness", async () => {
    const db = connect(url!);
    const unmigrated = new URL(url!);
    unmigrated.searchParams.set("search_path", "pg_catalog");
    const withoutAppSchema = connect(unmigrated.href);
    try {
      await expect(db.checkScanStorage()).resolves.toBeUndefined();
      await expect(withoutAppSchema.checkScanStorage()).rejects.toMatchObject({
        code: "42P01",
      });
    } finally {
      await Promise.all([db.close(), withoutAppSchema.close()]);
    }
  });

  it("lists fresh real reports with a verified accept-all score or an explicit unrated status", async () => {
    const db = connect(url!);
    const sql = postgres(url!);
    const suffix = randomUUID() + ".example.com";
    const completedAt = new Date().toISOString();
    const rating = {
      methodologyVersion,
      score: 65,
      grade: "Mixed",
      confidence: "Low",
      verdict: "Use with caution.",
      adjustments: [],
    };
    try {
      for (const label of [
        "confirmed",
        "unconfirmed",
        "reject-only",
        "stale",
        "demo",
      ]) {
        const domain = label + "." + suffix,
          id = randomUUID();
        const report = {
          id,
          domain,
          demo: label === "demo",
          partial: false,
          completedAt,
          findings: [],
          scoring: { ...rating, score: 10, grade: "Critical" },
          rejectedScoring: rating,
          acceptAllScoring: label === "reject-only" ? undefined : rating,
          consentCoverage: {
            default: "measured",
            accepted: "measured",
            rejected: "untested",
          },
          evidence: [
            {
              id: "visit",
              scanId: id,
              kind: "observed_technical",
              consentScenario: "accepted",
              url: "https://" + domain + "/",
              retrievedAt: completedAt,
              excerpt: "Observed consent run.",
              observation: {
                type: "browser_consent_counts",
                requests: 4,
                cookies: 1,
                externalDomains: [],
                finalPageKnown: true,
                afterChoice: {
                  requests: 1,
                  externalDomains: [],
                  acceptedAll: label !== "unconfirmed",
                },
              },
            },
          ],
        };
        await sql`insert into domains(name) values (${domain})`;
        await sql`insert into scans(id,domain,state,requested_at,report) values (${id},${domain},'completed',now() - make_interval(days => ${label === "stale" ? 8 : 0}),${JSON.stringify(report)}::text::jsonb)`;
        if (label === "confirmed")
          await sql`insert into scans(id,domain,state) values (${randomUUID()},${domain},'queued')`;
      }
      const recent = (await db.recentPublishedDomains()).filter((row) =>
        row.domain.endsWith(suffix),
      );
      expect(recent).toHaveLength(3);
      expect(
        recent.find((row) => row.domain === "confirmed." + suffix),
      ).toMatchObject({
        score: 65,
        grade: "Mixed",
        headlineScenario: "accepted",
      });
      for (const label of ["reject-only", "unconfirmed"])
        expect(
          recent.find((row) => row.domain === label + "." + suffix),
        ).toMatchObject({ score: null, grade: "Unrated" });
      await sql`insert into scans(id,domain,state,requested_at,report)
        select ${randomUUID()},domain,'completed',now()+interval '1 second', report - 'acceptAllScoring'
        from scans where domain=${"confirmed." + suffix} and report is not null limit 1`;
      expect(
        (await db.recentPublishedDomains()).find(
          (row) => row.domain === "confirmed." + suffix,
        )?.score,
      ).toBeNull();
    } finally {
      await db.close();
      await sql.end();
    }
  });
  it("finds exact provider observations in the latest recent real scan per website", async () => {
    const db = connect(url!);
    const sql = postgres(url!);
    const suffix = randomUUID() + ".example.com";
    const provider = "provider." + suffix;
    const expected = {
      domain: "visible." + suffix,
      scanId: randomUUID(),
      evidenceId: "homepage",
      responded: true,
    };
    try {
      for (const [host, id, days, demo, destination] of [
        [expected.domain, expected.scanId, 0, false, provider],
        ["stale." + suffix, randomUUID(), 8, false, provider],
        ["demo." + suffix, randomUUID(), 0, true, provider],
        ["changed." + suffix, randomUUID(), 2, false, provider],
        ["changed." + suffix, randomUUID(), 1, false, "another." + suffix],
      ] as const) {
        await sql`insert into domains(name) values (${host}) on conflict do nothing`;
        const evidence = [
          {
            id: "homepage",
            scanId: id,
            kind: "observed_technical",
            consentScenario: "default",
            observation: {
              type: "browser_consent_counts",
              externalDomains: [destination],
              responseDomains: host === expected.domain ? [destination] : [],
            },
          },
        ];
        await sql`insert into scans(id, domain, state, requested_at, report) values
          (${id}, ${host}, 'completed', now() - make_interval(days => ${days}),
            ${JSON.stringify({ demo, evidence })}::text::jsonb)`;
      }
      expect(await db.observedProviderReferences(provider)).toEqual([expected]);
      expect(await db.topObservedProviders()).toContainEqual({
        provider,
        sites: 1,
      });
    } finally {
      await Promise.all([db.close(), sql.end()]);
    }
  });

  it("indexes a provider seen only on a measured article and cites that visit", async () => {
    const db = connect(url!);
    const sql = postgres(url!);
    const host = randomUUID() + ".example.com";
    const provider = "cdn." + randomUUID() + ".example";
    const scanId = randomUUID();
    const pageUrl = "https://" + host + "/story";
    function observed(
      index: number,
      scenario: string,
      url: string,
      dest: string,
    ) {
      return {
        id: `browser-page-${index}-${scenario}`,
        scanId,
        kind: "observed_technical",
        consentScenario: scenario,
        url,
        observation: {
          type: "browser_content_page",
          externalDomains: [dest],
          responseDomains: [dest],
          requests: 3,
          finalPageKnown: true,
        },
      };
    }
    const snapshot = {
      demo: false,
      evidence: [
        observed(1, "accepted", pageUrl, provider),
        observed(1, "default", pageUrl, provider),
        observed(1, "rejected", pageUrl, "unmeasured." + provider),
        observed(
          2,
          "default",
          "https://elsewhere.example/",
          "redirected." + provider,
        ),
      ],
      pageSample: {
        pages: [1, 2].map(() => ({
          url: pageUrl,
          coverage: {
            default: "measured",
            accepted: "measured",
            rejected: "inconclusive",
          },
        })),
      },
    };
    try {
      await sql`insert into domains(name) values (${host})`;
      await sql`insert into scans(id,domain,state,report) values
        (${scanId}, ${host}, 'completed', ${JSON.stringify(snapshot)}::text::jsonb)`;
      expect(await db.observedProviderReferences(provider)).toEqual([
        {
          domain: host,
          scanId,
          evidenceId: "browser-page-1-default",
          responded: true,
        },
      ]);
      expect(await db.topObservedProviders()).toContainEqual({
        provider,
        sites: 1,
      });
      for (const prefix of ["unmeasured.", "redirected."])
        expect(await db.observedProviderReferences(prefix + provider)).toEqual(
          [],
        );
    } finally {
      await Promise.all([db.close(), sql.end()]);
    }
  });

  it("spends one allowance for concurrent requests and none during the cooldown", async () => {
    const db = connect(url!);
    const sql = postgres(url!);
    const host = randomUUID() + ".example.com";
    const daily = "daily:account:" + randomUUID();
    try {
      const requests = await Promise.all(
        Array.from({ length: 8 }, () => db.requestScan(host, null, daily)),
      );
      const first = requests[0];
      expect(first).toMatchObject({ code: "accepted", id: expect.any(String) });
      expect(requests).toEqual(Array.from({ length: 8 }, () => first));
      const job = await db.claim();
      expect(job?.domain).toBe(host);
      expect(await db.finish(job!.id, job!.owner, null)).toBe(true);
      expect(await db.requestScan(host, null, daily)).toMatchObject({
        code: "domain_cooldown",
      });
      expect(
        await sql`select hits from scan_request_limits where bucket = ${daily}`,
      ).toEqual([{ hits: 1 }]);
    } finally {
      await db.close();
      await sql.end();
    }
  });
  it("renews only an active lease and reports whether completion was committed", async () => {
    const db = connect(url!);
    const sql = postgres(url!);
    try {
      const id = await db.enqueue("renew-lease.example.com");
      expect((await db.list("RENEW-LEASE.EXAMPLE.COM"))[0]).toMatchObject({
        id,
        state: "queued",
      });
      const original = await db.claim();
      expect(original?.id).toBe(id);
      expect(await db.activeScanStages(id!)).toEqual(["homepage"]);
      expect((await db.list("renew-lease.example.com"))[0]).toMatchObject({
        id,
        state: "fetching",
      });
      await sql`update scan_jobs set lease_until = now() + interval '5 seconds' where scan_id = ${id}`;
      expect(await db.renewScanLease(id!, randomUUID(), "publication")).toBe(
        false,
      );
      expect(await db.renewScanLease(id!, original!.owner, "sitemap")).toBe(
        true,
      );
      expect(await db.renewScanLease(id!, original!.owner, "sitemap")).toBe(
        true,
      );
      expect(await db.activeScanStages(id!)).toEqual(["homepage", "sitemap"]);
      expect(
        await sql`select lease_until > now() + interval '30 seconds' as extended from scan_jobs where scan_id = ${id}`,
      ).toEqual([{ extended: true }]);
      await sql`update scan_jobs set lease_until = now() - interval '1 second' where scan_id = ${id}`;
      expect(await db.renewScanLease(id!, original!.owner)).toBe(false);
      const replacement = await db.claim();
      expect(replacement).toMatchObject({ id, attempts: 2 });
      expect(await db.activeScanStages(id!)).toEqual(["homepage"]);
      expect(await db.finish(id!, original!.owner, null)).toBe(false);
      expect(await db.finish(id!, replacement!.owner, null)).toBe(true);
      expect((await db.list("renew-lease.example.com"))[0]).toMatchObject({
        id,
        state: "failed",
      });
      const cooldown = await db.requestScan(
        "renew-lease.example.com",
        null,
        null,
      );
      expect(cooldown).toMatchObject({
        code: "domain_cooldown",
        retryAfter: expect.any(Number),
      });
    } finally {
      await db.close();
      await sql.end();
    }
  });

  it("prioritizes up to three Pro rescans and serves waiting jobs first", async () => {
    const sql = postgres(url!);
    const db = connect(url!);
    try {
      await sql`insert into "user"(id,name,email) values ('priority-user','Priority','priority@example.test')`;
      await db.applyBillingEvent({
        id: "priority-paid",
        time: 1,
        subscription: "priority-sub",
        customer: "priority-customer",
        product: "priority-plan",
        userId: "priority-user",
        status: "active",
        accessUntil: "2099-01-01T00:00:00Z",
      });
      const ordinary = await db.enqueue("ordinary-priority.example.com");
      const firstScan = await db.enqueue(
        "first-priority.example.com",
        "manual",
        "priority-user",
      );
      const aging = await db.enqueue("aging-priority.example.com");
      await sql`update scans set requested_at = now() - interval '11 minutes' where id = ${aging}`;
      const rescans = [];
      for (let index = 0; index < 4; index++) {
        const domain = `priority-${index}.example.com`;
        await sql`insert into domains(name) values (${domain})`;
        await sql`insert into scans(id,domain,state,requested_at,report) values
          (${randomUUID()},${domain},'partially_completed',now() - interval '2 hours','{"demo":false}'::jsonb)`;
        rescans.push(await db.enqueue(domain, "manual", "priority-user"));
      }
      for (const id of [
        aging,
        ...rescans.slice(0, 3),
        ordinary,
        firstScan,
        rescans[3],
      ]) {
        const job = await db.claim();
        expect(job?.id).toBe(id);
        await db.finish(job!.id, job!.owner, null);
      }
    } finally {
      await db.close();
      await sql.end();
    }
  });

  it("favors first reports over routine refreshes until ten-minute aging restores FIFO", async () => {
    const sql = postgres(url!);
    const db = connect(url!);
    const suffix = randomUUID() + ".example.com";
    try {
      // The refreshes have waited longer than the first reports in both groups.
      const requests = [
        { label: "old-refresh", minutes: 14, state: "completed", demo: false },
        { label: "old-first", minutes: 12 },
        {
          label: "refresh",
          minutes: 8,
          state: "partially_completed",
          demo: false,
        },
        { label: "demo-only", minutes: 5, state: "completed", demo: true },
        { label: "failed-only", minutes: 4, state: "failed", demo: false },
        { label: "new", minutes: 2 },
      ];
      for (const { label, minutes, state, demo } of requests) {
        const host = label + "." + suffix;
        if (state) {
          await sql`insert into domains(name) values (${host})`;
          await sql`insert into scans(id,domain,state,requested_at,report) values
            (${randomUUID()}, ${host}, ${state}, now() - interval '2 hours',
             ${state === "failed" ? null : JSON.stringify({ demo })}::text::jsonb)`;
        }
        const job = await db.requestScan(host, null, null);
        if (job.code !== "accepted") throw new Error("Expected queued report");
        await sql`update scans set requested_at = now() - make_interval(mins => ${minutes}) where id = ${job.id}`;
      }
      for (const label of [
        "old-refresh",
        "old-first",
        "demo-only",
        "failed-only",
        "new",
        "refresh",
      ]) {
        const job = await db.claim();
        expect(job?.domain).toBe(label + "." + suffix);
        await db.finish(job!.id, job!.owner, null);
      }
    } finally {
      await Promise.all([db.close(), sql.end()]);
    }
  });

  it("atomically caps concurrent requests for a client across domains", async () => {
    const db = connect(url!);
    try {
      const client = "client:" + randomUUID();
      const results = await Promise.all(
        Array.from({ length: 14 }, () => db.scanRequestAdmission(client)),
      );
      expect(results.filter((result) => result === "allowed")).toHaveLength(10);
      expect(await db.scanRequestAdmission("client:" + randomUUID())).toBe(
        "allowed",
      );
    } finally {
      await db.close();
    }
  });

  it("does not consume a client allowance when the global limit is full", async () => {
    const db = connect(url!);
    const sql = postgres(url!);
    const client = "client:" + randomUUID();
    const [previous] = await sql`
      select hour, hits from scan_request_limits where bucket = 'global'
    `;
    try {
      await sql`
        insert into scan_request_limits(bucket, hour, hits)
        values ('global', date_trunc('hour', now()), 120)
        on conflict (bucket) do update set hour = excluded.hour, hits = excluded.hits
      `;
      expect(await db.scanRequestAdmission(client)).toBe("hour");
      expect(
        await sql`select hits from scan_request_limits where bucket = ${client}`,
      ).toEqual([]);
    } finally {
      if (previous)
        await sql`update scan_request_limits set hour = ${previous.hour}, hits = ${previous.hits} where bucket = 'global'`;
      else await sql`delete from scan_request_limits where bucket = 'global'`;
      await db.close();
      await sql.end();
    }
  });

  it("limits free accounts to five admitted requests per UTC day", async () => {
    const db = connect(url!);
    try {
      const day = "daily:account:" + randomUUID();
      const results = await Promise.all(
        Array.from({ length: 7 }, () => db.scanRequestAdmission(null, day)),
      );
      expect(results.filter((result) => result === "allowed")).toHaveLength(5);
      expect(results.filter((result) => result === "day")).toHaveLength(2);
      await db.pruneExpiredPrivateData();
      expect(await db.scanRequestAdmission(null, day)).toBe("day");
    } finally {
      await db.close();
    }
  });

  it("defers transient failures and releases ownership while queued", async () => {
    const db = connect(url!);
    try {
      const domain = randomUUID() + ".example.com";
      const id = await db.enqueue(domain);
      const job = await db.claim();
      expect(job).toMatchObject({ id, attempts: 1 });
      expect(await db.retryScan(id!, randomUUID())).toBe(false);
      expect(await db.retryScan(id!, job!.owner)).toBe(true);
      await db.finish(id!, job!.owner, null);
      expect(await db.claim()).toBeNull();
      expect((await db.list(domain))[0].state).toBe("queued");
    } finally {
      await db.close();
    }
  });

  it("deduplicates concurrent requests and rejects stale lease owners", async () => {
    const db = connect(url!);
    const domain = randomUUID() + ".example.com";
    try {
      const [id, duplicate] = await Promise.all([
        db.enqueue(domain),
        db.enqueue(domain),
      ]);
      expect(id).toBeTruthy();
      expect(duplicate).toBe(id);
      const job = await db.claim();
      expect(job).toMatchObject({ id, domain });
      expect(await db.claim()).toBeNull();
      await db.finish(id!, randomUUID(), null);
      expect((await db.list(domain))[0].state).toBe("fetching");
      const hash = randomUUID();
      const analysis = {
        model: "local-empty",
        promptVersion: "1",
        output: { findings: [] },
      };
      await db.finish(
        id!,
        job!.owner,
        {
          id,
          domain,
          completedAt: new Date().toISOString(),
          demo: false,
          partial: true,
          evidence: [],
          findings: [],
        },
        { hash, result: analysis },
      );
      expect(await db.cachedAnalysis(hash)).toEqual(analysis);
      expect((await db.list(domain))[0]).toMatchObject({
        state: "partially_completed",
        report: {
          id,
          domain,
          partial: true,
          scoring: {
            methodologyVersion,
            grade: "Unrated",
            score: null,
            adjustments: [],
          },
        },
      });
    } finally {
      await db.close();
    }
  });
});
