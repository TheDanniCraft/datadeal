import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "../../../lib/auth";
import { localPointsEnabled } from "../../../lib/local-reward";
import { database } from "../../../lib/reports";
import { AccountScreen } from "../account-ui";
import { RefreshWithPoints } from "./refresh-with-points";
import { pointOperations as operations } from "./operations";
export default async function RewardsWallet() {
  if (!localPointsEnabled() || !database) notFound();
  const session = await auth?.api.getSession({ headers: await headers() });
  if (!session) redirect("/account?returnTo=/account/rewards");
  const wallet = await database.reportPointWallet(session.user.id);
  return (
    <AccountScreen
      title="Report points"
      description="Use your points to open an advanced report or request a fresh scan."
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
      {wallet.tickets.length > 0 && (
        <section>
          <h2 className="text-xl">Your flights and rewards</h2>
          <ul className="divide-y divide-separator">
            {wallet.tickets.map((ticket) => (
              <li key={ticket.id} className="py-3">
                <Link
                  className="inline-link"
                  href={"/report/" + ticket.domain + "?reward=" + ticket.id}
                >
                  {ticket.state === "ready"
                    ? "Launch flight"
                    : ticket.state === "choose"
                      ? "Choose reward"
                      : "Resume flight"}{" "}
                  · {ticket.domain}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <RefreshWithPoints balance={wallet.balance} />
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
                    {new Date(entry.created_at).toISOString().slice(0, 10)}
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
