import { database } from "./database";
import { domain, scanReport, siteDomain } from "@datadeal/contracts";
import { evaluateHeadline } from "@datadeal/scoring";
import {
  scopedHostingEvidence,
  unsupportedHostingSummary,
} from "@datadeal/contracts/hosting-disclosure";
import { demos } from "./fixtures";

export { database };
export const demoMode =
  process.env.NODE_ENV !== "production" &&
  process.env.DATADEAL_BROWSER_TEST === "true" &&
  process.env.DATADEAL_DEMO === "true";

export function selectPublishedReport(
  history: readonly { state: string; report: unknown }[],
  includeDemo: boolean,
) {
  for (const row of history) {
    if (row.state !== "completed" && row.state !== "partially_completed")
      continue;
    const parsed = scanReport.safeParse(row.report);
    if (!parsed.success || (!includeDemo && parsed.data.demo)) continue;
    const report = parsed.data;
    report.evidence = scopedHostingEvidence(report.evidence);
    const eligible = (item: {
      text: string;
      quote?: string;
      source: string;
    }) => {
      const source = report.evidence.find((row) => row.id === item.source);
      return (
        source &&
        !unsupportedHostingSummary(item.text, item.quote ?? "", source.excerpt)
      );
    };
    const brief = report.policyBrief?.filter(eligible);
    report.policyBrief = brief?.length ? brief : undefined;
    const claims = report.policyClaims?.filter(eligible);
    report.policyClaims = claims?.length ? claims : undefined;
    if (report.policySummaryAddendum) {
      const items = report.policySummaryAddendum.items.filter(eligible);
      report.policySummaryAddendum = items.length
        ? { ...report.policySummaryAddendum, items }
        : undefined;
    }
    const score = evaluateHeadline(report).rating;
    return { report, score };
  }
  return {
    report: undefined,
    score: null,
  };
}

export async function lookup(input: string) {
  const host = siteDomain.parse(input);
  const history = (await database?.list(host)) ?? [];
  let { report, score } = selectPublishedReport(history, demoMode);
  let cursor = history.length === 20 ? history.at(-1)?.id : undefined;
  // Activity history is bounded. Keep the last rating even if it has aged
  // out of that window after repeated failed or incomplete scans.
  while (database && cursor && !report) {
    const older = await database.olderPublishedReports(host, cursor);
    const selection = selectPublishedReport(older, demoMode);
    if (selection.report) {
      report = selection.report;
      score = selection.score;
    }
    cursor = older.at(-1)?.id;
  }
  const demo =
    !report && demoMode
      ? demos.find((item) => item.domain === host)
      : undefined;
  return {
    host,
    report: report ?? demo,
    score: score ?? (demo ? evaluateHeadline(demo).rating : null),
    history,
  };
}
