import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { type Evidence, type ScanReport } from "@datadeal/contracts";
import { buildPracticeEvidenceBundle } from "@datadeal/contracts/practice-evidence";
import { publishDataPractices } from "../ai/practices";
import { selectAnalysisEvidence } from "../ai/index";
import { calculateAcceptAllScore } from "../scoring/index";
import { summarizeBrowserCookies } from "./browser-storage";
import { c15tPreferenceSection } from "./c15t-preferences";

const url = new URL("https://example.com/legal/cookies");
const inventory = `<main><article><dl><div><dt>Provider</dt><dd>Example / c15t</dd></div><div><dt>Storage</dt><dd>First-party cookie and local storage</dd></div><div><dt>Purpose</dt><dd>Apply and remember your privacy choices.</dd></div><div><dt>Retention</dt><dd>Six months, followed by a renewed choice.</dd></div></dl></article></main>`;
const id = "274582c5-5e15-483a-8dd9-17852f293503";
const common = {
  scanId: id,
  retrievedAt: "2026-11-25T13:00:00Z",
  url: url.href,
};
const source: Evidence = {
  ...common,
  id: "document-2-c15t-preferences",
  kind: "declared_first_party",
  excerpt: c15tPreferenceSection(load(inventory), url)!.excerpt,
  observation: {
    type: "policy_section",
    heading: "Privacy preferences",
    topic: "purpose",
    disclosedPreference: "c15t_choice",
  },
};
const sharing: Evidence = {
  ...common,
  id: "sharing",
  kind: "declared_first_party",
  excerpt: "We use providers to respond to the requests you make.",
  observation: {
    type: "policy_section",
    heading: "Recipients",
    topic: "sharing",
  },
};
function reportFor(cookieDomain = "example.com", policy: Evidence = source) {
  const empty = { total: 0, inspected: 0, categories: [] };
  const endCookies = summarizeBrowserCookies(
    [
      {
        name: "c15t",
        domain: cookieDomain,
        value: "never-retained",
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
        expires: 1800000000,
      },
    ],
    url,
  );
  const visit: Evidence = {
    ...common,
    url: url.origin + "/",
    id: "browser-consent-accepted",
    kind: "observed_technical",
    consentScenario: "accepted",
    excerpt: "The accept-all control was clicked.",
    observation: {
      type: "browser_consent_counts",
      freshContext: true,
      finalPageKnown: true,
      requests: 12,
      cookies: 1,
      storage: { localEntries: 1, sessionEntries: 0 },
      externalDomains: [],
      afterChoice: { acceptedAll: true, requests: 1, externalDomains: [] },
      requestInspection: { examined: 12, matched: 0, limitReached: false },
      storageSummary: {
        beforeChoice: {
          cookies: { total: 0, inspected: 0, recognized: [] },
          web: { local: empty, session: empty },
        },
        end: {
          cookies: endCookies,
          web: {
            local: { total: 1, inspected: 1, categories: ["c15t_key"] },
            session: empty,
          },
        },
      },
    },
  };
  const report: ScanReport = {
    id,
    domain: url.hostname,
    completedAt: common.retrievedAt,
    partial: false,
    demo: false,
    findings: [],
    consentCoverage: {
      default: "untested",
      accepted: "measured",
      rejected: "untested",
    },
    evidence: [visit, policy, sharing],
    policyBrief: [
      {
        source: source.id,
        quote: policy.excerpt,
        text: "The site describes remembering privacy choices.",
        topic: "purpose",
      },
      {
        source: sharing.id,
        quote: sharing.excerpt,
        text: "The policy describes its providers.",
        topic: "sharing",
      },
    ],
  };
  const fact = buildPracticeEvidenceBundle(report).practices[0];
  const judgment = {
    factId: fact.factId,
    purpose: "consent",
    role: "site_operator",
    necessity: "proportionate",
    confidence: "moderate",
    context: { source: source.id, text: policy.excerpt },
    possibleConsentConflict: false,
  } as const;
  return { ...report, ...publishDataPractices(report, [judgment]) };
}
describe("c15t preference inventory", () => {
  it("supplies the matching inventory to the analyst even when other policy sections fill the document budget", () => {
    const report = reportFor();
    const generic: Evidence[] = Array.from({ length: 12 }, (_, index) => ({
      ...sharing,
      id: "purpose-" + index,
      observation: {
        type: "policy_section",
        heading: "Purpose",
        topic: "purpose",
      },
      excerpt: "We use information for the purposes described here.",
    }));
    const supplied = selectAnalysisEvidence([...generic, ...report.evidence]);
    expect(supplied.filter((s) => s.id === source.id)).toHaveLength(1);
  });
  it("requires one explicit labelled record for the operator, first-party mechanisms and purpose", () => {
    expect(source.excerpt).toContain(
      "First-party cookie and local storage Purpose Apply and remember your privacy choices.",
    );
    for (const bad of [
      inventory.replace("Example / c15t", "Other publisher / c15t"),
      inventory.replace("First-party cookie", "Third-party cookie"),
      inventory.replace(
        "Apply and remember your privacy choices.",
        "We may use this for advertising.",
      ),
      inventory.replace("<dt>Purpose</dt>", "</dl><dl><dt>Purpose</dt>"),
    ])
      expect(c15tPreferenceSection(load(bad), url)).toBeUndefined();
  });
  it("rates both exact first-party mechanisms with the same citation and complete measured coverage", () => {
    const report = reportFor();
    expect(report.dataPractices).toHaveLength(2);
    expect(report.practiceCoverage.analystReviewed).toBe(1);
    expect(report.dataPractices.map((p) => p.interpretation).sort()).toEqual([
      "analyst_reviewed",
      "source_matched",
    ]);
    for (const p of report.dataPractices) {
      expect(p).toMatchObject({
        operation: "stored",
        purpose: "consent",
        role: "site_operator",
        dataClass: "preference",
        linkedIdentifier: false,
        control: "after_accept",
        contextQuote: { source: source.id, text: source.excerpt },
        evidence: {
          behavior: ["browser-consent-accepted"],
          context: [source.id],
        },
      });
    }
    expect(calculateAcceptAllScore(report)).toMatchObject({
      score: 85,
      confidence: "Low",
    });
    expect(JSON.stringify(report)).not.toContain("never-retained");
    expect(
      calculateAcceptAllScore({
        ...report,
        ...publishDataPractices(report, []),
      }),
    ).toMatchObject({ score: null });
  });
  it("keeps a foreign or sibling-only namesake, different-origin document and generic consent mention unassessed", () => {
    for (const report of [
      reportFor("other.com"),
      reportFor("sibling.example.com"),
      reportFor("example.com", { ...source, url: "https://other.com/cookies" }),
      reportFor("example.com", {
        ...source,
        excerpt: "Optional functions are handled by c15t.",
        observation: {
          type: "policy_section",
          heading: "Consent",
          topic: "purpose",
        },
      }),
    ]) {
      expect(
        report.dataPractices.some(
          (p) => p.necessity === "proportionate" && p.role === "site_operator",
        ),
      ).toBe(false);
      expect(calculateAcceptAllScore(report)?.score).toBeNull();
    }
  });
});
