import {
  isEuropean,
  type PublishedScoring,
  type ScanReport,
} from "@datadeal/contracts";

/** At-a-glance facts about a rated report, shown as icons. */
export type ReportSignals = {
  scenario: "accepted" | "no_choice";
  beforeChoice: boolean;
  advertising: boolean;
  outsideEu: boolean;
  host?: { name: string; country: string };
  noPolicy: boolean;
};

const advertisingPurposes = new Set([
  "advertising",
  "personalization",
  "social",
]);

export function reportSignals(
  report: ScanReport,
  rating: PublishedScoring,
): ReportSignals {
  const costs = rating.inventoryAssessment?.costs ?? [];
  const classified = new Map(
    (report.storageInventory?.classifications ?? []).map((c) => [c.itemId, c]),
  );
  const hosting = report.evidence.find(
    (e) => e.scanId === report.id && e.observation?.type === "hosting",
  )?.observation;
  const host =
    hosting?.type === "hosting" ? (hosting.cdn ?? hosting.host) : undefined;
  return {
    scenario: rating.noChoiceEvidence ? "no_choice" : "accepted",
    beforeChoice: costs.some((c) => c.consentPenalty && c.cost > 0),
    advertising: costs.some((c) =>
      advertisingPurposes.has(classified.get(c.itemId)?.purpose ?? ""),
    ),
    outsideEu:
      costs.some((c) => c.outsideEu) ||
      (!!host?.country && !isEuropean(host.country)),
    ...(host && { host }),
    // From the rating itself, so the icon matches what the score charged.
    noPolicy: costs.some(({ itemId }) => itemId === "policy-missing"),
  };
}
