import Link from "next/link";
import { buttonVariants } from "@heroui/styles";
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
        <h2 className="m-0 text-base font-semibold">{title}</h2>
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
  const [billing, wallet, unlocked, saved, monitors] = await Promise.all([
    database.billingSummary(userId),
    points ? database.reportPointWallet(userId) : null,
    database.unlockedDomains(userId),
    database.listWatchlist(userId),
    points ? database.listMonitors(userId) : [],
  ]);
  const pro = Boolean(billing?.has_access);
  // Pro watches and points watches together, each site counted once.
  const watching = new Set([
    ...(pro
      ? saved.filter((item) => item.document_alerts).map((item) => item.domain)
      : []),
    ...monitors,
  ]).size;
  const recent = await database.latestReports(unlocked.slice(0, 4));
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
            label="Points"
            value={wallet.balance.toLocaleString("en")}
            note={
              lastPoints
                ? `${lastPoints.delta > 0 ? "+" : ""}${lastPoints.delta} · ${pointOperations[lastPoints.operation] ?? "Points"}`
                : "Earned with ads and flights"
            }
          />
        )}
        <Tile
          href="/account/library"
          icon="watchlist"
          label="Saved sites"
          value={String(saved.length)}
          note={watching ? `${watching} watched` : "in your library"}
        />
        <Tile
          href="/account/library"
          icon="docs"
          label="Unlocked reports"
          value={pro ? "All" : String(unlocked.length)}
          note={pro ? "included with Pro" : "in your library"}
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

      <Section
        title="Recently unlocked"
        action={
          <Link className="inline-link text-sm" href="/account/library">
            Open library
          </Link>
        }
      >
        {recent.length ? (
          <RecentReportList reports={recent} />
        ) : (
          <AccountEmpty
            symbol="docs"
            title={
              pro ? "Every report is open to you" : "No unlocked reports yet"
            }
          >
            {pro
              ? "Pro includes the advanced view of every report."
              : "Open a report and watch a short ad, or spend points, to keep its advanced view."}
          </AccountEmpty>
        )}
      </Section>
    </div>
  );
}
