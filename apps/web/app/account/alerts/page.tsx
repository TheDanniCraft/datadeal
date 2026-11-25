import { headers } from "next/headers";
import { proPlansPath } from "../../../lib/checkout-return";
import Link from "next/link";
import { AccountScreen, AccountLink, AccountEmpty } from "../account-ui";
import { auth } from "../../../lib/auth";
import { database } from "../../../lib/reports";
import { AlertPreference } from "./alert-preference";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const session = await auth?.api.getSession({ headers: await headers() });
  const [alerts, watches, pro] =
    session && database
      ? await Promise.all([
          database.documentAlerts(session.user.id),
          database.listWatchlist(session.user.id),
          database.hasPro(session.user.id),
        ])
      : ([[], [], false] as const);
  return (
    <AccountScreen
      title="Alerts"
      description="See how a saved site’s score or privacy documents changed between scans."
      current={session ? "/account/alerts" : undefined}
    >
      {!session ? (
        <AccountEmpty
          symbol="alerts"
          title="Website change alerts"
          action={
            <AccountLink href="/account?returnTo=/account/alerts">
              Sign in
            </AccountLink>
          }
        >
          Sign in to see updates for sites on your watchlist.
        </AccountEmpty>
      ) : (
        <>
          {!pro && (
            <p>
              <Link
                className="text-accent underline underline-offset-2"
                href={proPlansPath}
              >
                DataDeal Pro
              </Link>{" "}
              includes watchlist alerts.
            </p>
          )}
          {pro &&
            (alerts.length > 0 ? (
              <ul className="divide-y divide-separator [&>li]:space-y-2 [&>li]:py-4">
                {alerts.map((item) => (
                  <li key={item.scan_id}>
                    <a
                      className="text-accent underline underline-offset-2"
                      href={
                        "/report/" +
                        item.domain +
                        "?scan=" +
                        item.scan_id +
                        "#history"
                      }
                    >
                      {item.domain}
                    </a>
                    <p>
                      {item.score_before !== null && (
                        <>
                          Accept-all score changed from {item.score_before} to{" "}
                          {item.score_after} ·{" "}
                        </>
                      )}
                      {item.document_count > 0 && (
                        <>
                          {item.document_count} changed{" "}
                          {item.document_count === 1 ? "document" : "documents"}{" "}
                          ·{" "}
                        </>
                      )}
                      <time dateTime={item.created_at.toISOString()}>
                        {item.created_at.toISOString().slice(0, 10)} UTC
                      </time>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <AccountEmpty symbol="alerts" title="No changes to report">
                New alerts appear when a scan detects a score or document change
                for a saved website.
              </AccountEmpty>
            ))}
          <section className="space-y-3">
            <h2 className="text-xl font-semibold tracking-tight">
              Preferences
            </h2>
            <p>
              Enabled sites become eligible for an automatic scan after seven
              days.
            </p>
            {watches.length > 0 ? (
              <ul className="divide-y divide-separator [&>li]:space-y-2 [&>li]:py-4">
                {watches.map((item) => (
                  <li key={item.domain}>
                    <strong>{item.domain}</strong>{" "}
                    <AlertPreference
                      domain={item.domain}
                      enabled={item.document_alerts}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Save a site to your{" "}
                <Link
                  className="text-accent underline underline-offset-2"
                  href="/account/watchlist"
                >
                  watchlist
                </Link>{" "}
                to manage alerts.
              </p>
            )}
          </section>
        </>
      )}
    </AccountScreen>
  );
}
