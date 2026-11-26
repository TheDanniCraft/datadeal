import Link from "next/link";
import { buttonVariants } from "@heroui/styles";
import type { ReactNode } from "react";
import { database } from "../../lib/reports";
import { proPlansPath } from "../../lib/checkout-return";
import { RecentReportList } from "../recent-report-list";
import { AccountEmpty, AccountIcon } from "./account-ui";
import type { AccountSymbol } from "./account-icon";
import { pointOperations } from "./rewards/operations";
import { monitorDailyCost } from "@datadeal/contracts/paper-plane";
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
  const [billing, wallet, unlocked, watchlist, monitors] = await Promise.all([
    database.billingSummary(userId),
    points ? database.reportPointWallet(userId) : null,
    database.unlockedDomains(userId),
    database.listWatchlist(userId),
    points ? database.listMonitors(userId) : [],
  ]);
  const pro = Boolean(billing?.has_access);
  const watched = watchlist.map((item) => item.domain);
  const [unlockedReports, watchedReports, monitoredReports] = await Promise.all(
    [
      database.latestReports(unlocked),
      database.latestReports(watched.slice(0, 6)),
      database.latestReports(monitors),
    ],
  );
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
            icon="points"
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

      {wallet && (
        <div className="-mt-4 flex flex-wrap gap-2">
          <Link
            href="/account/rewards#fly"
            className={buttonVariants({ size: "sm", className: "gap-2" })}
          >
            <AccountIcon name="points" />
            Get more points
          </Link>
          {wallet.tickets.length > 0 && (
            <span className="self-center text-sm text-muted">
              {wallet.tickets.length === 1
                ? "1 free flight waiting"
                : `${wallet.tickets.length} free flights waiting`}
            </span>
          )}
        </div>
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

      {monitoredReports.length > 0 && (
        <Section title="Kept updated">
          <p className="m-0 -mt-1 text-sm text-muted">
            Rescanned every week for {monitorDailyCost} points a day each. Stop
            from the report&apos;s Keep updated button.
          </p>
          <RecentReportList reports={monitoredReports} />
        </Section>
      )}

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
