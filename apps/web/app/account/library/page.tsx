import { headers } from "next/headers";
import Link from "next/link";
import { buttonVariants } from "@heroui/styles";
import { proIncludedWatches } from "@datadeal/contracts/paper-plane";
import {
  describeWatchSchedule,
  watchCheckCost,
} from "@datadeal/contracts/watch-schedule";
import {
  AccountCard,
  AccountEmpty,
  AccountLink,
  AccountRow,
  AccountScreen,
  AccountSection,
} from "../account-ui";
import { auth } from "../../../lib/auth";
import { proPlansPath } from "../../../lib/checkout-return";
import { localPointsEnabled } from "../../../lib/local-reward";
import { LocalDate } from "../../../lib/local-date";
import { database } from "../../../lib/reports";
import { RecentReportList } from "../../recent-report-list";
import { bundledSiteFavicon } from "../../../lib/site-favicon";
import { RemoveSaved, SaveForm } from "./library-controls";
import { WatchButton } from "../../report/[domain]/keep-updated";

export const dynamic = "force-dynamic";

type Rated = {
  domain: string;
  score: number | null;
  grade: string;
  hasFavicon: boolean;
};

function SiteIcon({ domain, rating }: { domain: string; rating?: Rated }) {
  const src = rating?.hasFavicon
    ? `/api/v1/domains/${domain}/favicon`
    : bundledSiteFavicon(domain);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={28}
      height={28}
      className="size-7 rounded-md object-contain"
    />
  ) : (
    <span
      aria-hidden="true"
      className="grid size-7 place-items-center rounded-md bg-default text-xs font-semibold text-muted uppercase"
    >
      {domain[0]}
    </span>
  );
}

function Score({ rating }: { rating?: Rated }) {
  if (!rating || rating.score === null) return null;
  return (
    <span
      data-rating={rating.grade.toLowerCase()}
      className="rounded-lg bg-[color-mix(in_oklab,var(--rating,var(--muted))_12%,var(--surface))] px-2 py-1 text-sm font-semibold text-[var(--rating,var(--muted))] tabular-nums"
      aria-label={`${rating.score} out of 100, ${rating.grade}`}
    >
      {rating.score}
    </span>
  );
}

/**
 * Everything kept with an account: saved sites (free), reports unlocked
 * with ads or points, and the sites being watched.
 */
export default async function LibraryPage() {
  const session = await auth?.api.getSession({ headers: await headers() });
  if (!session || !database)
    return (
      <AccountScreen
        title="Library"
        description="Your saved sites and unlocked reports."
      >
        <AccountEmpty
          symbol="watchlist"
          title="Keep sites and reports"
          action={
            <AccountLink href="/account?returnTo=/account/library">
              Sign in
            </AccountLink>
          }
        >
          A free account saves sites and keeps the reports you unlock.
        </AccountEmpty>
      </AccountScreen>
    );
  const userId = session.user.id;
  const points = localPointsEnabled();
  const [pro, saved, alerts, monitors, unlocked, wallet] = await Promise.all([
    database.hasPro(userId),
    database.listWatchlist(userId),
    database.documentAlerts(userId),
    points ? database.listWatches(userId) : [],
    database.unlockedDomains(userId),
    points ? database.reportPointWallet(userId) : null,
  ]);
  const sites = [
    ...saved.map((item) => ({
      domain: item.domain,
      saved: true,
      since: item.created_at,
      proWatch: item.document_alerts,
    })),
    ...monitors
      .map((watch) => watch.domain)
      .filter((domain) => !saved.some((item) => item.domain === domain))
      .map((domain) => ({
        domain,
        saved: false,
        since: null,
        proWatch: false,
      })),
  ];
  const [ratings, unlockedReports] = await Promise.all([
    database.latestReports(sites.map((site) => site.domain)),
    database.latestReports(unlocked),
  ]);
  const rating = (domain: string) =>
    ratings.find((item) => item.domain === domain);
  const proWatches = saved.filter((item) => item.document_alerts).length;

  return (
    <AccountScreen
      title="Library"
      description="Sites you saved and reports you unlocked. Watch a site to have it rescanned regularly."
      current="/account/library"
    >
      <AccountSection
        title="Saved sites"
        description={
          pro
            ? "Watching turns on weekly rescans and an email when the score or privacy documents change."
            : points
              ? `Saving is free. Watching rechecks a site on a schedule you pick, ${watchCheckCost} points per check.`
              : "Saving is free. Watching with weekly rescans and alerts is part of Pro."
        }
        action={<SaveForm />}
      >
        {sites.length === 0 ? (
          <AccountEmpty symbol="watchlist" title="Nothing saved yet">
            Save a site above, or press Save on any report.
          </AccountEmpty>
        ) : (
          <AccountCard>
            {sites.map((site) => {
              // Pro covers a few watches; past those, sites are watched with points.
              const usePro =
                pro &&
                (site.proWatch || proWatches < proIncludedWatches || !points);
              const watching = usePro
                ? site.proWatch
                : monitors.some((watch) => watch.domain === site.domain);
              const watch = monitors.find(
                (item) => item.domain === site.domain,
              );
              return (
                <AccountRow
                  key={site.domain}
                  media={
                    <SiteIcon
                      domain={site.domain}
                      rating={rating(site.domain)}
                    />
                  }
                  title={
                    <Link
                      className="hover:underline"
                      href={"/report/" + site.domain}
                    >
                      {site.domain}
                    </Link>
                  }
                  description={
                    watching ? (
                      usePro ? (
                        "Watching · weekly rescans and email alerts"
                      ) : (
                        `Watching ${watch ? describeWatchSchedule(watch.schedule) : ""} · ${watchCheckCost} points per check`
                      )
                    ) : site.since ? (
                      <>
                        Saved <LocalDate value={site.since} />
                      </>
                    ) : (
                      "Saved"
                    )
                  }
                >
                  <Score rating={rating(site.domain)} />
                  {(pro || points) && (
                    <WatchButton
                      host={site.domain}
                      watching={watching}
                      mode={usePro ? "pro" : "points"}
                      balance={wallet?.balance ?? 0}
                      saved={site.saved}
                      schedule={watch?.schedule}
                      included={
                        usePro
                          ? { used: proWatches, limit: proIncludedWatches }
                          : undefined
                      }
                    />
                  )}
                  {site.saved && <RemoveSaved domain={site.domain} />}
                </AccountRow>
              );
            })}
          </AccountCard>
        )}
        {!pro && (
          <AccountCard>
            <AccountRow
              title="Watch without points"
              description="Pro includes watching with email alerts, ad-free reports and more."
            >
              <Link
                href={proPlansPath}
                className={buttonVariants({ size: "sm", variant: "secondary" })}
              >
                See Pro
              </Link>
            </AccountRow>
          </AccountCard>
        )}
      </AccountSection>

      <AccountSection
        title="Unlocked reports"
        description={
          pro
            ? "Pro opens every report. Reports you unlocked before stay here."
            : "Reports you opened with an ad or points. Each one is a single scan; a newer scan needs a new unlock unless you watch the site."
        }
      >
        {unlockedReports.length ? (
          <RecentReportList reports={unlockedReports} />
        ) : (
          <AccountEmpty symbol="docs" title="No unlocked reports yet">
            Open a report and watch a short ad, or use points, to keep its
            advanced view here.
          </AccountEmpty>
        )}
      </AccountSection>

      {pro && (
        <AccountSection
          title="Changes"
          description="What the latest scans of your watched sites found."
        >
          {alerts.length ? (
            <AccountCard>
              {alerts.map((item) => (
                <AccountRow
                  key={item.scan_id}
                  title={item.domain}
                  description={
                    <>
                      {item.score_before !== null &&
                        `Score ${item.score_before} → ${item.score_after} · `}
                      {item.document_count > 0 &&
                        `${item.document_count} changed ${item.document_count === 1 ? "document" : "documents"} · `}
                      <LocalDate value={item.created_at} />
                    </>
                  }
                >
                  <Link
                    className={buttonVariants({ size: "sm", variant: "ghost" })}
                    href={`/report/${item.domain}?scan=${item.scan_id}#history`}
                  >
                    View
                  </Link>
                </AccountRow>
              ))}
            </AccountCard>
          ) : (
            <AccountEmpty symbol="alerts" title="No changes yet">
              When a rescan finds a new score or changed documents, it shows up
              here.
            </AccountEmpty>
          )}
        </AccountSection>
      )}
    </AccountScreen>
  );
}
