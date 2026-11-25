import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lockRewardableScan } from "./scan-rewards";
import {
  flightCap,
  flightCheckpoint,
  flightTimeMs,
  liveOffer,
  drawFlightEndpoint,
  resolveFlight,
  guaranteedPoints,
  defaultReportPointCost,
} from "@datadeal/contracts/paper-plane";
import type { Sql, TransactionSql } from "postgres";
import { applyReportPoints } from "./report-points";

type Choice = "flight" | "points" | "choice" | "unlock";
type State =
  | "pending"
  | "choose"
  | "ready"
  | "flying"
  | "banked"
  | "missed"
  | "points"
  | "unlocked";
type Actor = { userId: string | null; browserHash: string };
type Offer = {
  id: string;
  domain: string;
  scan_id: string;
  user_id: string | null;
  browser_hash: string;
  offer: Choice;
  state: State;
  launched_at: Date | null;
  continued_at: Date | null;
  endpoint: number | null;
  target: number | null;
  payout: number | null;
};
type Command =
  | "complete"
  | "open"
  | "choosePoints"
  | "chooseFlight"
  | "launch"
  | "continue"
  | "bank"
  | "status";
const pauseLimit = 10000;
const checkpointMs = flightTimeMs(flightCheckpoint);

async function grant(
  tx: TransactionSql,
  scanId: string,
  holderHash: string,
  userId: string | null,
) {
  if (userId)
    await tx`insert into scan_reward_grants(scan_id,user_id) values(${scanId},${userId}) on conflict do nothing`;
  await tx`insert into scan_reward_grants(scan_id,holder_hash,expires_at,account_claim_available)
    values(${scanId},${holderHash},now()+interval '24 hours',${userId === null}) on conflict do nothing`;
}
function clock(row: Offer, now: number) {
  if (!row.launched_at) return { activeMs: 0, checkpoint: false };
  const start = new Date(row.launched_at).getTime();
  const elapsed = Math.max(0, now - start);
  const hold = row.continued_at
    ? Math.min(
        pauseLimit,
        Math.max(
          0,
          new Date(row.continued_at).getTime() - start - checkpointMs,
        ),
      )
    : pauseLimit;
  const pastCheckpoint = Math.max(0, elapsed - checkpointMs);
  return {
    activeMs: elapsed - Math.min(hold, pastCheckpoint),
    checkpoint: elapsed >= checkpointMs && pastCheckpoint < hold,
  };
}
function publicState(row: Offer, now: number) {
  const { activeMs, checkpoint } = clock(row, now);
  const final =
    row.endpoint !== null &&
    activeMs >= flightTimeMs(Math.min(row.endpoint, flightCap));
  return {
    id: row.id,
    scanId: row.scan_id,
    domain: row.domain,
    state: row.state,
    offer: row.offer,
    target: row.target,
    payout: row.payout,
    activeMs,
    live: final
      ? Math.floor(Math.min(row.endpoint!, flightCap))
      : liveOffer(activeMs),
    checkpoint: checkpoint && row.state === "flying",
    finalAmount: final ? Math.floor(Math.min(row.endpoint!, flightCap)) : null,
  };
}
async function settle(
  tx: TransactionSql,
  row: Offer,
  now: number,
  collect: boolean,
) {
  if (row.state !== "flying" || row.endpoint === null || !row.user_id) return;
  const result = resolveFlight({
    endpoint: row.endpoint,
    activeMs: clock(row, now).activeMs,
    target: row.target,
    collect,
  });
  if (result.state === "flying") return;
  if (result.points)
    await applyReportPoints(tx, {
      userId: row.user_id,
      delta: result.points,
      operation: "flight_bank",
      referenceId: row.id,
    });
  row.state = result.state;
  row.payout = result.points;
  await tx`update report_reward_offers set state=${row.state},payout=${row.payout} where id=${row.id}`;
}
export function paperPlaneStorage(sql: Sql) {
  return {
    async reservedReportOffer(id: string) {
      const [row] =
        await sql`select 1 from report_reward_offers where id=${id}`;
      return Boolean(row);
    },
    async settleOfflineFlights() {
      // Even a capped flight with the full checkpoint pause is over within 22 seconds.
      return sql.begin(async (tx) => {
        const rows = await tx<
          Offer[]
        >`select * from report_reward_offers where state='flying' and launched_at<now()-interval '22 seconds' order by id limit 100 for update skip locked`;
        for (const row of rows) await settle(tx, row, Date.now(), false);
        return rows.length;
      });
    },
    async createReportOffer(
      host: string,
      scanId: string,
      offer: Choice,
      actor: Actor,
    ) {
      if ((offer === "points" || offer === "flight") && !actor.userId)
        return null;
      return sql.begin(async (tx) => {
        if (!(await lockRewardableScan(tx, scanId, host))) return null;
        const id = randomUUID();
        await tx`insert into report_reward_offers(id,scan_id,user_id,browser_hash,offer) values(${id},${scanId},${actor.userId},${actor.browserHash},${offer})`;
        return id;
      });
    },
    async reportOfferAction(
      id: string,
      actor: Actor,
      command: Command,
      input: {
        target?: number | null;
        grantHash?: string;
        host?: string;
        scanId?: string;
      } = {},
    ) {
      return sql.begin(async (tx) => {
        const [row] = await tx<
          Offer[]
        >`select o.*,s.domain from report_reward_offers o join scans s on s.id=o.scan_id where o.id=${id} for update of o`;
        if (!row) return { code: "missing" as const };
        if (
          (row.user_id
            ? row.user_id !== actor.userId
            : row.browser_hash !== actor.browserHash) ||
          (command === "complete" &&
            (row.domain !== input.host || row.scan_id !== input.scanId))
        )
          return { code: "forbidden" as const };
        const now = Date.now();
        if (
          ((command === "complete" &&
            row.state === "pending" &&
            (row.offer === "unlock" ||
              (row.offer === "choice" && Boolean(row.user_id)))) ||
            (command === "open" && row.state === "choose")) &&
          !(await lockRewardableScan(tx, row.scan_id, row.domain))
        )
          return { code: "missing" as const };
        if (command === "complete" && row.state === "pending") {
          const hash = createHash("sha256").update(id).digest("hex");
          const [receipt] =
            await tx`insert into scan_reward_receipts(provider,receipt_hash) values('local_sample',${hash}) on conflict do nothing returning 1`;
          if (!receipt) return { code: "conflict" as const };
          if (row.offer === "points") {
            await applyReportPoints(tx, {
              userId: row.user_id!,
              delta: guaranteedPoints,
              operation: "ad_points",
              referenceId: id,
            });
            row.state = "points";
            row.payout = guaranteedPoints;
          } else if (row.offer === "unlock") {
            if (!input.grantHash) throw Error("Missing browser grant");
            await grant(
              tx,
              row.scan_id,
              input.grantHash,
              row.user_id ?? actor.userId,
            );
            row.state = "unlocked";
          } else if (row.offer === "choice") {
            if (row.user_id)
              await tx`insert into scan_reward_grants(scan_id,user_id) values(${row.scan_id},${row.user_id}) on conflict do nothing`;
            row.state = "choose";
          } else row.state = "ready";
          await tx`update report_reward_offers set state=${row.state},payout=${row.payout},completed_at=now() where id=${id}`;
        }
        if (command === "open" && row.state !== "unlocked") {
          if (row.state !== "choose" || !input.grantHash)
            return { code: "conflict" as const };
          await grant(tx, row.scan_id, input.grantHash, actor.userId);
          row.state = "unlocked";
          await tx`update report_reward_offers set state='unlocked',user_id=${actor.userId} where id=${id}`;
        }
        if (command === "choosePoints" && row.state !== "points") {
          if (row.state !== "choose" || !actor.userId)
            return { code: "conflict" as const };
          await applyReportPoints(tx, {
            userId: actor.userId,
            delta: guaranteedPoints,
            operation: "ad_points",
            referenceId: id,
          });
          row.state = "points";
          row.user_id = actor.userId;
          row.payout = guaranteedPoints;
          await tx`update report_reward_offers set state='points',payout=${row.payout},user_id=${row.user_id} where id=${id}`;
        }
        if (command === "chooseFlight" && row.state !== "ready") {
          if (row.state !== "choose" || !actor.userId)
            return { code: "conflict" as const };
          row.state = "ready";
          row.user_id = actor.userId;
          await tx`update report_reward_offers set state='ready',user_id=${actor.userId} where id=${id}`;
        }
        if (command === "launch" && row.state === "ready" && row.user_id) {
          row.endpoint = drawFlightEndpoint(
            (randomBytes(6).readUIntBE(0, 6) + 0.5) / 2 ** 48,
          );
          row.target = input.target ?? null;
          row.launched_at = new Date(now);
          row.state = "flying";
          await tx`update report_reward_offers set state='flying',endpoint=${row.endpoint},target=${row.target},launched_at=${row.launched_at.toISOString()} where id=${id}`;
        }
        await settle(tx, row, now, command === "bank");
        if (
          command === "continue" &&
          row.state === "flying" &&
          clock(row, now).checkpoint
        ) {
          row.continued_at = new Date(now);
          await tx`update report_reward_offers set continued_at=${row.continued_at.toISOString()} where id=${id}`;
        }
        return { code: "ok" as const, reward: publicState(row, now) };
      });
    },
    async exportReportRewards(userId: string) {
      const [balance] =
        await sql`select balance from report_point_accounts where user_id=${userId}`;
      const activity =
        await sql`select delta,operation,created_at from report_point_ledger where user_id=${userId} order by created_at,id`;
      const offers =
        await sql`select s.domain,o.offer,o.state,o.created_at,o.completed_at,o.target,o.launched_at,o.payout from report_reward_offers o join scans s on s.id=o.scan_id where o.user_id=${userId} order by o.created_at,o.id`;
      return { balance: balance?.balance ?? 0, activity, offers };
    },
    async reportPointWallet(userId: string) {
      return sql.begin(async (tx) => {
        const running = await tx<
          Offer[]
        >`select * from report_reward_offers where user_id=${userId} and state='flying' order by id for update`;
        for (const row of running) await settle(tx, row, Date.now(), false);
        const [account] =
          await tx`select balance from report_point_accounts where user_id=${userId}`;
        const activity = await tx<
          { id: string; delta: number; operation: string; created_at: Date }[]
        >`select id,delta,operation,created_at from report_point_ledger where user_id=${userId} order by created_at desc,id limit 30`;
        const tickets = await tx<
          { id: string; domain: string; state: State }[]
        >`select o.id,s.domain,o.state from report_reward_offers o join scans s on s.id=o.scan_id where o.user_id=${userId} and o.state in('choose','ready','flying') order by o.created_at desc`;
        return { balance: Number(account?.balance ?? 0), activity, tickets };
      });
    },
    async spendOnReport(
      host: string,
      scanId: string,
      userId: string,
      guests: { scanId: string; holderHash: string }[],
    ) {
      return sql.begin(async (tx) => {
        if (!(await lockRewardableScan(tx, scanId, host))) return "unavailable";
        const [pro] =
          await tx`select 1 from subscriptions where user_id=${userId} and access_until>now() and status in ('active','canceled','past_due')`;
        const [owned] =
          await tx`select 1 from scan_reward_grants where scan_id=${scanId} and user_id=${userId}`;
        if (pro || owned) return "owned";
        const [temporary] = await tx`select 1 from scan_reward_grants g
          where g.scan_id=${scanId} and g.expires_at>now()
            and exists (
              select 1 from unnest(
                ${tx.array(guests.map((x) => x.scanId))}::uuid[],
                ${tx.array(guests.map((x) => x.holderHash))}::text[]
              ) as browser(id,hash)
              where browser.id=g.scan_id and browser.hash=g.holder_hash
            )`;
        if (temporary) return "owned";
        const debit = await applyReportPoints(tx, {
          userId,
          delta: -defaultReportPointCost,
          operation: "domain_unlock",
          referenceId: randomUUID(),
        });
        if (debit === "insufficient") return "insufficient";
        await tx`insert into scan_reward_grants(scan_id,user_id) values(${scanId},${userId})`;
        return "unlocked";
      });
    },
  };
}
export type PaperReward = ReturnType<typeof publicState>;
