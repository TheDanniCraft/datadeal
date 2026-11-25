import { expect, it } from "vitest";
import type { DataPractice, Evidence, ScanReport } from "@datadeal/contracts";
import { publishDataPractices } from "../../../packages/ai/practices";
import {
  groupPracticeTakeaways,
  practiceTakeaways,
} from "./practice-takeaways";
const id = "0c8b5193-b4d5-4b91-a155-b1ba1d3f041d";
const practice: DataPractice = {
  factId: "a",
  scenario: "rejected",
  operation: "transmitted",
  role: "independent",
  purpose: "analytics",
  necessity: "optional",
  persistence: "unknown",
  control: "after_reject",
  scope: "cross_site",
  trigger: "After rejecting",
  linkedIdentifier: false,
  recipient: "outside.test",
  confidence: "moderate",
  dataClass: "page_activity",
  evidence: { behavior: ["request"], context: ["policy"], link: [] },
  summary: "The browser sent page activity to outside.test.",
  significance: "This lets an outside service see the visited page.",
  unknowns: ["Retention was not verified."],
  mismatch: "The policy says this requires consent.",
  contextQuote: { source: "policy", text: "requires consent" },
};
const report: ScanReport = {
  id,
  domain: "example.org",
  completedAt: "2026-11-25T12:00:00Z",
  partial: false,
  demo: false,
  findings: [],
  evidence: [
    {
      id: "request",
      scanId: id,
      retrievedAt: "2026-11-25T12:00:00Z",
      kind: "observed_technical",
      consentScenario: "rejected",
      excerpt: "A request to outside.test.",
    },
    {
      id: "policy",
      scanId: id,
      retrievedAt: "2026-11-25T12:00:00Z",
      kind: "declared_first_party",
      excerpt: "It requires consent.",
    },
  ],
  dataPractices: [practice],
};
it("supports a rejected-visit finding with its exact observation and policy quote", () => {
  const rows = practiceTakeaways(report, "rejected", {}, false);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    provenance: "Observed",
    mismatch: practice.mismatch,
    unknowns: practice.unknowns,
    citations: [{ id: "request" }, { id: "policy", quote: "requires consent" }],
  });
});
it("requires same-scan and same-scenario behavior evidence before presenting a claim", () => {
  expect(
    practiceTakeaways(
      {
        ...report,
        evidence: report.evidence.filter((e) => e.id !== "request"),
      },
      "rejected",
      {},
      false,
    ),
  ).toEqual([]);
  expect(
    practiceTakeaways(
      {
        ...report,
        evidence: report.evidence.map((e) =>
          e.id === "request" ? { ...e, consentScenario: "accepted" } : e,
        ),
      },
      "rejected",
      {},
      true,
    ),
  ).toEqual([]);
});

it("keeps two page records behind one matched-ID headline without extending a purpose or consent finding to another visit", () => {
  const base = practiceTakeaways(report, "rejected", {}, false)[0]!;
  const first = {
    ...base,
    mismatch: null,
    linkedRequest: { recipient: "outside.test", linkage: "exact_end_match" },
  };
  const second = {
    ...first,
    factId: "other-page",
    citations: [{ id: "other-source", label: "Sampled visit · /another-page" }],
    significance: "Two events can be associated.",
    unknowns: ["Purpose unknown."],
  };
  const groups = groupPracticeTakeaways([
    first,
    second,
    {
      ...second,
      factId: "consented",
      scenario: "accepted",
      control: "after_accept",
    },
    {
      ...second,
      factId: "another-recipient",
      linkedRequest: { ...first.linkedRequest, recipient: "other.test" },
    },
    {
      ...second,
      factId: "other-timing",
      linkedRequest: { ...first.linkedRequest, linkage: "observed_earlier" },
    },
    { ...second, factId: "conflict", mismatch: "No consent was given." },
  ]);
  expect(groups).toHaveLength(5);
  expect(groups[0]?.observations).toEqual([first, second]);
});
it("bounds the public detail but preserves every cited policy conflict and all advanced rows", () => {
  const many = {
    ...report,
    dataPractices: Array.from({ length: 6 }, (_, i) => ({
      ...practice,
      factId: String(i),
      mismatch: i >= 2 ? practice.mismatch : null,
    })),
  };
  expect(practiceTakeaways(many, "rejected", {}, false)).toHaveLength(4);
  expect(practiceTakeaways(many, "rejected", {}, true)).toHaveLength(6);
});

it("groups a documented choice across browser stores and isolated consent visits with its sources intact", () => {
  const empty = { total: 0, inspected: 0, categories: [] };
  const visits = (["accepted", "rejected"] as const).map(
    (scenario): Evidence => ({
      id: "browser-consent-" + scenario,
      scanId: id,
      retrievedAt: report.completedAt,
      kind: "observed_technical",
      consentScenario: scenario,
      url: "https://example.org/",
      excerpt: "Measured homepage visit",
      observation: {
        type: "browser_consent_counts",
        freshContext: true,
        finalPageKnown: true,
        requests: 2,
        externalDomains: [],
        cookies: 1,
        afterChoice: {
          acceptedAll: scenario === "accepted",
          requests: 1,
          externalDomains: [],
        },
        storage: { localEntries: 1, sessionEntries: 0 },
        storageSummary: {
          beforeChoice: {
            cookies: { total: 0, inspected: 0, recognized: [] },
            web: { local: empty, session: empty },
          },
          end: {
            cookies: {
              total: 1,
              inspected: 1,
              recognized: [
                {
                  name: "c15t",
                  scope: "same_site",
                  site: "example.org",
                  secure: true,
                  httpOnly: false,
                  sameSite: "Lax",
                  persistent: true,
                },
              ],
            },
            web: {
              local: { total: 1, inspected: 1, categories: ["c15t_key"] },
              session: empty,
            },
          },
        },
      },
    }),
  );
  const policy: Evidence = {
    ...report.evidence[1]!,
    url: "https://example.org/cookies",
    excerpt:
      "We use a cookie and local storage to remember your privacy choices.",
    observation: {
      type: "policy_section",
      topic: "purpose",
      heading: "Privacy choices",
      disclosedPreference: "c15t_choice",
    },
  };
  function groups(evidence: Evidence[]) {
    const saved: ScanReport = {
      ...report,
      evidence,
      consentCoverage: {
        default: "untested",
        rejected: "measured",
        accepted: "measured",
      },
      ...publishDataPractices({ id, evidence }),
    };
    return groupPracticeTakeaways(
      practiceTakeaways(saved, "accepted", {}, false),
    );
  }
  const findings = groups([...visits, policy]);
  const choice = findings.filter((group) => group.choice);
  expect(choice).toHaveLength(1);
  expect(
    choice[0]!.observations
      .map((row) => [row.scenario, row.choiceStorage!.mechanism])
      .sort(),
  ).toEqual([
    ["accepted", "cookie"],
    ["accepted", "local_storage"],
    ["rejected", "cookie"],
    ["rejected", "local_storage"],
  ]);
  for (const row of choice[0]!.observations) {
    expect(row.citations.map(({ id }) => id)).toEqual([
      "browser-consent-" + row.scenario,
      policy.id,
    ]);
    expect(row.unknowns.length).toBeGreaterThan(0);
  }
  expect(
    groups([
      ...visits,
      { ...policy, url: "https://other.example/cookies" },
    ]).every((g) => !g.choice),
  ).toBe(true);
});
