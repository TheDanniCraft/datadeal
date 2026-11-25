import { browser } from "wxt/browser";
import type { DomainLookup } from "@datadeal/contracts";

export const gradeColors = {
  Excellent: "#166534",
  Good: "#09655f",
  Mixed: "#825600",
  Concerning: "#a34413",
  Poor: "#ab302e",
  Critical: "#8e1938",
};
export type Rating = { score: number; grade: keyof typeof gradeColors };

/** Older API responses may contain a score for a different consent scenario. */
export function comparableReport(
  report: DomainLookup["report"],
): DomainLookup["report"] {
  if (
    !report ||
    report.score === null ||
    report.headlineScenario === "accepted" ||
    (report.headlineScenario === "default" && report.noChoiceVisit)
  )
    return report;
  return {
    ...report,
    score: null,
    grade: "Unrated",
    confidence: "Low",
    headlineScenario: undefined,
    verdict:
      "A comparable rating after accepting all optional features is unavailable.",
  };
}

export function publishedRating(report: DomainLookup["report"]): Rating | null {
  if (
    !report ||
    report.demo ||
    (report.headlineScenario !== "accepted" &&
      !(report.headlineScenario === "default" && report.noChoiceVisit)) ||
    report.score === null ||
    !Number.isInteger(report.score) ||
    !Object.hasOwn(gradeColors, report.grade)
  )
    return null;
  return { score: report.score, grade: report.grade as Rating["grade"] };
}

export async function publishPopupRating(
  tabId: number | undefined,
  domain: string,
  result: DomainLookup,
) {
  if (tabId === undefined || result.domain !== domain) return;
  // Badge support is independent of rendering the report in the popup.
  try {
    await browser.runtime.sendMessage({
      type: "popup-report-score",
      tabId,
      domain,
      rating: publishedRating(result.report),
    });
  } catch {}
}
