import { createHash } from "node:crypto";
import { scanReport } from "@datadeal/contracts";
import { hasAdvancedSnapshotDetails } from "@datadeal/contracts/advanced-report";
import type { Sql, TransactionSql } from "postgres";

export type ScanRewardHolder =
  { kind: "user"; userId: string } | { kind: "guest"; holderHash: string };

// Accept this input only after verifying the provider receipt and its holder/scan binding.
export type VerifiedScanRewardReceipt = {
  provider: "google_ad_manager";
  receiptId: string;
  scanId: string;
  holder: ScanRewardHolder;
};

type LocalSampleReceipt = {
  provider: "local_sample";
  receiptId: string;
  scanId: string;
  holder: Extract<ScanRewardHolder, { kind: "guest" }>;
  signedInUserId?: string;
};

const sha256 = /^[a-f0-9]{64}$/;

export async function lockRewardableScan(
  tx: TransactionSql,
  scanId: string,
  expectedDomain?: string,
) {
  const [row] = await tx`
    select domain, report from scans where id = ${scanId}
      and state in ('completed', 'partially_completed')
      and report->'demo' = 'false'::jsonb
    for update`;
  if (!row || (expectedDomain !== undefined && row.domain !== expectedDomain))
    return false;
  const parsed = scanReport.safeParse(row.report);
  return (
    parsed.success &&
    parsed.data.id === scanId &&
    parsed.data.domain === row.domain &&
    hasAdvancedSnapshotDetails(parsed.data)
  );
}

async function lockPublishedScan(tx: TransactionSql, scanId: string) {
  const [scan] = await tx`
    select id from scans where id = ${scanId}
      and state in ('completed', 'partially_completed')
      and report->'demo' = 'false'::jsonb
    for key share`;
  return Boolean(scan);
}

export function scanRewardStorage(sql: Sql) {
  return {
    async accountReportUnlocks(userId: string) {
      return sql`select s.domain, s.id as "scanId" from scan_reward_grants g
        join scans s on s.id=g.scan_id where g.user_id=${userId} order by s.domain, s.id`;
    },
    async grantScanReward(
      receipt: VerifiedScanRewardReceipt | LocalSampleReceipt,
    ) {
      const { provider, receiptId, scanId, holder } = receipt;
      const userId =
        holder.kind === "user"
          ? holder.userId
          : receipt.provider === "local_sample"
            ? receipt.signedInUserId
            : undefined;
      if (
        (provider !== "google_ad_manager" &&
          (provider !== "local_sample" || holder.kind !== "guest")) ||
        !receiptId.trim() ||
        receiptId.length > 512 ||
        !scanReport.shape.id.safeParse(scanId).success ||
        (holder.kind === "guest" && !sha256.test(holder.holderHash))
      ) {
        return "unavailable" as const;
      }
      const receiptHash = createHash("sha256").update(receiptId).digest("hex");
      return sql.begin(async (tx) => {
        // Both direct receipts and reserved offers lock the report before its receipt.
        const eligible = await lockRewardableScan(tx, scanId);
        // Keep a one-way replay marker even if the scan or grant later expires or is deleted.
        const [receipt] = await tx`
          insert into scan_reward_receipts(provider, receipt_hash)
          values (${provider}, ${receiptHash})
          on conflict do nothing returning 1`;
        if (!receipt) return "duplicate_receipt" as const;

        if (!eligible) return "unavailable" as const;

        if (userId !== undefined) {
          const [account] =
            await tx`select id from "user" where id = ${userId} for key share`;
          if (!account) return "unavailable" as const;
          await tx`
            insert into scan_reward_grants(scan_id, user_id)
            values (${scanId}, ${userId})
            on conflict (scan_id, user_id) do nothing`;
        }
        if (holder.kind === "guest") {
          await tx`
            insert into scan_reward_grants(scan_id, holder_hash, expires_at, account_claim_available)
            values (${scanId}, ${holder.holderHash}, now() + interval '24 hours', ${userId === undefined})
            on conflict (scan_id, holder_hash) do update
            set expires_at = greatest(scan_reward_grants.expires_at, excluded.expires_at),
                account_claim_available = scan_reward_grants.account_claim_available and excluded.account_claim_available`;
        }
        return "granted" as const;
      });
    },
    async hasScanReward(scanId: string, holder: ScanRewardHolder) {
      if (
        !scanReport.shape.id.safeParse(scanId).success ||
        (holder.kind === "guest" && !sha256.test(holder.holderHash))
      ) {
        return false;
      }
      const user = holder.kind === "user" ? holder.userId : null;
      const hash = holder.kind === "guest" ? holder.holderHash : null;
      const [grant] = await sql`
        select 1 from scan_reward_grants g join scans s on s.id = g.scan_id
        where g.scan_id = ${scanId}
          and s.state in ('completed', 'partially_completed')
          and s.report->'demo' = 'false'::jsonb
          and (g.user_id = ${user} or (g.holder_hash = ${hash} and g.expires_at > now()))`;
      return Boolean(grant);
    },
    async previousRewardedScan(
      domain: string,
      currentScanId: string,
      userId: string | null,
      guests: readonly { scanId: string; holderHash: string }[],
    ) {
      const [result] = await sql<{ id: string }[]>`
        select s.id from scans s
        join scan_reward_grants g on g.scan_id = s.id
        join scans target on target.id = ${currentScanId} and target.domain = s.domain
          and target.state in ('completed','partially_completed')
          and target.report->'demo' = 'false'::jsonb
        where s.domain = ${domain} and s.id <> ${currentScanId}
          and s.state in ('completed', 'partially_completed')
          and s.report->'demo' = 'false'::jsonb
          and (g.user_id = ${userId} or (
            g.expires_at > now() and exists (
              select 1 from unnest(
                ${sql.array(guests.map(({ scanId }) => scanId))}::uuid[],
                ${sql.array(guests.map(({ holderHash }) => holderHash))}::text[]
              ) as guest(scan_id, holder_hash)
              where guest.scan_id = s.id and guest.holder_hash = g.holder_hash
            )
          ))
        order by s.requested_at desc, s.id desc
        limit 1`;
      return result?.id;
    },
    // The caller must derive holderHash from the presented guest secret and authenticate userId.
    async claimGuestScanReward(
      scanId: string,
      holderHash: string,
      userId: string,
    ) {
      if (
        !scanReport.shape.id.safeParse(scanId).success ||
        !sha256.test(holderHash)
      )
        return false;
      return sql.begin(async (tx) => {
        if (!(await lockPublishedScan(tx, scanId))) return false;
        const [account] =
          await tx`select id from "user" where id = ${userId} for key share`;
        if (!account) return false;
        // Consume only the account claim. The browser keeps its original
        // report version until expiry, even if the receiving account is later deleted.
        const [guest] = await tx`
          update scan_reward_grants set account_claim_available = false
          where scan_id = ${scanId} and holder_hash = ${holderHash}
            and account_claim_available and expires_at > now()
          returning scan_id`;
        if (!guest) return false;
        await tx`
          insert into scan_reward_grants(scan_id, user_id)
          values (${scanId}, ${userId})
          on conflict (scan_id, user_id) do nothing`;
        return true;
      });
    },
  };
}
