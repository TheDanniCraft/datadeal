import Link from "next/link";
import type { ReactNode } from "react";
import { database } from "../../lib/reports";
import { proPlansPath } from "../../lib/checkout-return";
import { RecentReportList } from "../recent-report-list";
import { AccountEmpty, AccountIcon } from "./account-ui";
import type { AccountSymbol } from "./account-icon";
import { pointOperations } from "./rewards/operations";
import { LocalDate } from "../../lib/local-date";

function Tile({
  href,
  icon,
  label,
  value,
  note,
}: {
  href: string;
  icon: AccountSymbol;
  label: string;
  value: string;
  note: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group grid content-start gap-1 rounded-2xl border border-separator p-4 transition-colors hover:bg-surface-secondary"
    >
      <span className="flex items-center gap-2 text-xs text-muted">
        <AccountIcon name={icon} />
        {label}
      </span>
      <span className="mt-1 text-2xl leading-none font-semibold tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted">{note}</span>
    </Link>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The signed-in account home: plan, points, reports and followed sites. */
export async function AccountOverview({
  userId,
  points,
}: {
  userId: string;
  points: boolean;
}) {
  if (!database) return null;
  const [billing, wallet, unlocked, watchlist] = await Promise.all([
    database.billingSummary(userId),
    points ? database.reportPointWallet(userId) : null,
    database.unlockedDomains(userId),
    database.listWatchlist(userId),
  ]);
  const pro = Boolean(billing?.has_access);
  const watched = watchlist.map((item) => item.domain);
  const [unlockedReports, watchedReports] = await Promise.all([
    database.latestReports(unlocked),
    database.latestReports(watched.slice(0, 6)),
  ]);
  const lastPoints = wallet?.activity[0];

  return (
    <div className="grid gap-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          href={pro ? "/account/billing" : proPlansPath}
          icon="billing"
          label="Plan"
          value={pro ? "Pro" : "Free"}
          note={
            pro && billing ? (
              <>
                {billing.status === "canceled" ? "Ends " : "Renews "}
                <LocalDate value={billing.access_until} />
              </>
            ) : (
              "See what Pro adds"
            )
          }
        />
        {wallet && (
          <Tile
            href="/account/rewards"
            icon="rewards"
            label="Report points"
            value={String(wallet.balance)}
            note={
              lastPoints
                ? `${lastPoints.delta > 0 ? "+" : ""}${lastPoints.delta} · ${pointOperations[lastPoints.operation] ?? "Points"}`
                : "Earned with ads and flights"
            }
          />
        )}
        <Tile
          href="#unlocked-reports"
          icon="docs"
          label="Unlocked reports"
          value={pro ? "All" : String(unlocked.length)}
          note={pro ? "included with Pro" : "advanced reports"}
        />
        <Tile
          href="/account/watchlist"
          icon="watchlist"
          label="Watchlist"
          value={String(watched.length)}
          note={
            pro
              ? watched.length === 1
                ? "site you follow"
                : "sites you follow"
              : "needs Pro"
          }
        />
      </div>

      {wallet && wallet.tickets.length > 0 && (
        <section
          aria-label="Waiting flights"
          className="grid gap-2 rounded-2xl border border-accent/40 bg-accent/5 p-4"
        >
          <p className="m-0 text-sm font-medium">
            {wallet.tickets.length === 1
              ? "A paper-plane flight is waiting for you"
              : `${wallet.tickets.length} paper-plane flights are waiting for you`}
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm">
            {wallet.tickets.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  className="inline-link"
                  href={"/report/" + ticket.domain + "?reward=" + ticket.id}
                >
                  {ticket.state === "choose" ? "Choose reward" : "Fly"} ·{" "}
                  {ticket.domain}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div id="unlocked-reports" className="scroll-mt-24">
        <Section title="Unlocked reports">
          {unlockedReports.length ? (
            <RecentReportList reports={unlockedReports} />
          ) : (
            <AccountEmpty
              symbol="docs"
              title={
                pro ? "Every report is open to you" : "No unlocked reports yet"
              }
            >
              {pro
                ? "Pro includes the advanced view of every report."
                : "Open a report and watch a short ad, or spend report points, to see its advanced view."}
            </AccountEmpty>
          )}
        </Section>
      </div>

      {pro && (
        <Section
          title="Watchlist"
          action={
            watched.length > 0 && (
              <Link className="inline-link text-sm" href="/account/watchlist">
                {watched.length > watchedReports.length
                  ? `Manage all ${watched.length}`
                  : "Manage"}
              </Link>
            )
          }
        >
          {watchedReports.length ? (
            <RecentReportList reports={watchedReports} />
          ) : (
            <AccountEmpty symbol="watchlist" title="You follow no sites yet">
              Save a site from its report to see its rating here and get an
              email when its privacy documents change.
            </AccountEmpty>
          )}
        </Section>
      )}
    </div>
  );
}
