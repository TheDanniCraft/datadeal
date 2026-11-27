import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "../../../lib/auth";
import { localPointsEnabled } from "../../../lib/local-reward";
import { database } from "../../../lib/reports";
import {
  AccountCard,
  AccountRow,
  AccountScreen,
  AccountSection,
  AccountStat,
} from "../account-ui";
import { defaultReportPointCost } from "@datadeal/contracts/paper-plane";
import { pointOperations as operations } from "./operations";
import { LocalDate } from "../../../lib/local-date";
import { RewardFromQuery } from "../../rewards/reward-modal";
import { FlyForPoints } from "./fly-for-points";
export default async function RewardsWallet() {
  if (!localPointsEnabled() || !database) notFound();
  const session = await auth?.api.getSession({ headers: await headers() });
  if (!session) redirect("/account?returnTo=/account/rewards");
  const wallet = await database.reportPointWallet(session.user.id);
  return (
    <AccountScreen
      title="Report points"
      description="Points open advanced reports without an ad. Earn them by flying the paper plane."
      current="/account/rewards"
    >
      <AccountCard>
        <AccountStat
          label="Available balance"
          value={
            <>
              {wallet.balance}{" "}
              <span className="text-sm font-normal text-muted">
                {wallet.balance === 1 ? "point" : "points"}
              </span>
            </>
          }
          note={`An unlock costs ${defaultReportPointCost} points.`}
        />
      </AccountCard>
      <FlyForPoints freeFlights={wallet.tickets.map((ticket) => ticket.id)} />
      <RewardFromQuery signedIn />
      <AccountSection title="Recent activity">
        {wallet.activity.length ? (
          <AccountCard>
            {wallet.activity.map((entry) => (
              <AccountRow
                key={entry.id}
                title={operations[entry.operation] ?? "Report points"}
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
