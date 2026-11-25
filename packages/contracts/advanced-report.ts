import type { ScanReport } from "./index";
import { measuredContentVisits } from "./content-page";
export function defaultVisitEvidence(report?: ScanReport) {
  return report?.evidence.find(
    (source) =>
      source.scanId === report.id &&
      source.kind === "observed_technical" &&
      source.consentScenario === "default" &&
      source.observation?.type === "browser_consent_counts" &&
      source.observation.finalPageKnown !== false &&
      (!report.consentCoverage ||
        report.consentCoverage.default === "measured") &&
      source.observation.requests > 0,
  );
}

export function hasAdvancedSnapshotDetails(report: ScanReport | undefined) {
  if (!report || report.demo || !defaultVisitEvidence(report)) return false;
  if (!measuredContentVisits(report).next().done) return true;
  return report.evidence.some((source) => {
    if (source.scanId !== report.id) return false;
    const item = source.observation;
    return (
      (item?.type === "policy_section" &&
        Boolean(item.providerHosts?.length)) ||
      (source.kind === "observed_technical" &&
        source.consentScenario &&
        item?.type === "browser_consent_counts" &&
        item.requests > 0 &&
        item.externalDomains.length > 0)
    );
  });
}
