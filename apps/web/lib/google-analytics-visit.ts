import type { ScanReport } from "@datadeal/contracts";
import {
  acceptAllHomepage,
  isReportOrigin,
} from "@datadeal/contracts/content-page";

// A response domain spans the entire run. Even in a confirmed accept-all run,
// it cannot locate the response before or after the click or identify its payload.
export function googleAnalyticsVisit(report: ScanReport) {
  const accepted = acceptAllHomepage(report);
  const scenario = accepted ? "accepted" : "default";
  if (report.consentCoverage?.[scenario] !== "measured") return;
  const rows = report.evidence.filter(
    (row) =>
      row.scanId === report.id &&
      row.kind === "observed_technical" &&
      row.consentScenario === scenario &&
      row.observation?.type === "browser_consent_counts",
  );
  if (rows.length !== 1) return;
  const source = rows[0]!;
  const url = source.url && URL.parse(source.url);
  const visit = source.observation;
  if (
    !url ||
    !isReportOrigin(url.origin, report.domain) ||
    visit?.type !== "browser_consent_counts" ||
    !visit.finalPageKnown ||
    !visit.freshContext ||
    visit.requests < 1 ||
    (!accepted && visit.afterChoice) ||
    !visit.externalDomains.includes("google-analytics.com") ||
    !visit.responseDomains?.includes("google-analytics.com")
  )
    return;
  const end = visit.storageSummary?.end.cookies;
  if (!end || end.total !== visit.cookies || end.inspected < 1) return;
  const cookie = end.recognized.find(
    (c) =>
      c.name === "_ga" &&
      c.valueShape === "analytics_client_format" &&
      c.persistent &&
      c.scope === "same_site" &&
      c.site &&
      (url.hostname === c.site || url.hostname.endsWith("." + c.site)),
  );
  if (!cookie) return;
  const contact = accepted
    ? "Our browser contacted Google Analytics during the homepage visit where we accepted all cookies."
    : "On the homepage, our browser contacted Google Analytics without making a cookie choice.";
  return {
    text: `${contact} It ended the visit with a persistent analytics cookie that can distinguish a returning browser.`,
    source: source.id,
    label: accepted
      ? "Google Analytics in the accept-all visit"
      : "Google Analytics before a cookie choice",
    quote: `google-analytics.com returned an HTTP response during this visit. At the end, ${cookie.site} had a persistent _ga cookie in the Google Analytics client-ID format.`,
  };
}
