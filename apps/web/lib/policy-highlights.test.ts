import type { ScanReport } from "@datadeal/contracts";
import { expect, it } from "vitest";
import { publicPolicyHighlights } from "./policy-highlights";

const brief = [
  {
    topic: "purpose",
    source: "hosting",
    text: "The policy describes storing technical logs for site delivery.",
    quote: "Our servers store technical logs for website delivery.",
  },
  {
    topic: "sharing",
    source: "booking",
    text: "After optional consent, BookingPartner may process the appointment details you submit.",
    quote:
      "After optional consent, BookingPartner may process the appointment details you submit.",
  },
  {
    topic: "collection",
    source: "contact",
    text: "The policy says messages go to the operator’s self-hosted inbox.",
    quote:
      "If you use the contact form, messages are stored in our self-hosted inbox.",
  },
] satisfies NonNullable<ScanReport["policyBrief"]>;
const report: ScanReport = {
  id: "00000000-0000-4000-8000-000000000001",
  domain: "thedannicraft.de",
  completedAt: "2026-11-25T10:00:00Z",
  partial: false,
  demo: false,
  findings: [],
  policyBrief: brief,
  evidence: brief.map((item) => ({
    id: item.source,
    kind: "declared_first_party",
    scanId: "00000000-0000-4000-8000-000000000001",
    retrievedAt: "2026-11-25T10:00:00Z",
    excerpt: item.quote,
    observation: {
      type: "policy_section",
      topic: item.topic,
      heading:
        item.source === "booking" ? "Optional booking" : "Policy section",
    },
  })),
};

it("orders cited visitor actions the same way on every domain", () => {
  const result = publicPolicyHighlights(report);
  expect(
    publicPolicyHighlights({ ...report, domain: "another.example" }),
  ).toEqual(result);
  expect(result.map(({ title, source }) => [title, source])).toEqual([
    ["Contact form", "contact"],
    ["Appointment booking", "booking"],
    [undefined, "hosting"],
  ]);
  expect(result[0].text).toBe(brief[2].text);
  expect(result[1].text).toContain("may process");
  expect(result[1].quote).toBe(brief[1].quote);
});

it("drops stale or contradicted summaries and never supplies its own recipient", () => {
  const changed: ScanReport = {
    ...report,
    evidence: report.evidence.map((e) =>
      e.id === "booking"
        ? { ...e, excerpt: "We no longer offer appointment booking." }
        : { ...e, scanId: "old" },
    ),
  };
  expect(publicPolicyHighlights(changed)).toEqual([]);
  expect(publicPolicyHighlights({ ...report, evidence: [] })).toEqual([]);
  expect(publicPolicyHighlights({ ...report, policyBrief: undefined })).toEqual(
    [],
  );
});

it("uses a cited, complete policy claim when the scan has no short brief", () => {
  const contact = brief[2];
  const claim = {
    category: "data_category",
    text: contact.text,
    quote: contact.quote,
    source: contact.source,
    confidence: "moderate",
  } as const;
  const stored = { ...report, policyBrief: undefined, policyClaims: [claim] };
  expect(publicPolicyHighlights(stored)).toMatchObject([
    { text: contact.text, source: contact.source, topic: "collection" },
  ]);
  for (const override of [
    { confidence: "low" as const },
    { category: "retention" as const },
    { quote: "A claim from another version of the policy." },
    { text: "The complete disclosure and its exceptions. ".repeat(10) },
  ])
    expect(
      publicPolicyHighlights({
        ...stored,
        policyClaims: [{ ...claim, ...override }],
      }),
    ).toEqual([]);
});
