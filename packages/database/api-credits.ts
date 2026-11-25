import type { Sql, TransactionSql } from "postgres";
import type { ScanReport } from "@datadeal/contracts";

function validAmount(amount: number) {
  return Number.isInteger(amount) && amount > 0 && amount <= 2_147_483_647;
}

function validReference(reference: string) {
  return reference.length > 0 && reference.length <= 160;
}

async function lockAccount(tx: TransactionSql, userId: string) {
  const [account] = await tx`
    select id from "user" where id = ${userId} for no key update`;
  return Boolean(account);
}

async function creditReplay(
  sql: Sql | TransactionSql,
  userId: string,
  key: string,
  requestHash: string,
) {
  const [existing] = await sql<{ hash: string; response: unknown }[]>`
    select request_hash as hash, response from api_credit_entries
    where user_id = ${userId} and kind = 'usage' and reference = ${key}`;
  if (!existing) return null;
  return existing.hash === requestHash
    ? ({ code: "replayed", response: existing.response } as const)
    : ({ code: "conflict" } as const);
}

export type ApiCreditCharge = {
  key: string;
  requestHash: string;
  amount: number;
};

export async function applyApiCreditCharge<Result>(
  tx: TransactionSql,
  userId: string,
  { key, requestHash, amount }: ApiCreditCharge,
  operation: () => Promise<
    { response: object; scanId?: string } | { rejected: Result }
  >,
) {
  if (
    !validReference(key) ||
    !validAmount(amount) ||
    !/^[a-f0-9]{64}$/.test(requestHash)
  )
    return { code: "invalid" } as const;
  if (!(await lockAccount(tx, userId)))
    return { code: "account_missing" } as const;
  const existing = await creditReplay(tx, userId, key, requestHash);
  if (existing) return existing;
  const [balance] = await tx<{ sufficient: boolean }[]>`
    select coalesce(sum(delta), 0) >= ${amount} as sufficient
    from api_credit_entries where user_id = ${userId}`;
  if (!balance.sufficient) return { code: "insufficient" } as const;
  const result = await operation();
  if ("rejected" in result)
    return { code: "rejected", result: result.rejected } as const;
  await tx`
    insert into api_credit_entries(user_id, kind, reference, delta, request_hash, response, scan_id)
    values (${userId}, 'usage', ${key}, ${-amount}, ${requestHash}, ${JSON.stringify(result.response)}::text::jsonb, ${result.scanId ?? null})`;
  return { code: "applied", response: result.response } as const;
}

export function hasBillableScanEvidence(report: ScanReport) {
  if (report.demo) return false;
  const choices = [
    report.consentCoverage?.accepted,
    report.consentCoverage?.rejected,
  ];
  const choiceFailed =
    choices.includes("inconclusive") && !choices.includes("measured");
  const policyIds = new Set(
    report.findings
      .filter((finding) => finding.rule === "policy_available")
      .flatMap((finding) => finding.evidenceIds),
  );
  return report.evidence.some((source) => {
    if (source.scanId !== report.id || !source.url) return false;
    if (source.kind === "declared_first_party") {
      // The scanner validates the body of the primary privacy document. An
      // unrelated provider's terms or an inferred DNS record alone do not qualify.
      return (
        policyIds.has(source.id) &&
        (!source.observation || source.observation.type === "policy_section") &&
        Boolean(source.excerpt.trim())
      );
    }
    const visit = source.observation;
    if (
      source.kind !== "observed_technical" ||
      !source.consentScenario ||
      (visit?.type !== "browser_consent_counts" &&
        visit?.type !== "browser_content_page") ||
      visit.requests === 0 ||
      visit.finalPageKnown === false
    )
      return false;
    // A first-load snapshot alone cannot deliver a consent comparison if both
    // choices remained unresolved. An absent control is a valid observation.
    if (
      visit.type === "browser_consent_counts" &&
      source.consentScenario === "default" &&
      choiceFailed &&
      report.scoring?.score == null
    )
      return false;
    return (
      visit.type === "browser_content_page" ||
      !report.consentCoverage ||
      report.consentCoverage[source.consentScenario] === "measured"
    );
  });
}

export async function refundFailedApiScan(tx: TransactionSql, id: string) {
  await tx`update creem_api_operations set refund_requested=true, retry_at=now(), attempts=0
    where scan_id=${id} and event_name='datadeal_scan_requested' and transaction_id is not null and not refund_requested`;
  await tx`
    insert into api_credit_entries(user_id, kind, reference, delta, scan_id)
    select user_id, 'scan_refund', ${id}, -delta, scan_id
    from api_credit_entries where scan_id = ${id} and kind = 'usage'
    on conflict do nothing`;
}

export function apiCreditStorage(sql: Sql) {
  return {
    apiCreditReplay: (userId: string, key: string, requestHash: string) =>
      creditReplay(sql, userId, key, requestHash),
    async apiCreditSummary(userId: string, { fullHistory = false } = {}) {
      const [summary] = await sql<
        {
          balance: string;
          entries: {
            id: string;
            kind: "purchase" | "usage" | "scan_refund" | "payment_refund";
            delta: number;
            reference: string;
            createdAt: string;
            scanId: string | null;
            domain: string | null;
          }[];
        }[]
      >`
        select
          (select coalesce(sum(delta), 0)::text from api_credit_entries
            where user_id = ${userId}) as balance,
          coalesce((select jsonb_agg(to_jsonb(activity) order by "createdAt" desc, id desc)
            from (
              select entry.id, entry.kind, entry.delta, entry.reference,
                entry.created_at as "createdAt", entry.scan_id as "scanId",
                coalesce(scan.domain, entry.response->>'domain') as domain
              from api_credit_entries entry
              left join scans scan on scan.id = entry.scan_id
              where entry.user_id = ${userId}
              order by entry.created_at desc, entry.id desc limit ${fullHistory ? null : 25}
            ) activity), '[]'::jsonb) as entries`;
      return summary;
    },
    async recordApiCreditPurchase(
      userId: string,
      paymentReference: string,
      amount: number,
    ) {
      if (!validReference(paymentReference) || !validAmount(amount))
        return "invalid";
      return sql.begin(async (tx) => {
        if (!(await lockAccount(tx, userId))) return "account_missing";
        const [entry] = await tx`
          insert into api_credit_entries(user_id, kind, reference, delta)
          values (${userId}, 'purchase', ${paymentReference}, ${amount})
          on conflict do nothing returning id`;
        if (entry) return "applied";
        const [existing] = await tx<{ userId: string; delta: number }[]>`
          select user_id as "userId", delta from api_credit_entries
          where kind = 'purchase' and reference = ${paymentReference}`;
        return existing?.userId === userId && existing.delta === amount
          ? "replayed"
          : "conflict";
      });
    },
    async recordApiCreditPaymentRefund(paymentReference: string) {
      if (!validReference(paymentReference)) return "invalid";
      return sql.begin(async (tx) => {
        const [purchase] = await tx<{ userId: string }[]>`
          select user_id as "userId" from api_credit_entries
          where kind = 'purchase' and reference = ${paymentReference}`;
        if (!purchase || !(await lockAccount(tx, purchase.userId)))
          return "missing";
        const [reversal] = await tx`
          insert into api_credit_entries(user_id, kind, reference, delta)
          select user_id, 'payment_refund', reference, -delta from api_credit_entries
          where kind = 'purchase' and reference = ${paymentReference}
          on conflict do nothing returning id`;
        return reversal ? "applied" : "replayed";
      });
    },
    async debitApiCredits(
      userId: string,
      {
        key,
        requestHash,
        amount,
        response,
      }: ApiCreditCharge & { response: object },
    ) {
      return sql.begin((tx) =>
        applyApiCreditCharge(
          tx,
          userId,
          { key, requestHash, amount },
          async () => ({ response }),
        ),
      );
    },
  };
}
