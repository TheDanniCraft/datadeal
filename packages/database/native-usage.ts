import type { Sql, TransactionSql } from "postgres";
import { usageEventReceipt } from "@datadeal/contracts/creem-credits";
import type { ApiCreditCharge } from "./api-credits";

type EventName = "datadeal_report_read" | "datadeal_scan_requested";
type Binding = { customerId: string; accountId: string };
type ScanAdmission =
  | { code: "accepted"; id: string }
  | { code: "scan_in_progress" }
  | { code: "domain_cooldown"; retryAfter: number }
  | { code: "queue_full" | "daily_limit" | "hourly_limit" };
type Decision =
  | Exclude<ScanAdmission, { code: "accepted" }>
  | { code: "insufficient" | "applied" | "expired" };
type Outcome =
  | Exclude<Decision, { code: "insufficient" | "applied" | "expired" }>
  | { code: "applied"; response: unknown }
  | { code: "insufficient" | "conflict" | "unavailable" | "expired" };
export type NativeUsageProvider = {
  debit(
    accountId: string,
    amount: number,
    reference: string,
    idempotencyKey: string,
  ): Promise<{ id: string }>;
  reverse(accountId: string, transactionId: string): Promise<{ id: string }>;
};
type Enqueue = (
  tx: TransactionSql,
  host: string,
  userId: string,
) => Promise<ScanAdmission>;
type Record = {
  id: string;
  user_id: string | null;
  account_id: string;
  customer_id: string;
  event_name: EventName;
  amount: number;
  domain: string;
  payload: unknown;
  result: Decision | null;
  transaction_id: string | null;
  meter_requested_at: Date | string | null;
  refund_requested: boolean;
  refunded_at: Date | null;
  claim_expired: boolean;
};

export type SendUsageEvent = (event: {
  name: EventName;
  event_id: string;
  customer_id: string;
  timestamp: string;
}) => Promise<string[]>;
export const sendCreemUsageEvent: SendUsageEvent = async (event) => {
  if (process.env.CREEM_MODE !== "test" || !process.env.CREEM_API_KEY)
    throw Error("Creem test credentials required");
  const response = await fetch("https://test-api.creem.io/v1/events/ingest", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(6000),
    headers: {
      "x-api-key": process.env.CREEM_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({ events: [event] }),
  });
  if (response.status !== 202) throw Error("Creem usage event delivery failed");
  const receipt = usageEventReceipt.parse(await response.json());
  if (receipt.event_ids[0] !== event.event_id)
    throw Error("Creem acknowledged a different event");
  return receipt.warnings.map((warning) => warning.code);
};

function providerInsufficient(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "insufficient_balance"
  );
}

export function nativeUsageStorage(sql: Sql, enqueue: Enqueue) {
  // Persist the id before calling Creem. A timeout or a database rollback
  // always repeats the exact same debit, including when a worker takes over.
  async function settle(
    id: string,
    provider: NativeUsageProvider,
    serving: boolean,
  ): Promise<Outcome> {
    return sql.begin(async (tx) => {
      const [op] = await tx<
        Record[]
      >`select *, claim_until <= now() as claim_expired from creem_api_operations where id=${id} for update`;
      if (!op) return { code: "unavailable" } as const;
      let decision = op.result;
      let payload = op.payload;
      if (!decision) {
        let transactionId: string | null = null;
        try {
          transactionId = (
            await provider.debit(op.account_id, op.amount, id, "debit-" + id)
          ).id;
        } catch (error) {
          if (!providerInsufficient(error)) throw error;
          decision = { code: "insufficient" };
        }
        let scanId: string | null = null;
        if (transactionId) {
          if (!op.user_id) {
            // The account was deleted while the provider response was uncertain.
            // Settle the original reference and reverse it without doing the work.
            decision = { code: "insufficient" };
          } else if (op.event_name === "datadeal_scan_requested") {
            const admission = await enqueue(tx, op.domain, op.user_id);
            if (admission.code === "accepted") {
              scanId = admission.id;
              payload = { id: scanId };
              decision = { code: "applied" };
            } else decision = admission;
          } else decision = { code: "applied" };
        }
        if (!decision) throw Error("Missing credit decision");
        if (decision.code !== "applied") payload = null;
        await tx`update creem_api_operations set payload=${JSON.stringify(payload)}::text::jsonb,
          result=${JSON.stringify(decision)}::text::jsonb, transaction_id=${transactionId}, scan_id=${scanId},
          refund_requested=${!!transactionId && decision.code !== "applied"}, retry_at=now(), attempts=0 where id=${id}`;
      }
      if (
        op.claim_expired ||
        (!op.user_id && decision.code === "applied" && !op.meter_requested_at)
      ) {
        await tx`update creem_api_operations set result='{"code":"expired"}',payload=null,
          claim_until=null,refund_requested=true,retry_at=now() where id=${id}`;
        return { code: "expired" } as const;
      }
      if (decision.code === "applied") {
        if (serving || op.event_name === "datadeal_scan_requested") {
          await tx`update creem_api_operations set meter_requested_at=now(),claim_until=null where id=${id} and meter_requested_at is null`;
        } else if (!op.result) {
          // An ambiguous read recovered without its caller. Allow the caller to
          // collect the same response, then reverse if it was never served.
          await tx`update creem_api_operations set claim_until=now()+interval '1 hour' where id=${id}`;
        }
        return { code: "applied", response: payload } as const;
      }
      return { ...decision } as Outcome;
    });
  }

  async function deliver(
    id: string,
    provider: NativeUsageProvider,
    send: SendUsageEvent,
  ) {
    // A metering failure must not hold up a refund. Commit the reversal
    // separately so retrying an event never requires reversing a second time.
    await sql.begin(async (tx) => {
      const [op] = await tx<
        Record[]
      >`select * from creem_api_operations where id=${id}
        and refund_requested and refunded_at is null for update`;
      if (!op || !op.transaction_id) return;
      const reversal = await provider.reverse(op.account_id, op.transaction_id);
      await tx`update creem_api_operations set refunded_at=now(), reversal_id=${reversal.id} where id=${id}`;
    });
    await sql.begin(async (tx) => {
      const [op] = await tx<
        Record[]
      >`select * from creem_api_operations where id=${id}
        and meter_requested_at is not null and metered_at is null for update`;
      if (!op || !op.meter_requested_at) return;
      const warnings = await send({
        name: op.event_name,
        event_id: id,
        customer_id: op.customer_id,
        timestamp: new Date(op.meter_requested_at).toISOString(),
      });
      await tx`update creem_api_operations set metered_at=now(),
        meter_warning_codes=${tx.array(warnings)}::text[] where id=${id}`;
    });
  }

  async function defer(id: string) {
    await sql`update creem_api_operations set attempts=least(attempts+1,8),
      retry_at=now() + make_interval(secs => least(300, 2 ^ least(attempts+1,8))::int) where id=${id}`;
  }

  return {
    async nativeUsageHistory(userId: string, limit?: number) {
      const count =
        limit === undefined
          ? null
          : Math.max(0, Math.min(1000, Math.trunc(limit)));
      const rows = await sql<
        {
          createdAt: Date | string;
          domain: string;
          operation: EventName;
          amount: number;
          transactionId: string;
          reversalId: string | null;
          status: "charged" | "refund_pending" | "refunded";
          refundedAt: Date | string | null;
        }[]
      >`select created_at as "createdAt",domain,event_name as operation,amount,transaction_id as "transactionId",reversal_id as "reversalId",
        case when refunded_at is not null then 'refunded' when refund_requested then 'refund_pending' else 'charged' end as status,
        refunded_at as "refundedAt" from creem_api_operations where user_id=${userId} and transaction_id is not null
        order by created_at desc,id limit ${count}`;
      return rows.map((row) => ({
        ...row,
        createdAt: new Date(row.createdAt),
        refundedAt: row.refundedAt ? new Date(row.refundedAt) : null,
      }));
    },
    async lookupNativeUsage(userId: string, key: string, hash: string) {
      const [row] = await sql<
        { id: string; request_hash: string }[]
      >`select id, request_hash from creem_api_operations where user_id=${userId} and request_key=${key}`;
      return row ? { id: row.id, conflict: row.request_hash !== hash } : null;
    },
    async reserveNativeUsage(
      userId: string,
      charge: ApiCreditCharge,
      binding: Binding,
      host: string,
      name: EventName,
      payload: unknown = null,
    ) {
      const [op] = await sql<
        { id: string; request_hash: string }[]
      >`insert into creem_api_operations
        (user_id, request_key, request_hash, customer_id, account_id, domain, event_name, amount, payload, retry_at)
        values (${userId},${charge.key},${charge.requestHash},${binding.customerId},${binding.accountId},${host},${name},${charge.amount},${JSON.stringify(payload)}::text::jsonb,now()+interval '30 seconds')
        on conflict (user_id,request_key) do update set request_key=excluded.request_key returning id,request_hash`;
      return { id: op.id, conflict: op.request_hash !== charge.requestHash };
    },
    async serveNativeUsage(
      id: string,
      provider: NativeUsageProvider,
      send: SendUsageEvent = sendCreemUsageEvent,
    ): Promise<Outcome> {
      let result: Outcome;
      try {
        result = await settle(id, provider, true);
      } catch {
        await defer(id);
        return { code: "unavailable" };
      }
      // The local response is already committed, even if the meter is offline.
      try {
        await deliver(id, provider, send);
      } catch {
        await defer(id);
      }
      return result;
    },
    async retryNativeUsage(
      provider: NativeUsageProvider,
      send: SendUsageEvent = sendCreemUsageEvent,
    ) {
      const pending = await sql<
        { id: string }[]
      >`select id from creem_api_operations where claim_until<=now() or (retry_at<=now()
        and (result is null or (refund_requested and refunded_at is null) or (meter_requested_at is not null and metered_at is null)))
        order by retry_at,id limit 4`;
      for (const { id } of pending) {
        try {
          await settle(id, provider, false);
          await deliver(id, provider, send);
        } catch {
          await defer(id);
        }
      }
    },
  };
}
