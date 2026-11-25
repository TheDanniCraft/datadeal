import { domain } from "@datadeal/contracts";
import { defaultRefreshPointCost } from "@datadeal/contracts/paper-plane";
import type { Sql, TransactionSql } from "postgres";
import { applyReportPoints } from "./report-points";

type Admission =
  | { code: "accepted" | "scan_in_progress"; id: string }
  | { code: "domain_cooldown"; retryAfter: number }
  | { code: "queue_full" | "watchlist_disabled" };
type Enqueue = (
  tx: TransactionSql,
  domain: string,
  userId: string,
  client: string | null,
  daily: string | null,
) => Promise<Admission>;
class InsufficientPoints extends Error {}

export function pointRefreshStorage(sql: Sql, enqueue: Enqueue) {
  return async function refreshWithPoints(
    userId: string,
    input: string,
    requestId: string,
    client: string | null,
    daily: string | null,
  ) {
    const host = domain.parse(input);
    try {
      return await sql.begin(async (tx) => {
        // Same-body retries resolve before looking at current cooldown/balance.
        await tx`select pg_advisory_xact_lock(hashtextextended(${"point-refresh:" + userId + ":" + requestId},0))`;
        const [previous] = await tx<
          { domain: string; scan_id: string; cost: number; refunded: boolean }[]
        >`
          select r.domain, r.scan_id, r.cost, exists (
            select 1 from report_point_ledger where operation='scan_refresh_refund' and reference_id=r.scan_id
          ) as refunded
          from report_point_refreshes r where r.user_id=${userId} and r.request_id=${requestId}`;
        if (previous)
          return previous.domain === host
            ? ({
                code: previous.refunded ? "refunded" : "accepted",
                id: previous.scan_id,
                points: previous.cost,
              } as const)
            : ({ code: "conflict" } as const);
        const [available] =
          await tx`select 1 from scans where domain=${host} and state in ('completed','partially_completed')
          and report->'demo' = 'false'::jsonb limit 1`;
        if (!available) return { code: "no_report" } as const;
        const queued = await enqueue(tx, host, userId, client, daily);
        if (queued.code !== "accepted") return queued;
        const cost = defaultRefreshPointCost;
        const applied = await applyReportPoints(tx, {
          userId,
          delta: -cost,
          operation: "scan_refresh",
          referenceId: queued.id,
        });
        // A failed debit must roll the new job and all admission buckets back.
        if (applied === "insufficient") throw new InsufficientPoints();
        if (applied !== "applied")
          throw new Error("Unexpected existing refresh debit for a new scan");
        await tx`insert into report_point_refreshes(user_id, request_id, domain, scan_id, cost)
          values (${userId},${requestId},${host},${queued.id},${cost})`;
        return { code: "accepted", id: queued.id, points: cost } as const;
      });
    } catch (error) {
      if (error instanceof InsufficientPoints)
        return { code: "insufficient_points" } as const;
      throw error;
    }
  };
}

export async function refundPointRefresh(tx: TransactionSql, scanId: string) {
  const [debit] = await tx<{ user_id: string; cost: number }[]>`
    select user_id,cost from report_point_refreshes where scan_id=${scanId}`;
  if (debit)
    await applyReportPoints(tx, {
      userId: debit.user_id,
      operation: "scan_refresh_refund",
      referenceId: scanId,
      delta: debit.cost,
    });
}
