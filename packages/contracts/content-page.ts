import type { Evidence, ScanReport } from "./index";

export function isReportOrigin(origin: string, domain: string) {
  return (
    origin === "https://" + domain ||
    (!domain.startsWith("www.") && origin === "https://www." + domain)
  );
}

export function acceptAllHomepage(report?: ScanReport) {
  if (!report || report.consentCoverage?.accepted !== "measured") return;
  const visits = report.evidence.filter(
    (row) =>
      row.scanId === report.id &&
      row.kind === "observed_technical" &&
      row.consentScenario === "accepted" &&
      row.observation?.type === "browser_consent_counts",
  );
  if (visits.length !== 1) return;
  const source = visits[0];
  const visit = source.observation;
  const url = source.url && URL.parse(source.url);
  if (
    visit?.type !== "browser_consent_counts" ||
    !url ||
    !isReportOrigin(url.origin, report.domain) ||
    !visit.finalPageKnown ||
    !visit.afterChoice?.acceptedAll ||
    !visit.requests ||
    visit.afterChoice.requests > visit.requests
  )
    return;
  return { source, visit };
}

export function* measuredContentVisits(report?: ScanReport) {
  if (!report?.pageSample) return;
  for (const index of report.pageSample.pages.keys()) {
    for (const scenario of ["default", "rejected", "accepted"] as const) {
      const run = measuredContentPage(report, index, scenario);
      if (run) yield run;
    }
  }
}

export function measuredContentPage(
  report: ScanReport,
  index: number,
  scenario: NonNullable<Evidence["consentScenario"]>,
) {
  const page = report.pageSample?.pages[index];
  if (page?.coverage[scenario] !== "measured") return;
  const selected = new URL(page.url);
  if (!isReportOrigin(selected.origin, report.domain)) return;
  const source = report.evidence.find(
    (item) =>
      item.id === `browser-page-${index + 1}-${scenario}` &&
      item.scanId === report.id &&
      item.kind === "observed_technical" &&
      item.consentScenario === scenario,
  );
  const visit = source?.observation;
  if (
    !source?.url ||
    visit?.type !== "browser_content_page" ||
    visit.requests === 0 ||
    visit.finalPageKnown === false
  )
    return;
  const landed = new URL(source.url);
  if (landed.origin !== selected.origin) return;
  return { source, visit, landed };
}
