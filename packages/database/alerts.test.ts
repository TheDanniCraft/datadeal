import { scanReport, type ScanReport } from "@datadeal/contracts";
import {
  calculateScore,
  calculateAcceptAllScore,
  contextualRulesRevision,
} from "@datadeal/scoring";
import { publishDataPractices } from "../ai/practices";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import postgres from "postgres";
import { connect } from "./index";
import {
  activatePro,
  insertTestUser,
  resetTestQueue,
  testHost,
} from "./test-support";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
it.skipIf(!url)(
  "appends one quiet-visit correction and preserves the initial score and evidence on concurrent retries",
  async () => {
    const sql = postgres(url!),
      db = connect(url!);
    const id = randomUUID(),
      domain = id + ".example.com",
      date = new Date().toISOString();
    const base = {
      scanId: id,
      retrievedAt: date,
      url: "https://" + domain + "/",
    };
    const store = { total: 0, inspected: 0, categories: [] };
    const report: ScanReport = {
      id,
      domain,
      completedAt: date,
      partial: false,
      demo: false,
      findings: [],
      consentCoverage: {
        default: "measured",
        accepted: "control_unavailable",
        rejected: "control_unavailable",
      },
      evidence: [
        {
          ...base,
          id: "browser-consent-default",
          excerpt: "The signed-out browser measured this page.",
          kind: "observed_technical",
          consentScenario: "default",
          observation: {
            type: "browser_consent_counts",
            freshContext: true,
            finalPageKnown: true,
            requests: 3,
            cookies: 0,
            externalDomains: [],
            storage: { localEntries: 0, sessionEntries: 0 },
            requestInspection: { examined: 3, matched: 0, limitReached: false },
            storageSummary: {
              end: {
                cookies: { total: 0, inspected: 0, recognized: [] },
                web: { local: store, session: store },
              },
            },
          },
        },
      ],
    };
    const topics = ["purpose", "sharing"] as const;
    for (const topic of topics) {
      const quote =
        topic === "purpose"
          ? "The site uses messages to respond to support questions."
          : "The site operator receives the messages submitted to support.";
      report.evidence.push({
        ...base,
        id: topic,
        excerpt: quote,
        kind: "declared_first_party",
        observation: { type: "policy_section", heading: topic, topic },
      });
      (report.policyBrief ??= []).push({
        topic,
        source: topic,
        quote,
        text: quote,
      });
    }
    const [quiet] = publishDataPractices(report).dataPractices;
    Object.assign(
      report,
      publishDataPractices(report, [
        {
          factId: quiet.factId,
          role: "unknown",
          purpose: "unknown",
          necessity: "unclear",
          confidence: "moderate",
          context: null,
          possibleConsentConflict: false,
        },
      ]),
    );
    report.scoring = {
      ...calculateScore(report),
      score: null,
      grade: "Unrated",
      rulesRevision: "contextual-practices-1",
    };
    try {
      await sql`insert into domains(name) values (${domain})`;
      await sql`insert into scans(id,domain,state,report) values (${id},${domain},'completed',${JSON.stringify(report)}::text::jsonb)`;
      expect(await db.correctQuietVisitRating(id, domain)).toMatchObject({
        status: "eligible",
        score: 80,
      });
      const results = await Promise.all([
        db.correctQuietVisitRating(id, domain, true),
        db.correctQuietVisitRating(id, domain, true),
      ]);
      expect(results.map((x) => x.status).sort()).toEqual([
        "already corrected",
        "corrected",
      ]);
      const [stored] = await sql`select report from scans where id=${id}`;
      expect(stored.report.scoring).toEqual(report.scoring);
      expect(stored.report.evidence).toEqual(report.evidence);
      expect(stored.report.scoringCorrection).toMatchObject({
        result: { score: 80, rulesRevision: contextualRulesRevision },
        reason: expect.any(String),
        correctedAt: expect.any(String),
      });
    } finally {
      await Promise.all([db.close(), sql.end()]);
    }
  },
);

it.skipIf(!url)(
  "publishes an alert for changed document text to entitled, unmuted watchers",
  async () => {
    const sql = postgres(url!);
    const db = connect(url!);
    const domain = testHost("alerts");
    const oldId = randomUUID();
    let user = "";
    const snapshot = (id: string, hash: string) => ({
      id,
      domain,
      completedAt: new Date().toISOString(),
      demo: false,
      partial: true,
      findings: [],
      evidence: [
        {
          id: "privacy",
          url: "https://" + domain + "/privacy",
          hash,
          excerpt: "Policy text",
          scanId: id,
          retrievedAt: new Date().toISOString(),
          kind: "declared_first_party",
        },
      ],
    });
    try {
      await resetTestQueue(sql);
      user = await insertTestUser(sql, "alert-user");
      await activatePro(db, user);
      expect(await db.saveWatchlistDomain(user, domain)).toBe("saved");
      // Saving is free; watching (alerts and weekly rescans) is turned on.
      expect(await db.listWatchlist(user)).toMatchObject([
        { domain, document_alerts: false },
      ]);
      expect(await db.setDocumentAlerts(user, domain, true)).toBe("updated");
      await sql`insert into domains(name) values (${domain}) on conflict do nothing`;
      await sql`insert into scans(id,domain,state,requested_at,report) values
      (${oldId},${domain},'partially_completed',now() - interval '8 days',${JSON.stringify(snapshot(oldId, "before"))}::text::jsonb)`;
      expect((await db.list(domain))[0].report).toMatchObject({
        evidence: [{ hash: "before" }],
      });
      expect(await db.dueWatchlistDomains()).toContain(domain);
      const [id, duplicate] = await Promise.all([
        db.enqueue(domain, "watchlist"),
        db.enqueue(domain, "watchlist"),
      ]);
      if (!id) throw new Error("Monitoring did not enqueue its due scan");
      expect(duplicate).toBe(id);
      expect(await db.dueWatchlistDomains()).not.toContain(domain);
      const lease = await db.claim();
      if (lease?.id !== id) throw new Error("Expected the queued scan");
      const prior = await sql`select report from scans where domain = ${domain}
        and report is not null and report->>'demo' = 'false'
        and requested_at < (select requested_at from scans where id = ${id})`;
      expect(prior).toHaveLength(1);
      expect(scanReport.parse(prior[0].report).evidence[0].hash).toBe("before");
      await db.finish(id, lease.owner, snapshot(id, "after"));
      expect((await db.list(domain))[0].report).toMatchObject({
        evidence: [{ hash: "after" }],
      });
      expect(
        await sql`select document_count from alerts where scan_id = ${id}`,
      ).toEqual([{ document_count: 1 }]);
      expect(await db.hasPro(user)).toBe(true);
      expect(await db.listWatchlist(user)).toMatchObject([
        { domain, document_alerts: true },
      ]);
      expect(await db.documentAlerts(user)).toMatchObject([
        { scan_id: id, document_count: 1, created_at: expect.any(Date) },
      ]);
      expect(
        (await db.archivedReports(domain, id, false)).map(
          (row) => scanReport.parse(row.report).evidence[0].hash,
        ),
      ).toEqual(["after", "before"]);
      expect(await db.documentAlerts("other")).toEqual([]);
      expect(await db.setDocumentAlerts(user, domain, false)).toBe("updated");
      expect(await db.documentAlerts(user)).toEqual([]);
      expect(await db.enqueue(domain, "watchlist")).toBeNull();
    } finally {
      if (user) await sql`delete from "user" where id = ${user}`;
      await db.close();
      await sql.end();
    }
  },
);

it.skipIf(!url)(
  "stores a score-only alert between confirmed accept-all snapshots",
  async () => {
    const sql = postgres(url!);
    const db = connect(url!);
    const domain = testHost("rating-alerts");
    let watcher = "";
    const firstId = randomUUID();
    const snapshot = (id: string, includesEvent: boolean, partial = false) => {
      const completedAt = new Date().toISOString();
      const url = "https://" + domain + "/";
      const outside = includesEvent ? ["facebook.com"] : [];
      const base = {
        scanId: id,
        retrievedAt: completedAt,
        url,
        kind: "observed_technical",
        consentScenario: "accepted",
      } as const;
      const report: ScanReport = {
        id,
        domain,
        completedAt,
        demo: false,
        partial,
        findings: [],
        consentCoverage: {
          default: "measured",
          accepted: "measured",
          rejected: "untested",
        },
        evidence: [
          {
            ...base,
            id: "browser-consent-accepted",
            excerpt: "A fresh signed-out visit.",
            observation: {
              type: "browser_consent_counts",
              requests: 4,
              cookies: 1,
              externalDomains: outside,
              responseDomains: outside,
              freshContext: true,
              finalPageKnown: true,
              afterChoice: {
                requests: 3,
                externalDomains: outside,
                acceptedAll: true,
              },
              storageSummary: {
                beforeChoice: {
                  cookies: { total: 0, inspected: 0, recognized: [] },
                },
                end: {
                  cookies: {
                    total: 1,
                    inspected: 1,
                    recognized: [
                      {
                        name: "_fbp",
                        scope: "same_site",
                        persistent: true,
                        httpOnly: false,
                        secure: true,
                        sameSite: "Lax",
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      };
      if (includesEvent)
        report.evidence.push({
          ...base,
          id: "browser-network-accepted-1",
          excerpt: "The event endpoint responded.",
          observation: {
            type: "browser_request_fields",
            targetDomain: "facebook.com",
            scheme: "https",
            relation: "cross_site",
            method: "GET",
            phase: "after_choice",
            fieldCategories: ["advertising_id", "event_name"],
            signature: "meta_pixel_event",
            sources: ["query"],
            initiator: "tested_top_level",
            attempts: 1,
            responses: 1,
          },
        });
      Object.assign(report, publishDataPractices(report));
      report.scoring = calculateScore(report);
      report.acceptAllScoring = calculateAcceptAllScore(report);
      return report;
    };
    try {
      await sql`insert into domains(name) values (${domain})`;
      await sql`insert into scans(id,domain,state,requested_at,report) values
        (${firstId},${domain},'completed',now() - interval '2 hours',${JSON.stringify(snapshot(firstId, false))}::text::jsonb)`;
      await resetTestQueue(sql);
      watcher = await insertTestUser(sql, "rating-alert-watcher");
      await activatePro(db, watcher);
      expect(await db.saveWatchlistDomain(watcher, domain)).toBe("saved");
      expect(await db.setDocumentAlerts(watcher, domain, true)).toBe("updated");
      const second = await db.enqueue(domain);
      const job = await db.claim();
      expect(job?.id).toBe(second);
      await db.finish(job!.id, job!.owner, snapshot(job!.id, true));
      expect(
        await sql`select document_count, score_before, score_after from alerts where scan_id = ${second}`,
      ).toEqual([{ document_count: 0, score_before: 74, score_after: 70 }]);
      expect(await db.documentAlerts(watcher)).toMatchObject([
        { scan_id: second, score_before: 74, score_after: 70 },
      ]);
      // Repeat reads over the same old notification, as happens when its
      // cached numbers predate accepted-only scoring or a scan correction.
      for (const reason of [
        "unknown revision",
        "different revision",
        "methodology",
        "baseline",
        "default only",
        "corrected score",
      ]) {
        const old = snapshot(firstId, false);
        const rating = old.acceptAllScoring!;
        if (reason === "unknown revision") delete rating.rulesRevision;
        if (reason === "different revision")
          rating.rulesRevision = "historical-1";
        if (reason === "methodology") rating.methodologyVersion = "historical";
        if (reason === "baseline") rating.baseScore = 52;
        if (reason === "default only") {
          old.scoring = rating;
          delete old.acceptAllScoring;
          old.evidence = [];
        }
        if (reason === "corrected score") {
          old.scoringCorrection = {
            result: old.scoring!,
            accepted: { ...rating, score: 73 },
            reason: "A historical score was corrected.",
            correctedAt: old.completedAt,
          };
        }
        await sql`update scans set report=${JSON.stringify(old)}::text::jsonb where id=${firstId}`;
        expect(await db.documentAlerts(watcher), reason).toEqual([]);
      }
      await sql`update alerts set document_count=1 where scan_id=${second}`;
      expect(await db.documentAlerts(watcher)).toMatchObject([
        {
          scan_id: second,
          document_count: 1,
          score_before: null,
          score_after: null,
        },
      ]);
      await sql`update scans set requested_at = now() - interval '90 minutes' where id = ${second}`;
      const third = await db.enqueue(domain);
      const incomplete = await db.claim();
      expect(incomplete?.id).toBe(third);
      await db.finish(
        incomplete!.id,
        incomplete!.owner,
        snapshot(incomplete!.id, true, true),
      );
      expect(
        await sql`select scan_id from alerts where scan_id = ${third}`,
      ).toEqual([]);
      await sql`update scans set requested_at = now() - interval '70 minutes' where id = ${third}`;
      const fourth = await db.enqueue(domain);
      const complete = await db.claim();
      expect(complete?.id).toBe(fourth);
      await db.finish(
        complete!.id,
        complete!.owner,
        snapshot(complete!.id, false),
      );
      expect(
        await sql`select scan_id from alerts where scan_id=${fourth}`,
      ).toEqual([]);
      // An older useful alert remains visible even behind a full page of
      // unverified legacy notifications with identical creation times.
      await sql`with inserted as (
        insert into scans(id,domain,state,report)
        select gen_random_uuid(), ${domain}, 'partially_completed', '{"demo":false}'::jsonb
        from generate_series(1,51) returning id
      ) insert into alerts(scan_id,domain,document_count,score_before,score_after)
        select id,${domain},0,45,50 from inserted`;
      expect(await db.documentAlerts(watcher)).toMatchObject([
        {
          scan_id: second,
          document_count: 1,
          score_before: null,
          score_after: null,
        },
      ]);
    } finally {
      if (watcher) await sql`delete from "user" where id = ${watcher}`;
      await db.close();
      await sql.end();
    }
  },
);
