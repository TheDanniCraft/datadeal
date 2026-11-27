import type { Metadata } from "next";
import { connection } from "next/server";
import { DomainSearch } from "../search";
import { RecentReportList } from "../recent-report-list";
import { database } from "../../lib/reports";

export const metadata: Metadata = {
  title: "All reports",
  description:
    "Privacy ratings of websites DataDeal scanned recently, free to open.",
};

/** Every rated site scanned lately, so new visitors can see what DataDeal finds. */
export default async function ReportsPage() {
  await connection();
  const reports = (
    (await database?.recentPublishedDomains({ limit: 200 })) ?? []
  ).filter(({ score }) => score !== null);
  return (
    <div className="grid gap-8 py-10 md:py-14">
      <header className="grid gap-3">
        <h1 className="m-0 text-3xl font-semibold tracking-tight md:text-4xl">
          All reports
        </h1>
        <p className="m-0 max-w-prose text-sm leading-relaxed text-muted">
          {reports.length} sites scanned in the last 90 days, newest first.
          Every report is free to open; the advanced view is a short ad away.
        </p>
        <div className="max-w-xl">
          <DomainSearch />
        </div>
      </header>
      {reports.length ? (
        <RecentReportList reports={reports} />
      ) : (
        <p className="m-0 text-sm text-muted">
          No reports yet. Check a website above to create the first one.
        </p>
      )}
    </div>
  );
}
