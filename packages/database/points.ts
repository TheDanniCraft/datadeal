import { createHash, randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { applyReportPoints } from "./report-points";

/** The ledger reference of a point pack order: a uuid derived from its id. */
export function pointPackReference(orderId: string) {
  const hex = createHash("md5")
    .update("point-pack:" + orderId)
    .digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export type PointApiKind = "report_read" | "scan";
export type PointApiCharge = {
  key: string;
  requestHash: string;
  points: number;
};
type ScanAdmission =
  | { code: "accepted"; id: string }
  | { code: "scan_in_progress" }
  | { code: "domain_cooldown"; retryAfter: number }
  | { code: "queue_full" | "daily_limit" | "hourly_limit" };
type Enqueue = (
  tx: TransactionSql,
  host: string,
  userId: string,
) => Promise<ScanAdmission>;
type Rejection = Exclude<ScanAdmission, { code: "accepted" }>;

class RollBack extends Error {
  constructor(readonly result: Rejection | { code: "insufficient" }) {
    super(result.code);
  }
}

const operationName = {
  report_read: "api_report_read",
  scan: "api_scan",
} as const;

async function pointReplay(
  sql: Sql | TransactionSql,
  userId: string,
  key: string,
  hash: string,
) {
  const [row] = await sql<{ request_hash: string; response: unknown }[]>`
    select request_hash, response from point_api_operations
    where user_id=${userId} and request_key=${key}`;
  if (!row) return null;
  return row.request_hash === hash
    ? ({ code: "replayed", response: row.response } as const)
    : ({ code: "conflict" } as const);
}

/** Return the points of an API scan that failed or delivered no billable evidence, once. */
export async function refundApiPointScan(tx: TransactionSql, scanId: string) {
  const [op] = await tx<{ id: string; user_id: string; points: number }[]>`
    select id, user_id, points from point_api_operations
    where scan_id=${scanId} and kind='scan' and refunded_at is null for update`;
  if (!op) return;
  await applyReportPoints(tx, {
    userId: op.user_id,
    delta: op.points,
    operation: "api_scan_refund",
    referenceId: op.id,
  });
  await tx`update point_api_operations set refunded_at=now() where id=${op.id}`;
}

export function pointStorage(sql: Sql, enqueue: Enqueue) {
  async function pointPackReceipt(
    userId: string,
    reference: string | { orderId: string },
  ) {
    const orderId = typeof reference === "string" ? null : reference.orderId;
    const requestId = typeof reference === "string" ? reference : null;
    const [row] = await sql<{ points: number; refunded: boolean }[]>`
      select points, refunded_at is not null as refunded from point_pack_purchases
      where user_id=${userId} and (request_id=${requestId}::uuid or order_id=${orderId})`;
    return row
      ? {
          status: row.refunded ? ("refunded" as const) : ("confirmed" as const),
          points: row.points,
        }
      : null;
  }

  return {
    pointPackReceipt,
    /**
     * Add a paid pack's points exactly once per order. A replay with another
     * account, amount or request is a conflict and grants nothing.
     */
    async settlePointPackPurchase(data: {
      userId: string;
      email: string;
      orderId: string;
      requestId: string;
      points: number;
      priceCents: number;
    }) {
      const { userId, email, orderId, requestId, points, priceCents } = data;
      if (
        !Number.isSafeInteger(points) ||
        points <= 0 ||
        !Number.isSafeInteger(priceCents) ||
        priceCents <= 0
      )
        return "conflict" as const;
      return sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${"point-pack:" + orderId},0))`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${"point-pack-request:" + requestId},0))`;
        const previous = await tx<
          {
            order_id: string;
            user_id: string | null;
            points: number;
            request_id: string;
          }[]
        >`select order_id, user_id, points, request_id from point_pack_purchases
          where order_id=${orderId} or request_id=${requestId}`;
        if (previous.length) {
          const [row] = previous;
          return previous.length === 1 &&
            row.order_id === orderId &&
            row.request_id === requestId &&
            row.user_id === userId &&
            row.points === points
            ? ("replayed" as const)
            : ("conflict" as const);
        }
        const [owner] = await tx<{ email: string; emailVerified: boolean }[]>`
          select email, "emailVerified" from "user" where id=${userId} for update`;
        if (!owner) return "account_missing" as const;
        if (
          !owner.emailVerified ||
          owner.email.toLowerCase() !== email.toLowerCase()
        )
          return "conflict" as const;
        await tx`insert into point_pack_purchases(order_id, user_id, points, price_cents, request_id)
          values (${orderId}, ${userId}, ${points}, ${priceCents}, ${requestId})`;
        const applied = await applyReportPoints(tx, {
          userId,
          delta: points,
          operation: "point_pack",
          referenceId: pointPackReference(orderId),
        });
        if (applied !== "applied")
          throw new Error("Unexpected point pack ledger entry");
        return "applied" as const;
      });
    },
    /**
     * A full refund removes the pack's points once, never below zero: it takes
     * what is still available and records how much that was.
     */
    async refundPointPackPurchase(orderId: string) {
      return sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${"point-pack:" + orderId},0))`;
        const [purchase] = await tx<
          {
            user_id: string | null;
            points: number;
            refunded_at: Date | null;
          }[]
        >`select user_id, points, refunded_at from point_pack_purchases
          where order_id=${orderId} for update`;
        if (!purchase) return "missing" as const;
        if (purchase.refunded_at) return "replayed" as const;
        let removed = 0;
        if (purchase.user_id) {
          await tx`insert into report_point_accounts(user_id) values(${purchase.user_id}) on conflict do nothing`;
          const [account] = await tx<{ balance: number }[]>`
            select balance from report_point_accounts where user_id=${purchase.user_id} for update`;
          removed = Math.min(purchase.points, account.balance);
          if (removed > 0) {
            const applied = await applyReportPoints(tx, {
              userId: purchase.user_id,
              delta: -removed,
              operation: "point_pack_refund",
              referenceId: pointPackReference(orderId),
            });
            if (applied !== "applied")
              throw new Error("Unexpected point pack refund entry");
          }
        }
        await tx`update point_pack_purchases set refunded_at=now(), refunded_points=${removed}
          where order_id=${orderId}`;
        return "applied" as const;
      });
    },
    async pointPackPurchases(userId: string) {
      return sql<
        {
          orderId: string;
          points: number;
          priceCents: number;
          requestId: string;
          createdAt: Date;
          refundedAt: Date | null;
          refundedPoints: number | null;
        }[]
      >`select order_id as "orderId", points, price_cents as "priceCents", request_id as "requestId",
          created_at as "createdAt", refunded_at as "refundedAt", refunded_points as "refundedPoints"
        from point_pack_purchases where user_id=${userId} order by created_at desc, order_id`;
    },
    async pointApiOperations(userId: string, limit?: number) {
      const count =
        limit === undefined
          ? null
          : Math.max(0, Math.min(1000, Math.trunc(limit)));
      return sql<
        {
          id: string;
          requestKey: string;
          domain: string;
          kind: PointApiKind;
          points: number;
          scanId: string | null;
          createdAt: Date;
          refundedAt: Date | null;
        }[]
      >`select id, request_key as "requestKey", domain, kind, points, scan_id as "scanId",
          created_at as "createdAt", refunded_at as "refundedAt"
        from point_api_operations where user_id=${userId}
        order by created_at desc, id desc limit ${count}`;
    },
    pointApiReplay: (userId: string, key: string, hash: string) =>
      pointReplay(sql, userId, key, hash),
    /**
     * A key first used with Creem-held credits (kept for history) still
     * replays its saved response; it is never charged again in points.
     */
    async creemApiReplay(userId: string, key: string, hash: string) {
      const [row] = await sql<
        {
          request_hash: string;
          payload: unknown;
          result: { code?: string } | null;
        }[]
      >`select request_hash, payload, result from creem_api_operations
        where user_id=${userId} and request_key=${key}`;
      if (!row) return null;
      return row.request_hash === hash &&
        row.result?.code === "applied" &&
        row.payload
        ? ({ code: "replayed", response: row.payload } as const)
        : ({ code: "conflict" } as const);
    },
    /**
     * Charge points before the work, in one transaction with it: a saved
     * report read stores the response; a scan is admitted to the queue. A
     * rejected scan or a short balance rolls everything back.
     */
    async chargeApiPoints(
      userId: string,
      charge: PointApiCharge,
      host: string,
      kind: PointApiKind,
      payload: object | null = null,
    ) {
      const { key, requestHash, points } = charge;
      if (
        !/^[A-Za-z0-9._:-]{1,160}$/.test(key) ||
        !/^[a-f0-9]{64}$/.test(requestHash) ||
        !Number.isSafeInteger(points) ||
        points <= 0 ||
        (kind === "report_read" && !payload)
      )
        return { code: "invalid" } as const;
      try {
        return await sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(hashtextextended(${"point-api:" + userId + ":" + key},0))`;
          const replay = await pointReplay(tx, userId, key, requestHash);
          if (replay) return replay;
          const id = randomUUID();
          const debit = await applyReportPoints(tx, {
            userId,
            delta: -points,
            operation: operationName[kind],
            referenceId: id,
          });
          if (debit !== "applied") throw new RollBack({ code: "insufficient" });
          let response: object;
          let scanId: string | null = null;
          if (kind === "scan") {
            const admission = await enqueue(tx, host, userId);
            if (admission.code !== "accepted") throw new RollBack(admission);
            scanId = admission.id;
            response = { id: admission.id };
          } else response = payload!;
          await tx`insert into point_api_operations
            (id, user_id, request_key, request_hash, domain, kind, points, response, scan_id)
            values (${id}, ${userId}, ${key}, ${requestHash}, ${host}, ${kind}, ${points},
              ${JSON.stringify(response)}::text::jsonb, ${scanId})`;
          return { code: "applied", response } as const;
        });
      } catch (error) {
        if (error instanceof RollBack) return error.result;
        throw error;
      }
    },
  };
}
