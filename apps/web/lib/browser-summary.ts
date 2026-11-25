type Inspection = { examined: number; matched: number; limitReached: boolean };

export function inspectionSummary(inspection?: Inspection) {
  if (!inspection) return "Request contents were not inspected in this scan.";
  return (
    `Inspected ${inspection.examined} HTTP requests; ${inspection.matched} matched recognized data fields.` +
    (inspection.limitReached ? " The inspection limit was reached." : "")
  );
}

export function summarizeDefaultVisit({
  outside,
  noCookies,
  noStorage,
}: {
  outside: number;
  noCookies?: boolean;
  noStorage?: boolean;
}) {
  if (outside > 0) {
    const count = outside === 20 ? "at least 20" : outside;
    const unit = outside === 1 ? "domain" : "domains";
    return `During the tested homepage visit, the browser tried to reach ${count} outside ${unit}.`;
  }
  const storage = noCookies
    ? noStorage
      ? " and found no cookies or browser storage at the end"
      : " and found no cookies at the end"
    : "";
  return `On the tested homepage, we saw no requests to outside domains${storage}.`;
}

export {
  defaultVisitEvidence,
  hasAdvancedSnapshotDetails,
} from "@datadeal/contracts/advanced-report";
