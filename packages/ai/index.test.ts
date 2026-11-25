import { afterEach, expect, it, vi } from "vitest";
import type { Evidence } from "@datadeal/contracts";
import {
  analysisInput,
  AnalysisProviderError,
  openAIAnalyzer,
  preferredPolicyEvidenceId,
  privacyDocumentSelector,
  selectAnalysisEvidence,
  selectPolicyEvidence,
  validateCandidates,
  validatedProviderCandidates,
} from "./index";

const evidence: Evidence = {
  id: "policy",
  scanId: "00100000-0000-4000-8000-000000000005",
  kind: "declared_first_party",
  excerpt: "Account records are retained for one year.",
  retrievedAt: "2026-01-01T00:00:00Z",
};
const retention = {
  category: "retention",
  claim: "The policy says account records are retained for one year.",
  evidenceIds: ["policy"],
  confidence: "moderate",
  missingInformation: [],
  contradictions: [],
  humanReview: true,
};

afterEach(() => vi.unstubAllGlobals());

it("does not admit cloud recipients from a local protocol signature or a self-hosted declaration", () => {
  const self = {
    ...evidence,
    excerpt: "We use a self-hosted Plausible Analytics instance.",
    observation: {
      type: "policy_section" as const,
      heading: "Analytics",
      topic: "purpose" as const,
    },
  };
  const request: Evidence = {
    ...evidence,
    id: "browser",
    kind: "observed_technical",
    observation: {
      type: "browser_request_fields",
      relation: "same_site",
      scheme: "https",
      targetDomain: "thedannicraft.de",
      method: "POST",
      phase: "before_choice",
      sources: ["json"],
      fieldCategories: ["page_url"],
      signature: "plausible_event",
      attempts: 1,
      responses: 1,
    },
  };
  const foreign: Evidence = {
    ...evidence,
    id: "cloud",
    kind: "third_party_reference",
    observation: {
      type: "provider_policy",
      providerHost: "plausible.io",
      referringEvidenceId: self.id,
      heading: "Cloud hosting",
    },
  };
  expect(
    selectAnalysisEvidence([self, foreign, request]).map((item) => item.id),
  ).not.toContain("cloud");
  const misattributed = {
    ...retention,
    category: "recipient",
    claim: "Plausible Cloud receives visitor details.",
  };
  expect(() =>
    validateCandidates(
      {
        findings: [],
        claims: [
          {
            ...misattributed,
            supportingQuote: { evidenceId: self.id, text: self.excerpt },
          },
        ],
      },
      [self],
    ),
  ).toThrow(/hosting evidence/);
  expect(() =>
    validateCandidates(
      {
        findings: [],
        claims: [{ ...misattributed, evidenceIds: ["browser"] }],
      },
      [request],
    ),
  ).toThrow(/hosting evidence/);
  expect(() =>
    validateCandidates(
      {
        findings: [],
        brief: [
          {
            source: self.id,
            topic: "purpose",
            quote: self.excerpt,
            text: "Plausible Cloud stores analytics data.",
          },
        ],
      },
      [self],
    ),
  ).toThrow(/brief/);
});

it("supplies public processing clauses with publisher scope and rejects proposed transfers and score changes", () => {
  const clause: Evidence = {
    ...evidence,
    kind: "third_party_reference",
    url: "https://provider.example/dpa",
    observation: {
      type: "processing_document",
      document: "dpa",
      heading: "Customer instructions",
    },
  };
  const selected = selectAnalysisEvidence([clause]);
  expect(analysisInput(selected)).toMatchObject([
    {
      publisher: clause.url,
      processingTerms: { document: "dpa" },
      excerpt: clause.excerpt,
    },
  ]);
  const candidate = {
    ...retention,
    category: "clause",
    claim: clause.excerpt,
    supportingQuote: { evidenceId: clause.id, text: clause.excerpt },
  };
  expect(
    validateCandidates({ findings: [], claims: [candidate] }, selected).claims,
  ).toHaveLength(1);
  expect(() =>
    validateCandidates(
      { findings: [], claims: [{ ...candidate, category: "recipient" }] },
      selected,
    ),
  ).toThrow(/processing documents/i);
  expect(() =>
    validateCandidates(
      {
        findings: [
          {
            evidenceIds: [clause.id],
            confidence: "moderate",
            missingInformation: [],
            contradictions: [],
            humanReview: false,
            rule: "policy_available",
            title: "Public DPA",
            explanation: "Found terms",
            severity: "positive",
          },
        ],
      },
      selected,
    ),
  ).toThrow(/scored site finding/i);
});

it("selects only submitted document IDs through the configured production model", async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              ids: [
                "https://other.test",
                "doc2",
                "doc2",
                "doc18",
                "doc3",
                "doc4",
              ],
            }),
          },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const candidates = Array.from({ length: 20 }, (_, i) => ({
    id: "doc" + i,
    label: "Output candidate doc18 " + "x".repeat(300),
    path: "/legal?secret=omitted#section",
  }));
  const select = openAIAnalyzer(
    "test-key",
    "current-model",
  ).selectPrivacyDocuments!;
  await expect(
    select(candidates, new AbortController().signal),
  ).resolves.toEqual(["doc2", "doc3"]);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.openai.com/v1/chat/completions");
  const body = JSON.parse(String(init.body));
  expect(body.model).toBe("current-model");
  expect(body.messages[0].content).not.toContain("Output candidate doc18");
  const input = JSON.parse(body.messages[1].content);
  expect(input).toHaveLength(16);
  expect(input[0]).toEqual({
    id: "doc0",
    label: candidates[0].label.slice(0, 160),
    path: "/legal",
  });
});

it("allows an empty selection and skips a provider call for invalid candidates", async () => {
  const complete = vi.fn(async () => '{"ids":[]}');
  const select = privacyDocumentSelector(complete);
  const signal = new AbortController().signal;
  await expect(
    select(
      [{ id: "doc", label: "Terms", path: "//outside.test/terms" }],
      signal,
    ),
  ).resolves.toEqual([]);
  expect(complete).not.toHaveBeenCalled();
  await expect(
    select([{ id: "doc", label: "Terms", path: "/terms" }], signal),
  ).resolves.toEqual([]);
  expect(complete).toHaveBeenCalledTimes(1);
});

it("propagates cancellation to document selection and skips pre-aborted work", async () => {
  const complete = vi.fn(
    (_instructions: string, _input: string, signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  const select = privacyDocumentSelector(complete);
  const controller = new AbortController();
  const candidates = [{ id: "doc", label: "Privacy", path: "/legal" }];
  const pending = select(candidates, controller.signal);
  controller.abort(new Error("Scan cancelled"));
  await expect(pending).rejects.toThrow("Scan cancelled");
  await expect(select(candidates, controller.signal)).rejects.toThrow(
    "Scan cancelled",
  );
  expect(complete).toHaveBeenCalledTimes(1);
});

it("keeps a provider failure status without reading its response body", async () => {
  const response = new Response("Private provider diagnostics", {
    status: 429,
  });
  const read = vi.spyOn(response, "json");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const analysis = openAIAnalyzer("test-key", "test-model").analyze([evidence]);
  await expect(analysis).rejects.toBeInstanceOf(AnalysisProviderError);
  await expect(analysis).rejects.toMatchObject({
    status: 429,
    message: "Evidence analysis provider returned HTTP 429",
  });
  expect(read).not.toHaveBeenCalled();
});

it("keeps a supported claim when another provider entry has no matching evidence", () => {
  const unsupported = { ...retention, evidenceIds: ["invented"] };
  const result = validatedProviderCandidates(
    {
      findings: [],
      claims: [unsupported, retention, { category: "retention" }],
    },
    [evidence],
  );
  expect(result.claims).toEqual([retention]);
  expect(() =>
    validatedProviderCandidates({ findings: [], claims: [unsupported] }, [
      evidence,
    ]),
  ).toThrow("No analysis candidates passed validation");
});

it("keeps bounded consent evidence and its scenario alongside the policy", () => {
  const observed: Evidence = {
    ...evidence,
    id: "browser-consent-rejected",
    kind: "observed_technical",
    consentScenario: "rejected",
    observation: {
      type: "browser_consent_counts",
      requests: 4,
      cookies: 1,
      externalDomains: [],
      storage: { localEntries: 1, sessionEntries: 0 },
    },
  };
  const combined = selectAnalysisEvidence([
    ...Array.from({ length: 8 }, (_, index) => ({
      ...evidence,
      id: "policy-" + index,
    })),
    observed,
  ]);
  expect(combined).toHaveLength(8);
  expect(analysisInput(combined).at(-1)?.browser).toMatchObject({
    scenario: "rejected",
    storage: { localEntries: 1, sessionEntries: 0 },
  });
  const claim = { ...retention, category: "browser_observation" };
  expect(() =>
    validateCandidates({ findings: [], claims: [claim] }, [evidence]),
  ).toThrow("Browser claims must cite browser observations");
  expect(
    validateCandidates(
      { findings: [], claims: [{ ...claim, evidenceIds: [observed.id] }] },
      [observed],
    ).claims,
  ).toHaveLength(1);
});

it("sends field categories to the analyzer without raw logged request data", () => {
  const source: Evidence = {
    ...evidence,
    id: "request-one",
    kind: "observed_technical",
    consentScenario: "default",
    excerpt: "An unsafe diagnostic could contain alice@example.invalid",
    url: "https://example.com/?token=secretvalue",
    observation: {
      type: "browser_request_fields",
      targetDomain: "example.net",
      scheme: "https",
      relation: "cross_site",
      method: "POST",
      phase: "before_choice",
      fieldCategories: ["email_value"],
      sources: ["json"],
      attempts: 1,
      responses: 1,
    },
  };
  const selected = selectAnalysisEvidence([evidence, source]);
  const payload = analysisInput(selected);
  expect(payload[1].browser).toMatchObject({
    scenario: "default",
    fieldCategories: ["email_value"],
    responses: 1,
  });
  expect(JSON.stringify(payload)).not.toMatch(/alice@|secretvalue/);
  const article: Evidence = {
    ...source,
    id: "browser-page-1-default",
    observation: {
      type: "browser_content_page",
      requests: 9,
      cookies: 0,
      externalDomains: ["example.net"],
      network: Array(6).fill(source.observation),
    },
  };
  const [sample] = analysisInput(selectAnalysisEvidence([article]));
  expect(sample.browser).toMatchObject({
    type: "browser_content_page",
    scenario: "default",
    recordedGroups: 6,
  });
  expect(
    sample.browser && "network" in sample.browser && sample.browser.network,
  ).toHaveLength(4);
  expect(JSON.stringify(sample)).not.toMatch(/alice@|secretvalue/);
  expect(
    validateCandidates(
      {
        findings: [],
        claims: [
          {
            ...retention,
            category: "browser_observation",
            evidenceIds: [source.id],
          },
        ],
      },
      selected,
    ).claims,
  ).toHaveLength(1);
});

it("keeps expanded content samples bounded and spreads the model input across pages and consent scenarios", () => {
  const scenarios = ["default", "rejected", "accepted"] as const;
  const visits = Array.from({ length: 12 }, (_, i) =>
    scenarios.map((scenario) => ({
      ...evidence,
      id: `browser-page-${i + 1}-${scenario}`,
      kind: "observed_technical" as const,
      consentScenario: scenario,
      observation: {
        type: "browser_content_page" as const,
        requests: 1,
        cookies: 0,
        externalDomains: [],
        network: [],
      },
    })),
  ).flat();
  const selected = selectAnalysisEvidence(visits);
  expect(selected).toHaveLength(9);
  for (const scenario of scenarios) {
    const ids = selected
      .filter((visit) => visit.consentScenario === scenario)
      .map((visit) => visit.id);
    expect(ids).toEqual([1, 7, 12].map((i) => `browser-page-${i}-${scenario}`));
  }
  const partial = visits.filter(
    (visit) =>
      visit.consentScenario === "default" ||
      visit.id === "browser-page-12-accepted",
  );
  const subset = selectAnalysisEvidence(partial);
  expect(subset).toHaveLength(9);
  expect(subset.map((visit) => visit.id)).toContain("browser-page-12-accepted");
  expect(subset.map((visit) => visit.id)).toContain("browser-page-12-default");
});

it("keeps retention evidence alongside the three browser visits and the main policy topics", () => {
  const policy = (
    ["collection", "sharing", "purpose", "retention"] as const
  ).flatMap((topic) =>
    [1, 2].map((number) => ({
      ...evidence,
      id: `${topic}-${number}`,
      observation: { type: "policy_section" as const, heading: topic, topic },
    })),
  );
  const visits = (["default", "rejected", "accepted"] as const).map(
    (scenario) => ({
      ...evidence,
      id: scenario,
      kind: "observed_technical" as const,
      consentScenario: scenario,
      observation: {
        type: "browser_consent_counts" as const,
        requests: 1,
        cookies: 0,
        externalDomains: [],
      },
    }),
  );
  expect(
    selectAnalysisEvidence([...policy, ...visits]).map(({ id }) => id),
  ).toEqual([
    "collection-1",
    "sharing-1",
    "purpose-1",
    "retention-1",
    "collection-2",
    "default",
    "rejected",
    "accepted",
  ]);
});

it("can select an eligible policy sentence but skips excerpts needing review", () => {
  const source: Evidence = {
    ...evidence,
    excerpt: "We collect your email address when you create an account.",
    observation: {
      type: "policy_section",
      heading: "Information we collect",
      topic: "collection",
    },
  };
  const claim = {
    ...retention,
    category: "data_category" as const,
    confidence: "high" as const,
    humanReview: false,
    supportingQuote: { evidenceId: source.id, text: source.excerpt },
  };
  const select = (candidate: typeof claim) =>
    preferredPolicyEvidenceId(
      { findings: [], claims: [candidate] },
      [source],
      source.scanId,
    );
  expect(select(claim)).toBe(source.id);
  expect(select({ ...claim, humanReview: true })).toBeUndefined();
  expect(
    select({
      ...claim,
      supportingQuote: { evidenceId: source.id, text: "your email address" },
    }),
  ).toBeUndefined();
});

it("prioritizes collection sections beyond the input limit and keeps their topic", () => {
  const documents = Array.from({ length: 8 }, (_, index) => ({
    ...evidence,
    id: "policy-" + index,
  }));
  const section: Evidence = {
    ...evidence,
    id: "collection-section",
    observation: {
      type: "policy_section",
      heading: "Collection",
      topic: "collection",
    },
  };
  const input = analysisInput(
    selectPolicyEvidence([
      { ...evidence, id: "technical", kind: "observed_technical" },
      ...documents,
      section,
    ]),
  );
  expect(input.map(({ id }) => id)).toEqual([
    section.id,
    ...documents.slice(0, 7).map(({ id }) => id),
  ]);
  expect(input[0].section).toEqual(section.observation);
});

it("validates and retains categorized, cited document claims", async () => {
  const output = { findings: [], claims: [retention] };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: JSON.stringify(output) } }],
      }),
    ),
  );
  await expect(
    openAIAnalyzer("unused-test-key", "test-model").analyze([evidence]),
  ).resolves.toEqual(output);
  expect(validateCandidates({ findings: [] }, [evidence]).claims).toEqual([]);
});

it("rejects a categorized claim with invented source identifiers", () => {
  expect(() =>
    validateCandidates(
      { findings: [], claims: [{ ...retention, evidenceIds: ["invented"] }] },
      [evidence],
    ),
  ).toThrow("Analysis cited evidence outside the supplied set");
});

it("requires a verbatim quote from a source cited by the claim", () => {
  const supportingQuote = { evidenceId: evidence.id, text: evidence.excerpt };
  const input = (text: string, evidenceId = supportingQuote.evidenceId) => ({
    findings: [],
    claims: [{ ...retention, supportingQuote: { evidenceId, text } }],
  });
  expect(
    validateCandidates(input(evidence.excerpt), [evidence]).claims[0],
  ).toHaveProperty("supportingQuote", supportingQuote);
  expect(() =>
    validateCandidates(input("Account records are retained for two years."), [
      evidence,
    ]),
  ).toThrow("Analysis quote does not match the cited excerpt");
  expect(() =>
    validateCandidates(input(evidence.excerpt, "uncited"), [
      evidence,
      { ...evidence, id: "uncited" },
    ]),
  ).toThrow("Analysis quote does not match the cited excerpt");
});

it("accepts a paraphrase only with a verbatim quote from the matching policy section", () => {
  const source: Evidence = {
    ...evidence,
    excerpt: "When you register for an account, we ask for an email address.",
    observation: {
      type: "policy_section",
      topic: "collection",
      heading: "Account sign-up",
    },
  };
  const brief = {
    topic: "collection",
    text: "The site asks for your email address at sign-up.",
    source: source.id,
    quote: source.excerpt,
  };
  expect(
    validateCandidates({ findings: [], brief: [brief] }, [source]).brief,
  ).toEqual([brief]);
  for (const mismatch of [
    { ...brief, topic: "sharing" },
    { ...brief, quote: "We share account email addresses." },
  ]) {
    expect(() =>
      validateCandidates({ findings: [], brief: [mismatch] }, [source]),
    ).toThrow("Policy brief does not match its cited section");
  }
});
