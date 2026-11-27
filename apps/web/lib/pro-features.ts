import type { PublishedScoring, ScanReport } from "@datadeal/contracts";

export type ProFeature = { label: string; detail: string };

const plural = (count: number, one: string, many = one + "s") =>
  `${count} ${count === 1 ? one : many}`;

/**
 * What the full report holds for this site, counted from the complete scan
 * on the server: free readers only receive a trimmed copy of the report.
 */
export function proFeatures(
  report: ScanReport | undefined,
  score: PublishedScoring | null | undefined,
  pages: number,
  scans: number,
): ProFeature[] {
  if (!report) return [];
  const own = report.evidence.filter((e) => e.scanId === report.id);
  const outside = new Set(
    own.flatMap((e) =>
      e.observation?.type === "browser_consent_counts" ||
      e.observation?.type === "browser_content_page"
        ? e.observation.externalDomains
        : [],
    ),
  );
  const items = score?.inventoryAssessment?.breakdown
    ? score.inventoryAssessment.breakdown.otherItems + 1
    : 0;
  const choices = Object.values(report.consentCoverage ?? {}).filter(
    (value) => value === "measured",
  ).length;
  const sections = new Set(
    own.flatMap((e) =>
      e.observation?.type === "policy_section" && e.observation.topic
        ? [e.observation.heading]
        : [],
    ),
  );
  const features: (ProFeature | false)[] = [
    outside.size > 0 && {
      label: "Data-flow map",
      detail: `${plural(outside.size, "connection")}, each explained`,
    },
    items > 5 && {
      label: "Full score breakdown",
      detail: `All ${items} items that lower the score`,
    },
    choices > 1 && {
      label: "Consent comparison",
      detail: `${plural(choices, "cookie choice")} side by side`,
    },
    pages > 0 && {
      label: "Other pages",
      detail: `${plural(pages, "more page")} compared with the homepage`,
    },
    sections.size > 0 && {
      label: "Privacy policy by topic",
      detail: `${plural(sections.size, "section")} with the quoted text`,
    },
    own.length > 0 && {
      label: "All evidence",
      detail: plural(own.length, "recorded source"),
    },
    scans > 1 && {
      label: "Scan history",
      detail: `${scans} scans compared over time`,
    },
  ];
  return features.filter((feature): feature is ProFeature => !!feature);
}
