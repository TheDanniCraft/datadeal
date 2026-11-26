import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "../../../lib/auth";
import { localPointsEnabled } from "../../../lib/local-reward";
import { database } from "../../../lib/reports";
import { AccountScreen } from "../account-ui";
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
      <div>
        <p className="text-sm text-muted">Available balance</p>
        <p className="text-5xl font-semibold tabular-nums">
          {wallet.balance}{" "}
          <span className="text-lg">
            {wallet.balance === 1 ? "point" : "points"}
          </span>
        </p>
      </div>
      <FlyForPoints freeFlights={wallet.tickets.map((ticket) => ticket.id)} />
      <RewardFromQuery signedIn />
      <section>
        <h2 className="mb-2 text-xl">Recent activity</h2>
        {wallet.activity.length ? (
          <ul className="divide-y divide-separator">
            {wallet.activity.map((entry) => (
              <li
                className="flex items-baseline justify-between gap-3 py-3"
                key={entry.id}
              >
                <span>
                  {operations[entry.operation] ?? "Report points"}{" "}
                  <small className="text-muted">
                    <LocalDate value={entry.created_at} />
                  </small>
                </span>
                <strong className="tabular-nums">
                  {entry.delta > 0 ? "+" : ""}
                  {entry.delta}
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            Your first earned or spent points will appear here.
          </p>
        )}
      </section>
    </AccountScreen>
  );
}
