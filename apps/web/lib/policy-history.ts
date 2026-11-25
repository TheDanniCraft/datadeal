import type { Evidence, ScanReport } from "@datadeal/contracts";

type Topic = "sharing" | "purpose" | "transfers";
type PolicySource = { scanId: string; evidenceId: string; href: string };
export type PolicyDisclosureChange = {
  topic: Topic;
  heading: string;
  url: string;
  quote: string;
  previous: PolicySource;
  current: PolicySource;
};

const normalize = (text: string) =>
  text.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
function sourceLink(report: ScanReport, source: Evidence): PolicySource {
  return {
    scanId: report.id,
    evidenceId: source.id,
    href: `/report/${encodeURIComponent(report.domain)}?scan=${encodeURIComponent(report.id)}#evidence-${encodeURIComponent(source.id)}`,
  };
}

function savedSections(report: ScanReport) {
  const sections = new Map<
    string,
    {
      root: Evidence;
      section: Evidence;
      passages: string[];
      topic: Topic;
      heading: string;
    } | null
  >();
  const sources = report.evidence.filter(
    (row) => row.scanId === report.id && row.kind === "declared_first_party",
  );
  for (const section of sources) {
    const info = section.observation;
    if (
      info?.type !== "policy_section" ||
      !section.url ||
      !section.language ||
      (info.topic !== "sharing" &&
        info.topic !== "purpose" &&
        info.topic !== "transfers")
    )
      continue;
    const roots = sources.filter(
      (row) =>
        !row.observation &&
        row.url === section.url &&
        row.documentKind === "privacy" &&
        row.language === section.language,
    );
    if (roots.length !== 1) continue;
    const [root] = roots;
    const heading = info.heading;
    const key = JSON.stringify([
      section.url,
      section.language,
      normalize(heading),
      info.topic,
    ]);
    if (sections.has(key)) {
      sections.set(key, null);
      continue;
    }
    const layout = root.documentLayout;
    if (!layout || !root.hash) continue;
    const headingIndexes = layout.flatMap((block, i) =>
      block.kind === "heading" &&
      normalize(root.excerpt.slice(block.start, block.end)) ===
        normalize(heading)
        ? [i]
        : [],
    );
    if (headingIndexes.length !== 1) continue;
    const start = headingIndexes[0] + 1;
    const end = layout.findIndex(
      (block, i) =>
        i >= start && (block.kind === "heading" || block.kind === "title"),
    );
    // Captures can stop at 4,000 characters. Only compare a section whose
    // closing boundary and contents are present in both extraction formats.
    if (end <= start) continue;
    const blocks = layout.slice(start, end);
    if (blocks.some((b) => b.kind !== "paragraph" && b.kind !== "item"))
      continue;
    const passages = blocks.map((b) => root.excerpt.slice(b.start, b.end));
    if (normalize(passages.join(" ")) !== normalize(section.excerpt)) continue;
    sections.set(key, { root, section, passages, topic: info.topic, heading });
  }
  return sections;
}

function supportsStatement(
  report: ScanReport,
  source: Evidence,
  topic: Topic,
  passage: string,
) {
  if (topic === "transfers") {
    // Transfer sections have no corresponding AI claim category. Require a
    // transfer statement in the paragraph itself and preserve all qualifiers.
    return (
      /\b(?:data|information|details)\b/iu.test(passage) &&
      /\btransfer(?:red|ring|s)?\b/iu.test(passage) &&
      /\b(?:countries|country|outside|international(?:ly)?|cross.border|abroad|overseas|eea|european economic area)\b/iu.test(
        passage,
      )
    );
  }
  return (
    report.policyClaims?.some(
      (claim) =>
        claim.category === (topic === "sharing" ? "recipient" : "purpose") &&
        claim.source === source.id &&
        claim.confidence !== "low" &&
        claim.quote.trim().length >= 18 &&
        passage.includes(claim.quote),
    ) ?? false
  );
}

export function comparePolicyDisclosures(
  previous: ScanReport,
  current: ScanReport,
): PolicyDisclosureChange[] {
  const changes: PolicyDisclosureChange[] = [];
  if (
    previous.demo ||
    current.demo ||
    previous.id === current.id ||
    previous.domain !== current.domain ||
    !(Date.parse(previous.completedAt) < Date.parse(current.completedAt))
  )
    return changes;
  const earlier = savedSections(previous);
  for (const [key, after] of savedSections(current)) {
    const before = earlier.get(key);
    if (!before || !after || before.root.hash === after.root.hash) continue;
    const prior = before.passages.map(normalize);
    const additions: string[] = [];
    let cursor = 0;
    for (const passage of after.passages) {
      const text = normalize(passage);
      if (text === prior[cursor]) cursor++;
      else if (!prior.includes(text)) additions.push(passage);
    }
    // A replacement or removal needs interpretation. Report only insertions
    // surrounded by preserved earlier material, quoting the full new block.
    if (cursor !== prior.length) continue;
    const previouslyCaptured = previous.evidence
      .filter(
        (row) =>
          row.scanId === previous.id &&
          row.kind === "declared_first_party" &&
          row.url === before.root.url,
      )
      .map((row) => normalize(row.excerpt));
    for (const quote of additions) {
      if (
        quote.length < 18 ||
        quote.length > 400 ||
        !after.section.excerpt.includes(quote) ||
        previouslyCaptured.some((text) => text.includes(normalize(quote))) ||
        !supportsStatement(current, after.section, after.topic, quote) ||
        changes.some((item) => normalize(item.quote) === normalize(quote))
      )
        continue;
      changes.push({
        topic: after.topic,
        url: after.section.url!,
        heading: after.heading,
        quote,
        previous: sourceLink(previous, before.section),
        current: sourceLink(current, after.section),
      });
      if (changes.length === 4) return changes;
    }
  }
  return changes;
}
