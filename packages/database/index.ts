import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type TransactionSql } from "postgres";
import {
  domain,
  privacyPreference,
  policySummaryAddendum,
  scanReport,
  scanStage,
  type ScanStage,
  type PrivacyPreference,
} from "@datadeal/contracts";
import {
  acceptAllScoreChange,
  calculateScore,
  contextualRulesRevision,
  calculateAcceptAllScore,
  calculateRejectScore,
  evaluateHeadline,
} from "@datadeal/scoring";
import { apiTokenStorage } from "./api-tokens";
import { creemCreditStorage } from "./creem-credit-storage";
import { proCheckoutStorage } from "./pro-checkouts";
export { creemCreditsClient, CreemCreditError } from "./creem-credit-client";
import { nativeUsageStorage } from "./native-usage";
import {
  apiCreditStorage,
  applyApiCreditCharge,
  hasBillableScanEvidence,
  refundFailedApiScan,
  type ApiCreditCharge,
} from "./api-credits";
import * as schema from "./schema";
export { applyReportPoints } from "./report-points";
import { paperPlaneStorage } from "./paper-plane";
import { postgresScanArtifacts } from "./scan-artifacts";
import { scanRewardStorage } from "./scan-rewards";
import { pointRefreshStorage, refundPointRefresh } from "./point-refresh";
import { watchlistAlerts } from "./watchlist-alerts";

export type { ApiTokenRecord } from "./api-tokens";
export type { ScanStage } from "@datadeal/contracts";
export type {
  ScanRewardHolder,
  VerifiedScanRewardReceipt,
} from "./scan-rewards";

class ScanRequestLimitReached extends Error {
  constructor(readonly window: "hour" | "day") {
    super("Scan request limit reached");
  }
}

async function debitScanRequest(
  tx: TransactionSql,
  client: string | null,
  daily: string | null,
) {
  const buckets = [
    ...(daily ? [{ key: daily, maximum: 5, window: "day" as const }] : []),
    ...(client ? [{ key: client, maximum: 10, window: "hour" as const }] : []),
    { key: "global", maximum: 120, window: "hour" as const },
  ];
  for (const { key, maximum, window } of buckets) {
    const [allowed] = await tx`
            insert into scan_request_limits(bucket, hour, hits) values(${key}, date_trunc(${window}, now(), 'UTC'), 1)
            on conflict (bucket) do update
            set hour = excluded.hour,
                hits = case when scan_request_limits.hour = excluded.hour then scan_request_limits.hits + 1 else 1 end
            where scan_request_limits.hour < excluded.hour or
              (scan_request_limits.hour = excluded.hour and scan_request_limits.hits < ${maximum})
            returning hits`;
    if (!allowed) throw new ScanRequestLimitReached(window);
  }
}

const shared = globalThis as typeof globalThis & {
  datadealDevelopmentPool?: ReturnType<typeof postgres>;
};

export function connect(url: string, { reusePool = false } = {}) {
  const sql = reusePool
    ? (shared.datadealDevelopmentPool ??= postgres(url, { max: 5 }))
    : postgres(url, { max: 5 });
  const db = drizzle(sql, { schema });
  // Both directions of the provider graph use the same recorded visits. A
  // sampled page must match its selection and consent outcome in this scan.
  function measuredGraphVisit() {
    return sql`
      source->'observation'->'finalPageKnown' is distinct from 'false'::jsonb
      and (
        (source->'observation'->>'type' = 'browser_consent_counts'
          and (latest.report->'consentCoverage' is null or
            latest.report->'consentCoverage'->>(source->>'consentScenario') = 'measured'))
        or (source->'observation'->>'type' = 'browser_content_page'
          and source->'observation'->'requests' > '0'::jsonb
          and exists (
            select 1 from jsonb_array_elements(latest.report->'pageSample'->'pages')
              with ordinality as sampled(page, ordinal)
            where source->>'id' = concat('browser-page-', ordinal, '-', source->>'consentScenario')
              and page->'coverage'->>(source->>'consentScenario') = 'measured'
              and split_part(page->>'url', '/', 1) = 'https:'
              and split_part(source->>'url', '/', 1) = 'https:'
              and (split_part(page->>'url', '/', 3) = latest.domain or
                (latest.domain not like 'www.%' and split_part(page->>'url', '/', 3) = 'www.' || latest.domain))
              and split_part(source->>'url', '/', 3) = split_part(page->>'url', '/', 3)
          ))
      )`;
  }
  async function enqueueScan(
    tx: TransactionSql,
    input: string,
    source: "manual" | "watchlist",
    priorityUserId?: string,
    admission?: {
      client: string | null;
      daily: string | null;
      reuseExisting?: boolean;
    },
  ) {
    const host = domain.parse(input);
    await tx`insert into domains(name) values(${host}) on conflict do nothing`;
    await tx`select name from domains where name = ${host} for update`;
    if (source === "watchlist") {
      const [watcher] =
        await tx`select 1 from watchlists w where w.domain = ${host} and w.document_alerts
            and exists (select 1 from subscriptions s where s.user_id = w.user_id
              and s.access_until > now() and s.status in ('active','canceled','past_due')) limit 1`;
      if (!watcher) return { code: "watchlist_disabled" } as const;
    }
    const cooldownHours = source === "watchlist" ? 168 : 1;
    const [existing] = await tx<
      { id: string; state: string; retryAfter: number }[]
    >`select id, state, greatest(1, ceil(extract(epoch from requested_at + interval '1 hour' - now())))::int as "retryAfter" from scans where domain = ${host}
          and (state in ('queued', 'fetching') or requested_at > now() - make_interval(hours => ${cooldownHours}))
          order by (state in ('queued', 'fetching')) desc, requested_at desc limit 1`;
    if (
      existing &&
      admission?.reuseExisting === false &&
      (existing.state === "queued" || existing.state === "fetching")
    )
      return { code: "scan_in_progress", id: existing.id } as const;
    if (existing)
      return admission &&
        existing.state !== "queued" &&
        existing.state !== "fetching"
        ? ({
            code: "domain_cooldown",
            retryAfter: existing.retryAfter,
          } as const)
        : ({ code: "accepted", id: existing.id } as const);
    await tx`select pg_advisory_xact_lock(480053)`;
    const [capacity] = await tx`select count(*)::int as count from scan_jobs`;
    if (Number(capacity.count) >= 50) return { code: "queue_full" } as const;
    if (admission)
      await debitScanRequest(tx, admission.client, admission.daily);
    let priority = false;
    if (source === "manual" && priorityUserId) {
      const [eligible] = await tx`select 1
            where exists (select 1 from subscriptions where user_id = ${priorityUserId}
              and access_until > now() and status in ('active','canceled','past_due'))
            and exists (select 1 from scans where domain = ${host}
              and state in ('completed', 'partially_completed') and report->'demo' = 'false'::jsonb)`;
      if (eligible) {
        const bucket =
          "pro:" + createHash("sha256").update(priorityUserId).digest("hex");
        const [credit] = await tx`
              insert into scan_request_limits(bucket, hour, hits) values(${bucket}, date_trunc('hour', now()), 1)
              on conflict (bucket) do update
                set hour = excluded.hour,
                    hits = case when scan_request_limits.hour = excluded.hour then scan_request_limits.hits + 1 else 1 end
              where scan_request_limits.hour < excluded.hour or
                (scan_request_limits.hour = excluded.hour and scan_request_limits.hits < 3)
              returning hits`;
        priority = Boolean(credit);
      }
    }
    const id = randomUUID();
    await tx`insert into scans(id, domain, state) values(${id}, ${host}, 'queued')`;
    await tx`insert into scan_jobs(scan_id, priority) values(${id}, ${priority})`;
    return { code: "accepted", id } as const;
  }
  const refreshWithPoints = pointRefreshStorage(
    sql,
    (tx, host, userId, client, daily) =>
      enqueueScan(tx, host, "manual", userId, {
        client,
        daily,
        reuseExisting: false,
      }),
  );
  const proCheckouts = proCheckoutStorage(sql);

  return {
    async requestPointRefresh(...args: Parameters<typeof refreshWithPoints>) {
      try {
        return await refreshWithPoints(...args);
      } catch (error) {
        if (error instanceof ScanRequestLimitReached)
          return {
            code: error.window === "day" ? "daily_limit" : "hourly_limit",
          } as const;
        throw error;
      }
    },
    ...apiTokenStorage(sql),
    ...creemCreditStorage(sql),
    ...proCheckouts,
    ...nativeUsageStorage(sql, async (tx, host, userId) => {
      const daily =
        "daily:account:" + createHash("sha256").update(userId).digest("hex");
      try {
        const result = await tx.savepoint((sp) =>
          enqueueScan(sp, host, "manual", undefined, {
            client: null,
            daily,
            reuseExisting: false,
          }),
        );
        if (result.code === "watchlist_disabled")
          throw new Error("Unexpected watchlist decision");
        return result;
      } catch (error) {
        if (error instanceof ScanRequestLimitReached)
          return {
            code: error.window === "day" ? "daily_limit" : "hourly_limit",
          } as const;
        throw error;
      }
    }),
    ...apiCreditStorage(sql),
    async apiScanStatus(userId: string, id: string) {
      const [scan] = await sql<
        {
          id: string;
          domain: string;
          state: string;
          requestedAt: Date;
          creditsCharged: number;
          creditsRefunded: number;
          reportPublished: boolean;
        }[]
      >`
        select s.id, s.domain, s.state, s.requested_at as "requestedAt",
          -entry.delta as "creditsCharged", coalesce(refund.delta, 0) as "creditsRefunded",
          (s.report is not null and s.report->>'demo' = 'false') as "reportPublished"
        from api_credit_entries entry
        join scans s on s.id = entry.scan_id
        left join api_credit_entries refund
          on refund.scan_id = s.id and refund.kind = 'scan_refund' and refund.user_id = entry.user_id
        where entry.user_id = ${userId} and entry.scan_id = ${id} and entry.kind = 'usage'
        union all
        select s.id,s.domain,s.state,s.requested_at,op.amount,
          case when op.refunded_at is null then 0 else op.amount end,
          (s.report is not null and s.report->>'demo' = 'false')
        from creem_api_operations op join scans s on s.id=op.scan_id
        where op.user_id=${userId} and op.scan_id=${id}`;
      return scan ?? null;
    },
    async requestApiScan(
      input: string,
      userId: string,
      charge: ApiCreditCharge,
    ) {
      const daily =
        "daily:account:" + createHash("sha256").update(userId).digest("hex");
      try {
        return await sql.begin((tx) =>
          applyApiCreditCharge(tx, userId, charge, async () => {
            const result = await enqueueScan(tx, input, "manual", undefined, {
              client: null,
              daily,
              reuseExisting: false,
            });
            return result.code === "accepted"
              ? { response: { id: result.id }, scanId: result.id }
              : { rejected: result };
          }),
        );
      } catch (error) {
        if (error instanceof ScanRequestLimitReached)
          return { code: "scan_limit", window: error.window } as const;
        throw error;
      }
    },
    ...scanRewardStorage(sql),
    ...paperPlaneStorage(sql),
    close: () => sql.end(),
    async privacyProfile(userId: string) {
      const [row] =
        await sql`select preference from privacy_profiles where user_id = ${userId}`;
      return row ? privacyPreference.parse(row.preference) : null;
    },
    async setPrivacyProfile(userId: string, preference: PrivacyPreference) {
      const [row] = await sql`insert into privacy_profiles(user_id, preference)
        select ${userId}, ${preference} where exists (
          select 1 from subscriptions where user_id = ${userId}
          and access_until > now() and status in ('active','canceled','past_due')
        )
        on conflict (user_id) do update set preference = excluded.preference
        returning user_id`;
      return Boolean(row);
    },
    getScanArtifact: postgresScanArtifacts(sql).get,
    async checkScanStorage() {
      // Validate schema and read access without reading any stored user data.
      await sql`
        select
          (select report from scans limit 0),
          (select row(priority, stages) from scan_jobs limit 0),
          (select result from scan_analyses limit 0),
          (select row(version,sha256,expires_at) from scan_artifacts limit 0),
          (select hits from scan_request_limits limit 0),
          (select billing_closing from "user" limit 0),
          (select "userId" from session limit 0),
          (select "userId" from account limit 0),
          (select "expiresAt" from verification limit 0),
          (select "lastRequest" from "rateLimit" limit 0),
          (select access_until from subscriptions limit 0),
          (select document_alerts from watchlists limit 0),
          (select score_after from alerts limit 0),
          (select preference from privacy_profiles limit 0),
          (select receipt_hash from scan_reward_receipts limit 0),
          (select row(expires_at,account_claim_available) from scan_reward_grants limit 0),
          (select row(scan_id,cost) from report_point_refreshes limit 0),
          (select request_count from api_tokens limit 0),
          (select scan_id from api_credit_entries limit 0),
          (select request_id from creem_credit_checkout_requests limit 0),
          (select row(request_id,subscription_id,checkout_id) from pro_checkout_requests limit 0),
          (select row(claim_until, meter_warning_codes, reversal_id) from creem_api_operations limit 0),
          (select product_id from creem_sandbox_credit_products limit 0)
      `;
    },
    documentAlerts: (userId: string) => watchlistAlerts(sql, userId),
    async setDocumentAlerts(userId: string, input: string, enabled: boolean) {
      const [row] = await sql`update watchlists set document_alerts = ${enabled}
        where user_id = ${userId} and domain = ${domain.parse(input)} returning domain`;
      return Boolean(row);
    },
    async listWatchlist(userId: string) {
      return sql<
        { domain: string; created_at: Date; document_alerts: boolean }[]
      >`
        select domain, created_at, document_alerts from watchlists where user_id = ${userId}
        order by created_at desc, domain`;
    },
    async saveWatchlistDomain(userId: string, input: string) {
      const host = domain.parse(input);
      return sql.begin(async (tx) => {
        const [user] =
          await tx`select id from "user" where id = ${userId} for update`;
        if (!user) return "forbidden";
        const [pro] =
          await tx`select 1 from subscriptions where user_id = ${userId}
          and access_until > now() and status in ('active','canceled','past_due') limit 1`;
        if (!pro) return "forbidden";
        const [existing] =
          await tx`select 1 from watchlists where user_id = ${userId} and domain = ${host}`;
        if (existing) return "saved";
        const [capacity] =
          await tx`select count(*)::int as count from watchlists where user_id = ${userId}`;
        if (Number(capacity.count) >= 100) return "full";
        await tx`insert into watchlists(user_id, domain) values(${userId}, ${host})`;
        return "saved";
      });
    },
    async removeWatchlistDomain(userId: string, input: string) {
      await sql`delete from watchlists where user_id = ${userId} and domain = ${domain.parse(input)}`;
    },
    async prepareBillingClosure(
      userId: string,
      cancel: (subscription: string, customer: string) => Promise<void>,
    ) {
      await sql.begin(async (tx) => {
        const [owner] =
          await tx`select billing_closing from "user" where id = ${userId} for update`;
        if (!owner || owner.billing_closing) return;
        const rows = await tx<{ id: string; customer_id: string }[]>`
          select id, customer_id from subscriptions where user_id = ${userId}
          and status <> 'canceled' order by id`;
        for (const row of rows) await cancel(row.id, row.customer_id);
        // The auth adapter deletes the user after this transaction commits.
        // A paid webhook in that gap must also stop the provider subscription.
        await tx`update "user" set billing_closing = true where id = ${userId}`;
      });
    },
    async billingCustomer(userId: string) {
      return (await proCheckouts.billingSummary(userId))?.customer_id ?? null;
    },
    async hasPro(userId: string) {
      const [sub] =
        await sql`select 1 from subscriptions where user_id = ${userId}
        and access_until > now() and status in ('active','canceled','past_due') limit 1`;
      return Boolean(sub);
    },
    async applyBillingEvent(event: {
      id: string;
      time: number;
      subscription: string;
      customer: string;
      product: string;
      userId?: string;
      existingProductOnly?: boolean;
      status: string;
      accessUntil?: string;
    }) {
      return sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${event.subscription}))`;
        const [current] =
          await tx`select event_time, customer_id, product_id, user_id from subscriptions where id = ${event.subscription}`;
        if (
          event.existingProductOnly &&
          (!current ||
            current.product_id !== event.product ||
            current.customer_id !== event.customer)
        )
          return;
        if (current && current.customer_id !== event.customer) return;
        const ownerId = current?.user_id ?? event.userId;
        if (ownerId) {
          const [owner] =
            await tx`select billing_closing from "user" where id = ${ownerId} for share`;
          if (!owner || owner.billing_closing) {
            if (event.status === "active")
              return "cancel_subscription" as const;
            return;
          }
        }
        const [inserted] =
          await tx`insert into billing_events(id) values(${event.id})
          on conflict do nothing returning id`;
        if (!inserted) return;
        if (current) {
          if (event.time <= Number(current.event_time)) return;
          await tx`update subscriptions set product_id = ${event.product}, status = ${event.status},
            access_until = case when ${event.status} = 'active'
              then coalesce(${event.accessUntil ?? null}::timestamptz, access_until)
              else least(access_until, ${event.accessUntil ?? null}::timestamptz) end,
            event_time = ${event.time} where id = ${event.subscription}`;
        } else if (
          event.userId &&
          event.status === "active" &&
          event.accessUntil
        ) {
          await tx`insert into subscriptions(id, user_id, customer_id, product_id, status, access_until, event_time)
            select ${event.subscription}, id, ${event.customer}, ${event.product}, ${event.status}, ${event.accessUntil}, ${event.time}
            from "user" where id = ${event.userId}`;
        } else {
          throw new Error("Subscription has not been provisioned");
        }
      });
    },
    async archivedReports(input: string, scanId: string, includeDemo: boolean) {
      const host = domain.parse(input);
      return sql<{ report: unknown }[]>`
        select s.report from scans s join scans target on target.id = ${scanId} and target.domain = ${host}
        where s.domain = target.domain and s.report is not null
          and target.report is not null and (${includeDemo} or target.report->>'demo' = 'false')
          and (${includeDemo} or s.report->>'demo' = 'false')
          and target.state in ('completed','partially_completed') and s.state in ('completed','partially_completed')
          and (s.requested_at,s.id) <= (target.requested_at,target.id)
        order by s.requested_at desc,s.id desc limit 2`;
    },
    async publishedFavicon(host: string) {
      const [row] = await sql<{ favicon: string }[]>`
        select report->>'favicon' as favicon from scans
        where domain = ${host}
          and state in ('completed', 'partially_completed')
          and report->'demo' = 'false'::jsonb
          and jsonb_typeof(report->'favicon') = 'string'
        order by requested_at desc, id desc
        limit 1`;
      return row?.favicon;
    },
    async list(input: string) {
      return db
        .select()
        .from(schema.scans)
        .where(eq(schema.scans.domain, domain.parse(input)))
        .orderBy(desc(schema.scans.requestedAt), desc(schema.scans.id))
        .limit(20);
    },
    async olderPublishedReports(host: string, beforeId: string) {
      return sql<{ id: string; state: string; report: unknown }[]>`
        select s.id, s.state, s.report from scans s
        join scans cursor on cursor.id = ${beforeId} and cursor.domain = s.domain
        where s.domain = ${host}
          and (s.requested_at, s.id) < (cursor.requested_at, cursor.id)
          and s.state in ('completed', 'partially_completed')
          and s.report is not null
        order by s.requested_at desc, s.id desc
        limit 20`;
    },
    async recentPublishedDomains() {
      const rows = await sql<
        { domain: string; scanId: string; snapshot: unknown }[]
      >`
        select domain, id as "scanId", report as snapshot from (
          select distinct on (domain) domain, id, requested_at, report
          from scans where requested_at >= now() - interval '7 days'
            and report->'demo' = 'false'::jsonb
            and state in ('completed', 'partially_completed')
          order by domain, requested_at desc, id desc
        ) latest order by requested_at desc, domain limit 20`;
      return rows.flatMap(({ snapshot, ...row }) => {
        const parsed = scanReport.safeParse(snapshot);
        if (!parsed.success) return [];
        const { rating, scenario } = evaluateHeadline(parsed.data);
        return [
          {
            ...row,
            score: rating.score,
            grade: rating.grade,
            headlineScenario: scenario,
            ...(rating.noChoiceEvidence && { noChoiceVisit: true }),
            hasFavicon: Boolean(parsed.data.favicon),
          },
        ];
      });
    },
    async observedProviderReferences(input: string) {
      const provider = domain.parse(input);
      return sql<
        {
          domain: string;
          scanId: string;
          evidenceId: string;
          responded: boolean;
        }[]
      >`
        with latest as (
          select distinct on (domain) id, domain, report, requested_at
          from scans
          where requested_at >= now() - interval '7 days'
            and state in ('completed', 'partially_completed')
            and report->'demo' = 'false'::jsonb
            and domain <> ${provider}
          order by domain, requested_at desc, id desc
        )
        select latest.domain, latest.id as "scanId", matching.id as "evidenceId", matching.responded
        from latest cross join lateral (
          select source->>'id' as id,
            coalesce(source->'observation'->'responseDomains' @> jsonb_build_array(${provider}::text), false) as responded
          from jsonb_array_elements(latest.report->'evidence') as source
          where source->>'scanId' = latest.id::text
            and source->>'kind' = 'observed_technical'
            and ${measuredGraphVisit()}
            and source->'observation'->'externalDomains' @> jsonb_build_array(${provider}::text)
          order by (source->>'consentScenario' = 'default') desc nulls last,
            (source->'observation'->>'type' = 'browser_consent_counts') desc, source->>'id'
          limit 1
        ) matching
        order by latest.requested_at desc, latest.domain
        limit 12`;
    },
    async topObservedProviders() {
      return sql<{ provider: string; sites: number }[]>`
        with latest as (
          select distinct on (domain) id, domain, report
          from scans
          where requested_at >= now() - interval '7 days'
            and state in ('completed', 'partially_completed')
            and report->'demo' = 'false'::jsonb
          order by domain, requested_at desc, id desc
        )
        select destination as provider, count(distinct latest.domain)::int as sites
        from latest
        cross join lateral jsonb_array_elements(latest.report->'evidence') as source
        cross join lateral jsonb_array_elements_text(
          case when source->'observation'->>'type' in ('browser_consent_counts','browser_content_page')
            then source->'observation'->'externalDomains' else '[]'::jsonb end
        ) as destination
        where source->>'scanId' = latest.id::text
          and source->>'kind' = 'observed_technical'
          and ${measuredGraphVisit()}
          and destination <> latest.domain
        group by destination
        order by sites desc, destination
        limit 12`;
    },
    async pruneExpiredPrivateData() {
      const [counts] = await sql<
        {
          sessions: number;
          verifications: number;
          authLimits: number;
          scanLimits: number;
          scanRewards: number;
        }[]
      >`
        with expired_sessions as (
          delete from session where id in (
            select id from session where "expiresAt" <= now()
            order by "expiresAt" limit 500 for update skip locked
          ) returning id
        ),
        expired_verifications as (
          delete from verification where id in (
            select id from verification where "expiresAt" <= now()
            order by "expiresAt" limit 500 for update skip locked
          ) returning id
        ),
        expired_auth_limits as (
          delete from "rateLimit" where id in (
            select id from "rateLimit"
            where "lastRequest" < extract(epoch from now() - interval '24 hours') * 1000
            order by "lastRequest" limit 500 for update skip locked
          ) returning id
        ),
        expired_scan_limits as (
          delete from scan_request_limits where bucket in (
            select bucket from scan_request_limits
            where hour < case when bucket like 'daily:%'
              then date_trunc('day', now(), 'UTC') - interval '1 day'
              else date_trunc('hour', now()) - interval '1 hour' end
            order by hour limit 500 for update skip locked
          ) returning bucket
        ),
        expired_scan_rewards as (
          delete from scan_reward_grants where id in (
            select id from scan_reward_grants where expires_at <= now()
            order by expires_at limit 500 for update skip locked
          ) returning id
        )
        select (select count(*) from expired_sessions)::int as sessions,
          (select count(*) from expired_verifications)::int as verifications,
          (select count(*) from expired_auth_limits)::int as "authLimits",
          (select count(*) from expired_scan_limits)::int as "scanLimits",
          (select count(*) from expired_scan_rewards)::int as "scanRewards"`;
      return {
        ...counts,
        scanArtifacts: await postgresScanArtifacts(sql).pruneExpired(),
      };
    },
    async scanRequestAdmission(
      client: string | null,
      daily: string | null = null,
    ) {
      return sql
        .begin(async (tx) => {
          await debitScanRequest(tx, client, daily);
          return "allowed" as const;
        })
        .catch((error: unknown) => {
          if (error instanceof ScanRequestLimitReached) return error.window;
          throw error;
        });
    },
    async dueWatchlistDomains() {
      const rows = await sql<{ domain: string }[]>`
        select w.domain
        from watchlists w
        where w.document_alerts
          and exists (select 1 from subscriptions s where s.user_id = w.user_id
            and s.access_until > now() and s.status in ('active','canceled','past_due'))
          and not exists (select 1 from scans s where s.domain = w.domain
            and (s.state in ('queued','fetching') or s.requested_at > now() - interval '7 days'))
        group by w.domain
        order by min(w.created_at), w.domain
        limit 3`;
      return rows.map((row) => row.domain);
    },
    async enqueue(
      input: string,
      source: "manual" | "watchlist" = "manual",
      priorityUserId?: string,
    ) {
      const result = await sql.begin((tx) =>
        enqueueScan(tx, input, source, priorityUserId),
      );
      return result.code === "accepted" ? result.id : null;
    },
    async requestScan(
      input: string,
      client: string | null,
      daily: string | null,
      priorityUserId?: string,
    ) {
      try {
        return await sql.begin((tx) =>
          enqueueScan(tx, input, "manual", priorityUserId, {
            client,
            daily,
          }),
        );
      } catch (error) {
        if (error instanceof ScanRequestLimitReached)
          return {
            code: error.window === "day" ? "daily_limit" : "hourly_limit",
          } as const;
        throw error;
      }
    },
    async claim() {
      const owner = randomUUID();
      return sql.begin(async (tx) => {
        const [row] = await tx<
          { id: string; domain: string; attempts: number }[]
        >`
          select s.id, s.domain, j.attempts from scan_jobs j join scans s on s.id = j.scan_id
          where j.lease_until is null or j.lease_until < now()
          order by case
            when s.requested_at <= now() - interval '10 minutes' then 0
            when j.priority then 1
            when exists (
              select 1 from scans published where published.domain = s.domain
                and published.state in ('completed', 'partially_completed')
                and published.report->'demo' = 'false'::jsonb
            ) then 3
            else 2
          end, s.requested_at, s.id
          limit 1 for update of j skip locked`;
        if (!row) return null;
        if (row.attempts >= 3) {
          await tx`update scans set state = 'failed' where id = ${row.id}`;
          await tx`delete from scan_jobs where scan_id = ${row.id}`;
          await refundFailedApiScan(tx, row.id);
          await refundPointRefresh(tx, row.id);
          return null;
        }
        await tx`update scan_jobs set lease_until = now() + interval '60 seconds',
          owner = ${owner}, attempts = attempts + 1, stages = array['homepage'] where scan_id = ${row.id}`;
        await tx`update scans set state = 'fetching' where id = ${row.id}`;
        return { ...row, owner, attempts: row.attempts + 1 };
      });
    },
    async retryScan(id: string, owner: string) {
      return sql.begin(async (tx) => {
        const [job] = await tx`update scan_jobs set owner = null, stages = '{}',
          lease_until = now() + case when attempts = 1 then interval '30 seconds' else interval '2 minutes' end
          where scan_id = ${id} and owner = ${owner} and lease_until > now() and attempts < 3
          returning scan_id`;
        if (!job) return false;
        await tx`update scans set state = 'queued' where id = ${id}`;
        return true;
      });
    },
    async activeScanStages(id: string) {
      const [job] = await sql`select stages from scan_jobs where scan_id = ${id}
        and owner is not null and lease_until > now()`;
      return scanStage.array().parse(job?.stages ?? []);
    },
    async renewScanLease(id: string, owner: string, stage?: ScanStage) {
      const [job] =
        await sql`update scan_jobs set lease_until = now() + interval '60 seconds',
          stages = case when ${stage ?? null}::text is null or ${stage ?? null}::text = any(stages)
            then stages else array_append(stages, ${stage ?? null}::text) end
        where scan_id = ${id} and owner = ${owner} and lease_until > now()
        returning scan_id`;
      return Boolean(job);
    },
    async cachedAnalysis(hash: string): Promise<unknown> {
      const [row] =
        await sql`select a.result from scan_analyses a join scans s on s.id = a.scan_id
          where a.input_hash = ${hash} order by s.requested_at desc, a.scan_id desc limit 1`;
      return row?.result;
    },
    async policyReviewSource(id: string, host: string) {
      const [row] =
        await sql`select s.report, a.result from scans s join scan_analyses a on a.scan_id = s.id
        where s.id = ${id} and s.domain = ${domain.parse(host)}
        and s.state in ('completed','partially_completed') and s.report->'demo' = 'false'::jsonb`;
      if (!row)
        throw new Error("Published report with a saved analysis required.");
      return {
        report: scanReport.parse(row.report),
        output: row.result.output as unknown,
      };
    },
    async savePolicySummaryAddendum(id: string, host: string, input: unknown) {
      const addendum = policySummaryAddendum.parse(input);
      const name = domain.parse(host);
      return sql.begin(async (tx) => {
        const [row] =
          await tx`select report from scans where id=${id} and domain=${name}
          and state in ('completed','partially_completed') and report->'demo' = 'false'::jsonb for update`;
        if (!row) throw new Error("Published report required.");
        const report = scanReport.parse(row.report);
        if (report.id !== id || report.domain !== name)
          throw new Error("Report identity mismatch.");
        if (report.policySummaryAddendum) return "already reviewed" as const;
        if (report.policyBrief?.length || report.policyClaims?.length)
          throw new Error("This report already has published policy analysis.");
        for (const item of addendum.items) {
          const source = report.evidence.find(
            (e) => e.id === item.source && e.scanId === id,
          );
          if (
            source?.kind !== "declared_first_party" ||
            source.observation?.type !== "policy_section" ||
            source.observation.vendorListing ||
            source.observation.topic !== item.topic ||
            !source.excerpt.includes(item.quote)
          )
            throw new Error(
              "Summary citation does not match this scan's policy section.",
            );
        }
        await tx`update scans set report=jsonb_set(report,'{policySummaryAddendum}',${JSON.stringify(addendum)}::text::jsonb) where id=${id}`;
        return "saved" as const;
      });
    },
    async correctQuietVisitRating(id: string, host: string, apply = false) {
      const name = domain.parse(host);
      return sql.begin(async (tx) => {
        const [row] =
          await tx`select report from scans where id = ${id} and domain = ${name}
          and state = 'completed' and report->'demo' = 'false'::jsonb for update`;
        if (!row) throw new Error("Completed real report not found.");
        const report = scanReport.parse(row.report);
        if (
          report.id !== id ||
          report.domain !== name ||
          report.partial ||
          !report.scoring ||
          report.scoring.rulesRevision !== "contextual-practices-1" ||
          report.scoring.score !== null
        )
          throw new Error("This report is outside the quiet-visit correction.");
        if (report.scoringCorrection)
          return {
            status: "already corrected",
            score: report.scoringCorrection.result.score,
          };
        const result = calculateScore(report);
        const ratings = result.practiceAssessment?.ratings;
        if (
          result.rulesRevision !== contextualRulesRevision ||
          result.score !== 80 ||
          !ratings?.length ||
          !ratings.every(
            (r) =>
              r.score === 80 &&
              report.dataPractices?.some(
                (p) =>
                  p.factId === r.factId && p.operation === "observed_visit",
              ),
          )
        )
          throw new Error(
            "The stored evidence does not qualify for the correction.",
          );
        if (apply) {
          const correction = {
            correctedAt: new Date().toISOString(),
            reason:
              "Equivalent empty observations on the selected pages now receive the same treatment, including pages omitted from individual AI review. The rating covers the measured default visits.",
            result,
          };
          await tx`update scans set report = jsonb_set(report,'{scoringCorrection}',${JSON.stringify(correction)}::text::jsonb)
            where id = ${id} and domain = ${name}`;
        }
        return {
          status: apply ? "corrected" : "eligible",
          score: result.score,
          coverage: result.practiceAssessment?.coverage,
        };
      });
    },
    async correctPolicyCoverage(id: string, host: string, apply = false) {
      const name = domain.parse(host);
      return sql.begin(async (tx) => {
        const [row] =
          await tx`select report from scans where id = ${id} and domain = ${name}
          and state = 'completed' for update`;
        const report = scanReport.parse(row?.report);
        const previous = report.acceptAllScoring;
        if (
          report.id !== id ||
          report.domain !== name ||
          report.demo ||
          report.partial ||
          !previous ||
          previous.rulesRevision !== "contextual-practices-3" ||
          previous.score !== null
        )
          throw new Error(
            "This scan is outside the policy coverage correction.",
          );
        if (report.scoringCorrection) {
          if (
            report.scoringCorrection.accepted?.rulesRevision !==
            contextualRulesRevision
          )
            throw new Error("This scan already has a different correction.");
          return {
            status: "already corrected",
            score: report.scoringCorrection.accepted.score,
          };
        }
        const accepted = calculateAcceptAllScore(report);
        if (
          accepted?.score == null ||
          accepted.rulesRevision !== contextualRulesRevision ||
          !accepted.practiceAssessment?.ratings.length ||
          JSON.stringify(
            accepted.practiceAssessment.ratings.map((r) => [r.factId, r.score]),
          ) !==
            JSON.stringify(
              previous.practiceAssessment?.ratings.map((r) => [
                r.factId,
                r.score,
              ]),
            )
        )
          throw new Error(
            "The stored practice ratings do not support this correction.",
          );
        if (apply) {
          const correction = {
            correctedAt: new Date().toISOString(),
            reason:
              "The original coverage check overlooked a cited structured policy finding outside the short summary. The corrected ratings use the same browser visits and policy sources.",
            result: calculateScore(report),
            rejected: calculateRejectScore(report),
            accepted,
          };
          await tx`update scans set report = jsonb_set(report,'{scoringCorrection}',${JSON.stringify(correction)}::text::jsonb)
            where id = ${id} and domain = ${name}`;
        }
        return {
          status: apply ? "corrected" : "eligible",
          score: accepted.score,
        };
      });
    },
    async reviewUnratedCapture(id: string, host: string, apply = false) {
      const name = domain.parse(host);
      return sql.begin(async (tx) => {
        const [row] = await tx`select id, report from scans where domain=${name}
          and state in ('completed','partially_completed') and report->'demo'='false'::jsonb
          order by requested_at desc, id desc limit 1 for update`;
        if (row?.id !== id)
          throw new Error("Expected the current published scan.");
        const report = scanReport.parse(row.report);
        if (report.id !== id || report.domain !== name)
          throw new Error("Report identity mismatch.");
        const before = evaluateHeadline(report);
        if (
          report.scoringCorrection?.result.rulesRevision ===
          contextualRulesRevision
        )
          return { status: "already reviewed", score: before.rating.score };
        if (
          before.rating.score !== null ||
          !report.dataPractices ||
          report.scoring?.rulesRevision !== "contextual-practices-4" ||
          report.scoringCorrection
        )
          throw new Error(
            "Expected an unrated contextual capture without a previous correction.",
          );
        const correction = {
          correctedAt: new Date().toISOString(),
          reason:
            "The saved browser and policy evidence was reassessed under updated rules for named cookies and visits without an optional consent choice.",
          result: calculateScore(report),
          accepted: calculateAcceptAllScore(report),
          rejected: calculateRejectScore(report),
        };
        const after = evaluateHeadline({
          ...report,
          scoringCorrection: correction,
        });
        const newAssessments = [
          [report.scoring, correction.result],
          [report.acceptAllScoring, correction.accepted],
          [report.rejectedScoring, correction.rejected],
        ].some(
          ([previous, next]) =>
            !isDeepStrictEqual(
              previous?.practiceAssessment?.ratings,
              next?.practiceAssessment?.ratings,
            ),
        );
        if (after.rating.score === null && !newAssessments)
          return { status: "insufficient evidence", score: null };
        if (apply)
          await tx`update scans set report=jsonb_set(report,'{scoringCorrection}',${JSON.stringify(correction)}::text::jsonb) where id=${id}`;
        return {
          status: apply ? "corrected" : "eligible",
          score: after.rating.score,
          scenario: after.scenario,
          rulesRevision: after.rating.rulesRevision,
        };
      });
    },
    async finish(
      id: string,
      owner: string,
      input: unknown,
      analysis?: { hash: string; result: object },
    ) {
      const report = input === null ? null : scanReport.parse(input);
      if (report) {
        if (report.id !== id)
          throw new Error("Report does not belong to this scan");
        delete report.scoringCorrection;
        delete report.policySummaryAddendum;
        if (!report.demo) report.dataPractices ??= [];
        report.scoring = calculateScore(report);
        report.acceptAllScoring = calculateAcceptAllScore(report);
        report.rejectedScoring = calculateRejectScore(report);
      }
      return sql.begin(async (tx) => {
        const [job] =
          await tx`delete from scan_jobs j using scans s where j.scan_id = ${id} and j.owner = ${owner}
          and s.id = j.scan_id and (${report?.domain ?? null}::text is null or s.domain=${report?.domain ?? null})
          and j.lease_until > now() returning j.scan_id`;
        if (!job) return false;
        const state = report
          ? report.partial
            ? "partially_completed"
            : "completed"
          : "failed";
        await tx`update scans set state = ${state}, report = ${report ? JSON.stringify(report) : null}::text::jsonb
          where id = ${id}`;
        if (!report || !hasBillableScanEvidence(report)) {
          await refundFailedApiScan(tx, id);
          await refundPointRefresh(tx, id);
        }
        if (report && !report.demo) {
          await postgresScanArtifacts(tx).put(report);
          const [older] = await tx<
            { id: string; report: unknown }[]
          >`select p.id, p.report from scans p join scans s on s.domain=p.domain
            where s.id = ${id} and p.report->>'demo' = 'false'
              and p.state in ('completed','partially_completed')
              and (p.requested_at,p.id) < (s.requested_at,s.id)
            order by p.requested_at desc, p.id desc limit 1`;
          const previous = scanReport.safeParse(older?.report);
          if (
            previous.success &&
            previous.data.id === older.id &&
            previous.data.domain === report.domain
          ) {
            const prior = previous.data;
            const hashes = new Map(
              prior.evidence.flatMap((item) =>
                item.scanId === prior.id && item.url && item.hash
                  ? [[item.url, item.hash] as const]
                  : [],
              ),
            );
            const changed = new Set(
              report.evidence.flatMap((item) => {
                if (item.scanId !== report.id) return [];
                const oldHash = item.url && hashes.get(item.url);
                return item.url && item.hash && oldHash && item.hash !== oldHash
                  ? [item.url]
                  : [];
              }),
            );
            const scoreChanged = acceptAllScoreChange(prior, report);
            if (changed.size || scoreChanged)
              await tx`insert into alerts(scan_id, domain, document_count, score_before, score_after)
              values(${id}, ${report.domain}, ${changed.size}, ${scoreChanged?.before ?? null}, ${scoreChanged?.after ?? null})`;
          }
        }
        if (report && analysis) {
          await tx`insert into scan_analyses(scan_id, input_hash, result)
            values(${id}, ${analysis.hash}, ${JSON.stringify(analysis.result)}::jsonb)`;
        }
        return true;
      });
    },
  };
}
export type { PaperReward } from "./paper-plane";
