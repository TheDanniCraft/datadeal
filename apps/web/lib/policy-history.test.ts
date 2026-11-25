import { expect, it } from "vitest";
import type { Evidence, ScanReport } from "@datadeal/contracts";
import { comparePolicyDisclosures } from "./policy-history";

const retained =
  "We share details with the service that sends your booking confirmation.";
const statement =
  "When you book, we also send your email address to Example Calendar.";
const purpose =
  "If you opt in, we also use your booking dates to suggest other events.";
const transfer =
  "For support, we may transfer contact information outside the European Economic Area.";

function snapshot(
  later: boolean,
  passages: string[],
  topic: "sharing" | "purpose" | "transfers" = "sharing",
) {
  const id = later
    ? "05050505-0000-4000-8000-000000000002"
    : "05050505-0000-4000-8000-000000000001";
  const date = (later ? "2026-11-25" : "2026-11-24") + "T11:00:00Z";
  const heading = {
    sharing: "Who receives your information",
    purpose: "Why we process data",
    transfers: "International transfers",
  }[topic];
  const url = "https://example.com/privacy";
  const parts = ["Privacy policy", heading, ...passages, "Your rights"];
  const layout: NonNullable<Evidence["documentLayout"]> = [];
  let cursor = 0;
  for (const [index, text] of parts.entries()) {
    layout.push({
      kind:
        index === 0
          ? "title"
          : index === 1 || index === parts.length - 1
            ? "heading"
            : "paragraph",
      start: cursor,
      end: cursor + text.length,
    });
    cursor += text.length + 2;
  }
  const root: Evidence = {
    id: "document-1",
    kind: "declared_first_party",
    url,
    language: "en",
    documentKind: "privacy",
    hash: later ? "new" : "old",
    excerpt: parts.join("\n\n"),
    documentLayout: layout,
    retrievedAt: date,
    scanId: id,
  };
  const section: Evidence = {
    id: "document-1-section-1",
    kind: "declared_first_party",
    url,
    language: "en",
    retrievedAt: date,
    scanId: id,
    excerpt: passages.join(" "),
    observation: { type: "policy_section", heading, topic },
  };
  const report: ScanReport = {
    domain: "example.com",
    id,
    completedAt: date,
    demo: false,
    partial: false,
    findings: [],
    evidence: [root, section],
    policyClaims:
      topic === "transfers"
        ? []
        : [
            {
              category: topic === "sharing" ? "recipient" : "purpose",
              source: section.id,
              quote: passages.at(-1)!,
              text: "An analyst paraphrase must never appear as newly added wording.",
              confidence: "high",
            },
          ],
  };
  return { report, root, section };
}

it.each([
  ["sharing", statement],
  ["purpose", purpose],
  ["transfers", transfer],
] as const)(
  "cites the exact newly inserted %s paragraph and both historical sections",
  (topic, quote) => {
    const old = snapshot(false, [retained], topic),
      next = snapshot(true, [retained, quote], topic);
    expect(comparePolicyDisclosures(old.report, next.report)).toEqual([
      {
        topic,
        url: next.section.url,
        heading:
          next.section.observation?.type === "policy_section"
            ? next.section.observation.heading
            : undefined,
        quote,
        previous: {
          scanId: old.report.id,
          evidenceId: old.section.id,
          href: `/report/example.com?scan=${old.report.id}#evidence-${old.section.id}`,
        },
        current: {
          scanId: next.report.id,
          evidenceId: next.section.id,
          href: `/report/example.com?scan=${next.report.id}#evidence-${next.section.id}`,
        },
      },
    ]);
  },
);

type Snapshot = ReturnType<typeof snapshot>;
const invalid: [string, (old: Snapshot, next: Snapshot) => void][] = [
  [
    "a previously observed statement newly selected by AI",
    (old) => {
      old.report.evidence.push({
        ...old.section,
        id: "extra",
        excerpt: statement,
      });
    },
  ],
  [
    "a different URL",
    (old) => {
      old.root.url = old.section.url = "https://example.com/new";
    },
  ],
  [
    "another language",
    (old) => {
      old.root.language = old.section.language = "de";
    },
  ],
  [
    "unknown earlier language",
    (old) => {
      delete old.root.language;
      delete old.section.language;
    },
  ],
  [
    "another kind of source document",
    (old) => {
      old.root.documentKind = "imprint";
    },
  ],
  [
    "a refetched identical document",
    (old, next) => {
      old.root.hash = next.root.hash;
    },
  ],
  [
    "a carried-over source",
    (old, next) => {
      next.section.scanId = old.report.id;
    },
  ],
  [
    "a clipped legacy extract without layout",
    (old) => {
      delete old.root.documentLayout;
    },
  ],
  [
    "a missing end boundary",
    (old) => {
      old.root.documentLayout!.pop();
    },
  ],
  [
    "partial topic coverage",
    (old) => {
      old.section.excerpt += " Additional earlier wording.";
    },
  ],
  [
    "a conflicting section",
    (old) => {
      old.report.evidence.push({ ...old.section, id: "other" });
    },
  ],
  [
    "an unrelated AI quote",
    (_, next) => {
      next.report.policyClaims![0].quote =
        "This quotation belongs to another document.";
    },
  ],
  [
    "weak or mismatched classification",
    (_, next) => {
      next.report.policyClaims![0].confidence = "low";
    },
  ],
  [
    "a demo",
    (_, next) => {
      next.report.demo = true;
    },
  ],
  [
    "identical review dates",
    (old, next) => {
      next.report.completedAt = old.report.completedAt;
    },
  ],
];
it.each(invalid)("suppresses %s", (_, change) => {
  const old = snapshot(false, [retained]),
    next = snapshot(true, [retained, statement]);
  change(old, next);
  expect(comparePolicyDisclosures(old.report, next.report)).toEqual([]);
});

it("skips rewrites and country names alone", () => {
  expect(
    comparePolicyDisclosures(
      snapshot(false, [retained]).report,
      snapshot(true, [statement]).report,
    ),
  ).toEqual([]);
  expect(
    comparePolicyDisclosures(
      snapshot(false, [retained], "transfers").report,
      snapshot(
        true,
        [retained, "Our provider has offices in France and Germany."],
        "transfers",
      ).report,
    ),
  ).toEqual([]);
});
