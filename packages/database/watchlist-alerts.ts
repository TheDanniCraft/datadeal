import { scanReport } from "@datadeal/contracts";
import { acceptAllScoreChange } from "@datadeal/scoring";
import type { Sql } from "postgres";

type Alert = {
  scan_id: string;
  domain: string;
  created_at: Date;
  document_count: number;
  score_before: number | null;
  score_after: number | null;
};

/**
 * What the latest scans of a watcher's sites found, newest first. Covers Pro
 * watches (saved sites with alerts) and points watches, from when each started.
 */
export async function watchlistAlerts(
  sql: Sql,
  userId: string,
  domainFilter?: string,
) {
  // Older alerts only saved two numbers. Recheck both adjacent publications,
  // including corrections, before exposing a score change on the account or API.
  function snapshot(alias: "s" | "p") {
    const report = sql(alias + ".report");
    return sql`case when a.score_before is not null and
      ${report}->>'id' = ${sql(alias + ".id")}::text and ${report}->>'domain' = a.domain
      then jsonb_build_object(
        'id', ${report}->'id', 'domain', ${report}->'domain',
        'completedAt', ${report}->'completedAt', 'partial', ${report}->'partial', 'demo', ${report}->'demo',
        'consentCoverage', ${report}->'consentCoverage', 'findings', '[]'::jsonb,
        'evidence', jsonb_path_query_array(${report}, '$.evidence[*] ? (@.consentScenario == "accepted" && @.kind == "observed_technical" && @.observation.type == "browser_consent_counts")'),
        'acceptAllScoring', coalesce(${report}#>'{scoringCorrection,accepted}', ${report}->'acceptAllScoring')
      ) end`;
  }
  const alerts: Alert[] = [];
  let cursor: { date: string; id: string } | undefined;
  do {
    const rows: (Alert & {
      cursor_date: string;
      previous: unknown;
      current: unknown;
    })[] = await sql`
      with watched as (
        select w.domain, w.created_at from watchlists w
        where w.user_id=${userId} and w.document_alerts
          and exists (select 1 from subscriptions sub where sub.user_id=${userId}
            and sub.access_until > now() and sub.status in ('active','canceled','past_due'))
        union all
        select m.domain, m.created_at from site_monitors m where m.user_id=${userId}
      ), candidates as materialized (
        select a.* from alerts a
        where exists (select 1 from watched w where w.domain=a.domain and a.created_at >= w.created_at)
          ${domainFilter ? sql`and a.domain=${domainFilter}` : sql``}
          ${cursor ? sql`and (a.created_at,a.scan_id) < (${cursor.date}::timestamptz,${cursor.id}::uuid)` : sql``}
        order by a.created_at desc, a.scan_id desc limit 50
      )
      select a.*, a.created_at::text as cursor_date, ${snapshot("p")} as previous, ${snapshot("s")} as current
      from candidates a
      join scans s on s.id=a.scan_id and s.domain=a.domain
      left join lateral (
        select p.id,p.report from scans p
        where a.score_before is not null and p.domain=s.domain and p.report->>'demo'='false'
          and p.state in ('completed','partially_completed')
          and (p.requested_at,p.id) < (s.requested_at,s.id)
        order by p.requested_at desc,p.id desc limit 1
      ) p on true
      order by a.created_at desc,a.scan_id desc`;
    for (const { previous, current, cursor_date: date, ...alert } of rows) {
      cursor = { date, id: alert.scan_id };
      if (alert.score_before !== null) {
        const older = scanReport.safeParse(previous);
        const newer = scanReport.safeParse(current);
        const change =
          older.success &&
          newer.success &&
          acceptAllScoreChange(older.data, newer.data);
        if (
          !change ||
          change.before !== alert.score_before ||
          change.after !== alert.score_after
        ) {
          if (!alert.document_count) continue;
          alert.score_before = null;
          alert.score_after = null;
        }
      }
      alerts.push({ ...alert, created_at: new Date(alert.created_at) });
      if (alerts.length === 50) return alerts;
    }
    if (rows.length < 50) break;
  } while (cursor);
  return alerts;
}
