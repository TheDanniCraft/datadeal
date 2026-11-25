import type { ScanReport } from "@datadeal/contracts";
import {
  adPersonalizationDisclosure,
  consentedAdvertisingDisclosure,
} from "@datadeal/scoring";

type Highlight = Omit<
  NonNullable<ScanReport["policyBrief"]>[number],
  "topic"
> & {
  topic: NonNullable<ScanReport["policyBrief"]>[number]["topic"] | "retention";
  title?: string;
};

function visitorDecisionPriority(item: Highlight) {
  const conditional =
    /\b(?:if|when|after|once) you\b|\bwhen (?:signing up|booking|submitting|subscribing)\b/i.test(
      item.quote ?? "",
    );
  if (!item.title && !conditional) return 3;
  if (item.topic === "collection") return 0;
  if (item.topic === "sharing") return 1;
  return 2;
}

export function publicPolicyHighlights(report: ScanReport): Highlight[] {
  const sources = new Map(report.evidence.map((source) => [source.id, source]));
  const brief: Highlight[] = [];
  for (const item of report.policyBrief ??
    report.policySummaryAddendum?.items ??
    []) {
    const source = sources.get(item.source);
    if (
      !source ||
      source.scanId !== report.id ||
      source.kind !== "declared_first_party" ||
      source.observation?.type !== "policy_section" ||
      source.observation.topic !== item.topic ||
      !item.quote ||
      !source.excerpt.includes(item.quote)
    )
      continue;

    const context = `${source.observation.heading} ${item.quote}`;
    let title: string | undefined;
    if (
      item.topic === "collection" &&
      /\b(?:contact|inquiry|enquiry|support) form\b/i.test(context)
    ) {
      title = "Contact form";
    } else if (
      item.topic === "sharing" &&
      /\bbooking\b/i.test(context) &&
      /\b(?:optional|can open)\b/i.test(context)
    ) {
      title = "Appointment booking";
    }
    brief.push({ ...item, ...(title ? { title } : {}) });
  }
  if (!brief.length) {
    const topics = {
      data_category: "collection",
      purpose: "purpose",
      recipient: "sharing",
      retention: "retention",
    } as const;
    for (const item of report.policyClaims ?? []) {
      const source = sources.get(item.source);
      const topic = topics[item.category];
      if (
        item.confidence === "low" ||
        !item.quote ||
        source?.scanId !== report.id ||
        source.kind !== "declared_first_party" ||
        source.observation?.type !== "policy_section" ||
        source.observation.topic !== topic ||
        !source.excerpt.includes(item.quote) ||
        brief.some((highlight) => highlight.topic === topic)
      )
        continue;
      // Keep the complete claim, including any exceptions. Longer claims remain in the detail view.
      if (item.text.length <= 230)
        brief.push({
          topic,
          source: item.source,
          text: item.text,
          quote: item.quote,
        });
    }
  }
  // Put signup and feature decisions ahead of general processing descriptions.
  brief.sort((a, b) => visitorDecisionPriority(a) - visitorDecisionPriority(b));
  const advertisingSources = (
    report.scoringCorrection?.result ?? report.scoring
  )?.adjustments.find(
    ({ rule, adjustment }) =>
      rule === "declared_advertising_sharing" && adjustment < 0,
  )?.evidenceIds;
  const scoredSharing = brief.find(
    ({ topic, source }) =>
      topic === "sharing" && advertisingSources?.includes(source),
  );
  const advertising = consentedAdvertisingDisclosure(report);
  if (advertising)
    return [
      {
        source: advertising.id,
        topic: "sharing",
        title: "Advertising and tracking",
        text: "The policy says that opting in lets third-party advertising services use identifiers under their own responsibility.",
      },
      ...brief.filter(({ topic }) => topic !== "sharing"),
    ];
  if (scoredSharing)
    return [scoredSharing, ...brief.filter((item) => item !== scoredSharing)];
  const personalization = adPersonalizationDisclosure(report);
  return personalization
    ? [
        {
          source: personalization.id,
          topic: "purpose",
          title: "Ad personalization",
          text: "Depending on your settings, the policy describes using your interests to personalize ads.",
        },
        ...brief.filter(({ topic }) => topic !== "purpose"),
      ]
    : brief;
}
