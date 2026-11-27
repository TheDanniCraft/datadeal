import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "../../../lib/auth";
import { localPointsEnabled, pointsEnabled } from "../../../lib/local-reward";
import { database } from "../../../lib/reports";
import {
  AccountCard,
  AccountRow,
  AccountScreen,
  AccountSection,
  AccountStat,
} from "../account-ui";
import {
  defaultReportPointCost,
  flightCap,
} from "@datadeal/contracts/paper-plane";
import { pointOperations as operations } from "./operations";
import { LocalDate } from "../../../lib/local-date";
import { RewardFromQuery } from "../../rewards/reward-modal";
import { FlyForPoints } from "./fly-for-points";
import { BuyPoints } from "./buy-points";
import {
  describePointPacks,
  purchasablePointPacks,
} from "../../../lib/point-packs";
export default async function RewardsWallet() {
  if (!pointsEnabled() || !database) notFound();
  // Earning points needs a rewarded ad unit; only the local sample one exists.
  const earn = localPointsEnabled();
  const session = await auth?.api.getSession({ headers: await headers() });
  if (!session) redirect("/account?returnTo=/account/rewards");
  const wallet = await database.reportPointWallet(session.user.id);
  const packs = purchasablePointPacks()?.packs;
  return (
    <AccountScreen
      title="Points"
      description={
        earn
          ? "Points open advanced reports without an ad, keep sites updated and pay for Developer API requests. Earn them by flying the paper plane, or buy a pack."
          : "Points open advanced reports, skip the scan queue, keep watched sites updated and pay for Developer API requests. Buy a pack to get them."
      }
      current="/account/rewards"
    >
      <AccountCard>
        <AccountStat
          label="Available balance"
          value={
            <>
              {wallet.balance.toLocaleString("en")}{" "}
              <span className="text-sm font-normal text-muted">
                {wallet.balance === 1 ? "point" : "points"}
              </span>
            </>
          }
          note={`An unlock costs ${defaultReportPointCost} points.`}
        />
        <AccountRow
          title="Point packs"
          description={
            !packs
              ? "Point packs are currently unavailable."
              : session.user.emailVerified
                ? "Pick an amount. Bigger packs cost less per point."
                : "Verify your email before buying points."
          }
        >
          {packs && session.user.emailVerified && (
            <BuyPoints
              packs={describePointPacks(packs)}
              returnTo="/account/rewards"
            />
          )}
        </AccountRow>
      </AccountCard>
      {earn ? (
        <>
          <FlyForPoints
            freeFlights={wallet.tickets.map((ticket) => ticket.id)}
          />
          <RewardFromQuery signedIn />
        </>
      ) : (
        <AccountCard>
          <AccountRow
            title="Earn points (coming soon)"
            description={`Watch a short ad, then fly the paper plane for 1–${flightCap} points.`}
          />
        </AccountCard>
      )}
      <AccountSection title="Recent activity">
        {wallet.activity.length ? (
          <AccountCard>
            {wallet.activity.map((entry) => (
              <AccountRow
                key={entry.id}
                title={operations[entry.operation] ?? "Points"}
                description={<LocalDate value={entry.created_at} />}
              >
                <span
                  className={
                    "text-sm font-semibold tabular-nums " +
                    (entry.delta > 0 ? "text-success" : "")
                  }
                >
                  {entry.delta > 0 ? "+" : ""}
                  {entry.delta}
                </span>
              </AccountRow>
            ))}
          </AccountCard>
        ) : (
          <p className="m-0 text-sm text-muted">
            Your first earned or spent points will appear here.
          </p>
        )}
      </AccountSection>
    </AccountScreen>
  );
}
