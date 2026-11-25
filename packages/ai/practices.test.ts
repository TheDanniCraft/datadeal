import { describe, expect, it } from "vitest";
import type { Evidence } from "@datadeal/contracts";
import { practicesForAnalysis, publishDataPractices } from "./practices";
import {
  completePracticeReview,
  selectAnalysisEvidence,
  validatedProviderCandidates,
} from "./index";

const scanId = "c14a2e16-f39a-49bc-be19-d10b600d44e5";
const base = {
  scanId,
  retrievedAt: "2026-11-25T10:00:00Z",
  url: "https://review.example/",
};
const visit: Evidence = {
  ...base,
  id: "browser-consent-default",
  kind: "observed_technical",
  consentScenario: "default",
  excerpt: "A default homepage visit.",
  observation: {
    type: "browser_consent_counts",
    requests: 5,
    cookies: 1,
    storage: { localEntries: 0, sessionEntries: 0 },
    externalDomains: [],
    finalPageKnown: true,
    storageSummary: {
      end: {
        cookies: {
          total: 1,
          inspected: 1,
          recognized: [
            {
              name: "Chatwoot conversation",
              scope: "same_site",
              persistent: true,
              secure: true,
              httpOnly: false,
              sameSite: "Lax",
            },
          ],
        },
      },
    },
  },
};
const policy: Evidence = {
  ...base,
  id: "policy-1",
  kind: "declared_first_party",
  excerpt:
    "We use self-hosted Chatwoot to continue your support conversation when you return.",
  observation: { type: "policy_section", topic: "purpose", heading: "Support" },
};
function judge(sources: Evidence[], extra: Record<string, unknown> = {}) {
  const observation = practicesForAnalysis(sources)[0];
  return {
    factId: observation.factId,
    purpose: "support",
    role: "site_operator",
    necessity: "proportionate",
    confidence: "moderate",
    context: { source: policy.id, text: policy.excerpt },
    possibleConsentConflict: false,
    ...extra,
  };
}
describe("offline practice analysis", () => {
  it("keeps the observed Meta cookie and its documented security use distinct even when the analyst labels it advertising", () => {
    const observed = structuredClone(visit);
    observed.url = "https://www.facebook.com/";
    const o = observed.observation;
    if (o?.type !== "browser_consent_counts")
      throw Error("Expected browser snapshot");
    const cookie = o.storageSummary!.end.cookies.recognized[0]!;
    cookie.name = "datr";
    cookie.site = "facebook.com";
    const source: Evidence = {
      ...policy,
      url: "https://www.facebook.com/privacy/policies/cookies?subpage=subpage-1.2",
      excerpt:
        "“Datr” is a unique identifier for your browser that, amongst other things, helps us protect you from fraud.",
      observation: {
        type: "policy_section",
        topic: "purpose",
        heading: "Security, site and product integrity",
      },
    };
    const evidence = [observed, source];
    expect(selectAnalysisEvidence(evidence).map((s) => s.id)).toContain(
      source.id,
    );
    const candidate = {
      ...judge(evidence),
      purpose: "advertising" as const,
      role: "independent" as const,
      necessity: "optional" as const,
      confidence: "high" as const,
      context: { source: source.id, text: source.excerpt },
    };
    const [p] = publishDataPractices({ id: scanId, evidence }, [
      candidate,
    ]).dataPractices;
    expect(p).toMatchObject({
      operation: "stored",
      purpose: "unknown",
      role: "unknown",
      necessity: "unclear",
      recipient: null,
      contextQuote: { source: source.id, text: source.excerpt },
      evidence: { behavior: [observed.id], context: [source.id], link: [] },
    });
  });
  it.each([
    ["SOCS", "Functionality", "SOCS remembers your cookie choices."],
    ["AEC", "Security", "AEC supports fraud and abuse checks."],
    ["NID", "Analytics", "Google describes using NID for analytics on Search."],
  ] as const)(
    "keeps %s cookie presence separate from its cited Google policy use",
    (name, heading, excerpt) => {
      const o = visit.observation!;
      if (o.type !== "browser_consent_counts")
        throw Error("Expected browser snapshot");
      const jar = o.storageSummary!.end.cookies;
      const observed: Evidence = {
        ...visit,
        url: "https://www.google.com/",
        observation: {
          ...o,
          storageSummary: {
            end: {
              cookies: {
                ...jar,
                recognized: [
                  { ...jar.recognized[0]!, name, site: "google.com" },
                ],
              },
            },
          },
        },
      };
      const source: Evidence = {
        ...policy,
        url: "https://policies.google.com/technologies/cookies?hl=en",
        excerpt,
        observation: { type: "policy_section", topic: "purpose", heading },
      };
      const report = { id: scanId, evidence: [observed, source] };
      const unrelated = Array.from({ length: 15 }, (_, i) => ({
        ...policy,
        id: "unrelated-" + i,
      }));
      expect(
        selectAnalysisEvidence([observed, ...unrelated, source]).map(
          (s) => s.id,
        ),
      ).toContain(source.id);
      const [fact] = practicesForAnalysis(report.evidence);
      expect(fact.storage?.family).toBe(name);
      const candidate = {
        ...judge(report.evidence),
        purpose: "advertising" as const,
        role: "independent" as const,
        confidence: "high" as const,
        necessity: "optional" as const,
        context: { source: source.id, text: excerpt },
      };
      for (const judgments of [[], [candidate]]) {
        expect(
          publishDataPractices(report, judgments).dataPractices[0],
        ).toMatchObject({
          operation: "stored",
          purpose: "unknown",
          role: "unknown",
          necessity: "unclear",
          confidence: "low",
          recipient: null,
          contextQuote: { source: source.id, text: excerpt },
          evidence: { behavior: [observed.id], context: [source.id], link: [] },
        });
      }
      const wrong = {
        ...source,
        url: "https://policies.google.com.example.net/technologies/cookies",
      };
      const [p] = publishDataPractices(
        { id: scanId, evidence: [observed, wrong] },
        [candidate],
      ).dataPractices;
      expect(p.contextQuote).toBeUndefined();
      expect(p.evidence.context).toEqual([]);
    },
  );
  it("requests a focused review if the document analyst returns only policy claims", async () => {
    const evidence = [visit, policy];
    const { factId, ...review } = judge(evidence);
    const result = await completePracticeReview(
      { findings: [], claims: [] },
      evidence,
      async (_instructions, input) => {
        const bundle = JSON.parse(input);
        expect(
          bundle.observations.map((row: { factId: string }) => row.factId),
        ).toEqual([factId]);
        return JSON.stringify({ judgments: [{ ...review, index: 1 }] });
      },
    );
    expect(result.practices?.[0].factId).toBe(factId);
  });
  it("binds AI context to an actual cookie observation while leaving transmission unknown", () => {
    const evidence = [visit, policy];
    const result = validatedProviderCandidates(
      { findings: [], practices: [judge(evidence)] },
      evidence,
    );
    const [p] = publishDataPractices(
      { id: scanId, evidence },
      result.practices,
    ).dataPractices;
    expect(p).toMatchObject({
      operation: "stored",
      role: "site_operator",
      necessity: "proportionate",
      purpose: "support",
      dataClass: "conversation_id",
      recipient: null,
      linkedIdentifier: false,
      evidence: { behavior: [visit.id], context: [policy.id], link: [] },
    });
  });
  it("rejects fictitious facts and drops ungrounded interpretations without losing the browser evidence", () => {
    const evidence = [visit, policy];
    expect(() =>
      validatedProviderCandidates(
        { findings: [], practices: [judge(evidence, { factId: "missing" })] },
        evidence,
      ),
    ).toThrow();
    expect(() =>
      validatedProviderCandidates(
        {
          findings: [],
          practices: [
            judge(evidence, {
              context: { source: policy.id, text: "Invented policy excerpt." },
            }),
          ],
        },
        evidence,
      ),
    ).toThrow();
    const unrelated = {
      ...policy,
      excerpt: "An independent advertiser operates another site.",
    };
    const sources = [visit, unrelated];
    const result = validatedProviderCandidates(
      {
        findings: [],
        practices: [
          judge(sources, {
            purpose: "advertising",
            role: "independent",
            context: { source: policy.id, text: unrelated.excerpt },
          }),
        ],
      },
      sources,
    );
    expect(
      publishDataPractices({ id: scanId, evidence: sources }, result.practices)
        .dataPractices[0],
    ).toMatchObject({
      role: "unknown",
      necessity: "unclear",
      operation: "stored",
      interpretation: "observed_only",
      evidence: { context: [] },
    });
  });
  it("does not promote a documented denial or a policy by itself into an observed recipient", () => {
    const denied = {
      ...policy,
      excerpt: "Chatwoot is not an independent advertising provider.",
    };
    const sources = [visit, denied];
    const result = validatedProviderCandidates(
      {
        findings: [],
        practices: [
          judge(sources, {
            purpose: "advertising",
            role: "independent",
            context: { source: denied.id, text: denied.excerpt },
          }),
        ],
      },
      sources,
    );
    expect(
      publishDataPractices({ id: scanId, evidence: sources }, result.practices)
        .dataPractices[0],
    ).toMatchObject({
      role: "unknown",
      recipient: null,
      linkedIdentifier: false,
    });
    expect(
      publishDataPractices({ id: scanId, evidence: [policy] }).dataPractices,
    ).toHaveLength(0);
  });
});
