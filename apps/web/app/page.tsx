import { connection } from "next/server";
import { DomainSearch } from "./search";
import { RecentReportList } from "./recent-report-list";
import { database } from "../lib/reports";

export default async function Home() {
  await connection();
  // Only rated sites: an unrated report says little on a landing page.
  const recent = ((await database?.recentPublishedDomains()) ?? []).filter(
    ({ score }) => score !== null,
  );
  return (
    <>
      <section className="pt-12 pb-8 md:pt-16 md:pb-12">
        <p className="mb-3 text-xs font-semibold tracking-widest text-accent uppercase">
          Website privacy reports
        </p>
        <h1 className="text-[clamp(2.45rem,6vw,5.4rem)] leading-[1.08] font-bold tracking-tight">
          Know the deal <br />
          before you sign up.
        </h1>
        <p className="mt-5 mb-8 max-w-2xl text-base leading-relaxed text-muted md:text-xl">
          Enter a website to see what its privacy policy says it collects, who
          may receive it, and what DataDeal observed in a scan.
        </p>
        <DomainSearch />
      </section>
      {recent.length > 0 && (
        <section className="mb-16" id="recent-reports">
          <h2 className="mb-4 text-2xl font-semibold">Recent reports</h2>
          <RecentReportList reports={recent.slice(0, 6)} />
        </section>
      )}
    </>
  );
}
