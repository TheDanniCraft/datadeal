import { describe, expect, it } from "vitest";
import {
  scanReport,
  type BrowserRequestFields,
  type DataPractice,
  type Evidence,
  type ScanReport,
} from "@datadeal/contracts";
import type { BrowserStorageSnapshot } from "@datadeal/contracts";
import {
  buildPracticeEvidenceBundle,
  type PracticeEvidence,
} from "@datadeal/contracts/practice-evidence";
import {
  calculateAcceptAllScore,
  calculateRejectScore,
  calculateScore,
  evaluateHeadline,
  verifiedRejectRating,
} from "./index";
import { publishDataPractices } from "../ai/practices";
import { selectAnalysisEvidence } from "../ai/index";

const id = "00100000-0000-4000-8000-000000000015";
const domain = "example.com";
const date = "2026-10-16T10:00:00.000Z";
const zeroStore = { total: 0, inspected: 0, categories: [] };
function snapshot(
  name?: "Chatwoot conversation" | "_fbp",
): BrowserStorageSnapshot {
  return {
    cookies: {
      total: name ? 1 : 0,
      inspected: name ? 1 : 0,
      recognized: name
        ? [
            {
              name,
              scope: "same_site",
              persistent: true,
              secure: true,
              httpOnly: false,
              sameSite: "Lax",
            },
          ]
        : [],
    },
    web: { local: zeroStore, session: zeroStore },
  };
}
const quotes = {
  support:
    "We run self-hosted Chatwoot and keep a conversation identifier to continue a visitor’s requested support chat.",
  ads: "With optional consent, Meta, the independent operator of facebook.com, uses the browser identifier and page events for its own advertising.",
  sharing:
    "The site operator hosts the support conversation and does not share support conversations with other recipients.",
};
const page = "https://" + domain + "/";
function source(
  key: string,
  kind: Evidence["kind"],
  excerpt: string,
  observation: Evidence["observation"],
): Evidence {
  return {
    id: key,
    scanId: id,
    retrievedAt: date,
    url: page,
    kind,
    excerpt,
    observation,
  };
}
type Fixture = "chat" | "ads" | "empty";
function reportFor(
  kind: Fixture,
  scenario: DataPractice["scenario"] = "default",
  overrides: Partial<BrowserRequestFields> = {},
): ScanReport {
  const marker =
    kind === "chat"
      ? "Chatwoot conversation"
      : kind === "ads"
        ? "_fbp"
        : undefined;
  const recipients = kind === "ads" ? ["facebook.com"] : [];
  const visit = source(
    "browser-consent-" + scenario,
    "observed_technical",
    "A measured visit.",
    {
      type: "browser_consent_counts",
      freshContext: true,
      finalPageKnown: true,
      requests: 5,
      cookies: marker ? 1 : 0,
      storage: { localEntries: 0, sessionEntries: 0 },
      requestInspection: {
        examined: 5,
        matched: recipients.length,
        limitReached: false,
      },
      storageSummary: {
        end: snapshot(marker),
        ...(scenario !== "default" && { beforeChoice: snapshot(marker) }),
      },
      externalDomains: recipients,
      responseDomains: recipients,
      ...(scenario !== "default" && {
        afterChoice: {
          requests: 3,
          externalDomains: recipients,
          acceptedAll: scenario === "accepted",
        },
      }),
    },
  );
  visit.consentScenario = scenario;
  const policy = source(
    "policy",
    "declared_first_party",
    kind === "ads" ? quotes.ads : quotes.support,
    { type: "policy_section", heading: "Purposes", topic: "purpose" },
  );
  const sharing = source("sharing", "declared_first_party", quotes.sharing, {
    type: "policy_section",
    heading: "Recipients",
    topic: "sharing",
  });
  const evidence = [visit, policy, sharing];
  if (kind === "ads") {
    const request = source(
      "browser-network-" + scenario + "-1",
      "observed_technical",
      "An answered request.",
      {
        type: "browser_request_fields",
        scheme: "https",
        relation: "cross_site",
        method: "POST",
        targetDomain: "facebook.com",
        phase: scenario === "default" ? "before_choice" : "after_choice",
        fieldCategories: ["advertising_id", "event_name"],
        sources: ["query"],
        attempts: 1,
        responses: 1,
        initiator: "tested_top_level",
        signature: "meta_pixel_event",
        ...(scenario !== "default" && { matchedStorage: "fbp_cookie" }),
        ...overrides,
      },
    );
    request.consentScenario = scenario;
    evidence.push(request);
  }
  const report: ScanReport = {
    id,
    domain,
    completedAt: date,
    partial: false,
    demo: false,
    evidence,
    findings: [],
    consentCoverage: {
      default: "untested",
      accepted: "untested",
      rejected: "untested",
      [scenario]: "measured",
    },
    policyBrief: [
      {
        topic: "purpose",
        source: "policy",
        text: "The policy explains its purposes.",
        quote: policy.excerpt,
      },
      {
        topic: "sharing",
        source: "sharing",
        text: "The policy explains its recipients.",
        quote: sharing.excerpt,
      },
    ],
    dataPractices: [],
  };
  const facts = buildPracticeEvidenceBundle(report).practices;
  for (const fact of facts)
    report.dataPractices!.push(asPractice(fact, kind, policy));
  report.practiceCoverage = {
    facts: facts.length,
    retained: facts.length,
    analystReviewed: facts.length,
    truncated: false,
  };
  return scanReport.parse(report);
}

function asPractice(
  fact: PracticeEvidence,
  kind: Fixture,
  policy: Evidence,
): DataPractice {
  const { scenario, factId, trigger, request, linkage, evidenceIds } = fact;
  return {
    factId,
    scenario,
    dataClass:
      kind === "chat"
        ? "conversation_id"
        : kind === "ads"
          ? "persistent_browser_id"
          : "other",
    operation:
      fact.observed === "empty_visit"
        ? "observed_visit"
        : fact.observed === "storage_and_request"
          ? "stored_and_transmitted"
          : request
            ? "transmitted"
            : "stored",
    recipient: request?.targetDomain ?? domain,
    role: kind === "ads" ? "independent" : "site_operator",
    purpose: kind === "ads" ? "advertising" : "support",
    necessity: kind === "ads" ? "optional" : "proportionate",
    persistence: kind === "empty" ? "unknown" : "persistent",
    scope: request ? "cross_site" : "same_site",
    control: trigger,
    trigger: "The scanner tested a fresh signed-out visit.",
    confidence: "moderate",
    linkedIdentifier: linkage === "exact_ephemeral_match",
    evidence: {
      behavior: evidenceIds,
      link: linkage === "exact_ephemeral_match" ? evidenceIds : [],
      context: [policy.id],
    },
    interpretation: "analyst_reviewed",
    summary: "The browser and policy supplied this fixture evidence.",
    significance: "It describes the tested visit.",
    unknowns: [],
    mismatch: null,
    contextQuote: { source: policy.id, text: policy.excerpt },
  };
}

describe("contextual practice ratings", () => {
  it.each([
    [
      "google.com",
      "NID",
      "https://policies.google.com/technologies/cookies",
      "Advertising",
      "The ‘NID’ cookie can be used to show ads in Google services for signed-out users.",
      70,
    ],
    [
      "facebook.com",
      "datr",
      "https://www.facebook.com/privacy/policies/cookies?subpage=subpage-1.2",
      "Security, site and product integrity",
      "“Datr” is a unique identifier for your browser that, amongst other things, helps us protect you from fraud.",
      78,
    ],
  ] as const)(
    "assesses persistent first-party %s cookies with a cited declaration, without inferring transmission",
    (host, name, policyUrl, heading, excerpt, expected) => {
      const report = reportFor("chat", "accepted");
      report.domain = host;
      const [visit, policy] = report.evidence;
      const o = visit!.observation;
      if (o?.type !== "browser_consent_counts" || !o.storageSummary)
        throw Error("Missing snapshot");
      visit!.url = "https://www." + host + "/";
      o.storageSummary.beforeChoice = snapshot();
      Object.assign(o.storageSummary.end.cookies.recognized[0]!, {
        name,
        site: host,
      });
      o.externalDomains = ["assets.example"];
      Object.assign(policy!, {
        url: policyUrl,
        excerpt,
        observation: { type: "policy_section", heading, topic: "purpose" },
      });
      Object.assign(report, publishDataPractices(report));
      const practice = report.dataPractices![0]!;
      expect(practice).toMatchObject({
        recipient: null,
        purpose: "unknown",
        declaredPurpose: name === "NID" ? "advertising" : "security",
      });
      // Replay must also work for a stored practice from before declaredPurpose existed.
      delete practice.declaredPurpose;
      const scored = calculateAcceptAllScore(report)!;
      expect(scored.score).toBe(name === "NID" ? 70 : null);
      expect(scored.practiceAssessment!.ratings).toContainEqual(
        expect.objectContaining({
          score: expected,
          evidenceIds: [visit!.id, policy!.id],
          reason: expect.stringContaining(name),
        }),
      );
      policy!.url = "https://unrelated.example/cookies";
      expect(
        calculateAcceptAllScore(report)!.practiceAssessment!.ratings.every(
          (r) => r.score === null,
        ),
      ).toBe(true);
      policy!.url = policyUrl;
      policy!.excerpt = "We do not use cookies for advertising.";
      expect(
        calculateAcceptAllScore(report)!.practiceAssessment!.ratings.every(
          (r) => r.score === null,
        ),
      ).toBe(true);
    },
  );
  it("rates a corroborated no-choice visit without fabricating an accepted scenario", () => {
    const report = reportFor("empty");
    const coverage = {
      default: "measured",
      accepted: "control_unavailable",
      rejected: "control_unavailable",
    } as const;
    const homepage = report.evidence[0];
    const visit = homepage.observation;
    if (visit?.type !== "browser_consent_counts")
      throw Error("Expected homepage");
    const url = page + "article";
    const policy = report.evidence[1];
    policy.url = page + "privacy";
    policy.excerpt =
      "For example.com visitors, we do not use cookies and we do not collect any personal data.";
    report.consentCoverage = coverage;
    report.pageSample = {
      discovered: 1,
      discoveryLimited: false,
      limit: 3,
      pages: [{ url, source: "sitemap", coverage }],
    };
    report.evidence.push({
      ...homepage,
      url,
      id: "browser-page-1-default",
      observation: { ...visit, type: "browser_content_page", network: [] },
    });
    report.dataPractices = buildPracticeEvidenceBundle(report).practices.map(
      (fact) => asPractice(fact, "empty", policy),
    );
    report.practiceCoverage = {
      facts: 2,
      retained: 2,
      truncated: false,
      analystReviewed: 2,
    };
    expect(evaluateHeadline(report).rating.score).toBeNull();
    report.scoring = calculateScore(report);
    expect(evaluateHeadline(report)).toMatchObject({
      scenario: "default",
      rating: {
        score: 80,
        noChoiceEvidence: {
          policyId: policy.id,
          visitIds: [homepage.id, "browser-page-1-default"],
        },
      },
    });
    expect(calculateAcceptAllScore(report)).toBeUndefined();
    for (const [disclosure, supported] of [
      [
        "When you visit our website, we do not set cookies. We do not collect personal information about visitors.",
        true,
      ],
      [
        "For visitors to this site, we never collect personal data and we never set cookies.",
        true,
      ],
      [
        "For another.com visitors, we do not use cookies and we do not collect any personal data.",
        false,
      ],
      [
        "When you visit our website, we do not set cookies. We do not collect personal information about visitors unless you opt in.",
        false,
      ],
      [
        "If you reject optional analytics, for example.com visitors, we do not use cookies and we do not collect any personal data.",
        false,
      ],
    ] as const) {
      const evidence = report.evidence.map((e) =>
        e.id === policy.id ? { ...e, excerpt: disclosure } : e,
      );
      expect(
        Boolean(calculateScore({ ...report, evidence }).noChoiceEvidence),
      ).toBe(supported);
    }
    for (const change of [
      { partial: true },
      { consentCoverage: { ...coverage, rejected: "inconclusive" as const } },
      { evidence: report.evidence.filter((e) => e.id !== policy.id) },
      {
        evidence: report.evidence.map((e) =>
          e.id === homepage.id
            ? {
                ...e,
                observation: { ...visit, externalDomains: ["outside.org"] },
              }
            : e,
        ),
      },
      { pageSample: { ...report.pageSample, pages: [] } },
    ]) {
      const altered = { ...report, ...change };
      expect(calculateScore(altered).noChoiceEvidence).toBeUndefined();
    }
    report.scoring.rulesRevision = "contextual-practices-4";
    expect(evaluateHeadline(report).rating.score).toBeNull();
  });
  it("distinguishes a declared storage purpose from observed use when the accepted inventory is fully assessed", () => {
    const report = reportFor("chat", "accepted");
    const visit = report.evidence[0].observation;
    if (visit?.type !== "browser_consent_counts" || !visit.storageSummary)
      throw Error("Expected accepted inventory");
    visit.storageSummary.beforeChoice = snapshot();
    visit.storageSummary.end.cookies = {
      total: 1,
      inspected: 1,
      recognized: [],
    };
    Object.assign(report, publishDataPractices(report));
    report.acceptAllScoring = calculateAcceptAllScore(report);
    expect(evaluateHeadline(report).rating).toMatchObject({
      score: null,
      verdict:
        "Accept all was confirmed. How the site used the stored items remains unclear.",
    });
    expect(
      evaluateHeadline({
        ...report,
        practiceCoverage: { ...report.practiceCoverage!, truncated: true },
      }).rating.verdict,
    ).toBe(
      "Accept all was measured, but the observed activity could not be rated.",
    );
    expect(
      evaluateHeadline({
        ...report,
        consentCoverage: {
          ...report.consentCoverage!,
          accepted: "control_unavailable",
        },
      }).rating.verdict,
    ).toBe("No Accept all option was found on the tested page.");
  });
  it("grounds the observed event in both the named provider and the governing advertising terms", () => {
    const report = reportFor("ads", "accepted", {
      targetDomain: "permutive.app",
      signature: "permutive_event",
      fieldCategories: ["identifier", "event_name"],
      matchedStorage: undefined,
    });
    const visit = report.evidence[0]!.observation;
    if (visit?.type !== "browser_consent_counts" || !visit.afterChoice)
      throw Error("missing visit");
    visit.externalDomains =
      visit.responseDomains =
      visit.afterChoice.externalDomains =
        ["permutive.app"];
    const section = {
      type: "policy_section",
      topic: "sharing",
      heading: "Advertising recipients",
    } as const;
    const intro = source(
      "list-intro",
      "declared_first_party",
      "With consent we use these providers for advertising. They are controllers for their respective services.",
      section,
    );
    const entry = source(
      "vendor-permutive",
      "declared_first_party",
      "Permutive Technologies Inc.",
      {
        ...section,
        vendorListing: {
          contextEvidenceId: intro.id,
          policyUrl: "https://permutive.com/privacy/",
        },
      },
    );
    report.evidence.push(intro, entry);
    const fact = buildPracticeEvidenceBundle(report).practices.find(
      (f) => f.request,
    )!;
    const judge = () => {
      Object.assign(
        report,
        publishDataPractices(report, [
          {
            factId: fact.factId,
            purpose: "advertising",
            role: "service_controller",
            necessity: "optional",
            confidence: "moderate",
            context: {
              source: intro.id,
              text: "They are controllers for their respective services.",
            },
            possibleConsentConflict: false,
          },
        ]),
      );
      return calculateAcceptAllScore(report)!;
    };
    expect(selectAnalysisEvidence(report.evidence).map((s) => s.id)).toEqual(
      expect.arrayContaining([entry.id, intro.id]),
    );
    const rating = judge();
    expect(rating.score).toBe(60);
    expect(
      rating.practiceAssessment!.ratings.find((r) => r.factId === fact.factId),
    ).toMatchObject({
      evidenceIds: [...fact.evidenceIds, intro.id, entry.id],
    });
    // A similar name, an unrelated provider link or a quotation on another page
    // cannot give an anonymous event an advertising role.
    entry.url = "https://example.com/unrelated";
    expect(judge().score).toBe(70);
    entry.url = intro.url;
    if (
      entry.observation?.type !== "policy_section" ||
      !entry.observation.vendorListing
    )
      throw Error("missing entry");
    entry.observation.vendorListing.policyUrl =
      "https://permutive.com.example.org/privacy";
    expect(judge().score).toBe(70);
  });
  it("distinguishes support continuity from an independently used advertising identifier after rejection", () => {
    const support = calculateScore(reportFor("chat"));
    expect(support).toMatchObject({
      score: 85,
      confidence: "Low",
      rulesRevision: "contextual-practices-5",
      adjustments: [],
    });
    expect(support).not.toHaveProperty("baseScore");
    const rejected = reportFor("ads", "rejected");
    const result = calculateRejectScore(rejected)!;
    expect(result).toMatchObject({ score: 15, grade: "Critical" });
    const joined = result.practiceAssessment!.ratings.find(
      (item) => item.score === 15,
    )!;
    expect(joined.evidenceIds).toEqual([
      "browser-consent-rejected",
      "browser-network-rejected-1",
      "policy",
    ]);
    expect(
      evaluateHeadline({
        ...rejected,
        scoring: calculateScore(rejected),
        rejectedScoring: result,
      }),
    ).toMatchObject({ scenario: "accepted", rating: { score: null } });
    expect(calculateAcceptAllScore(reportFor("ads", "accepted"))?.score).toBe(
      50,
    );
    expect(calculateScore(reportFor("ads")).score).toBe(45);
  });
  it.each([
    ["unclassified recipient", { role: "unknown" }, 50],
    ["unknown purpose", { purpose: "unknown" }, 50],
    ["observed only", { interpretation: "observed_only" }, 50],
    [
      "conditional policy only",
      { operation: "declared", control: "conditional" },
      null,
    ],
    ["context quote absent", { contextQuote: undefined }, 50],
    ["low confidence", { confidence: "low" }, 50],
    [
      "unsupported evidence link",
      { evidence: { behavior: [], link: [], context: ["policy"] } },
      null,
    ],
  ] as const)(
    "keeps a limited or absent rating for %s",
    (_, changes, score) => {
      const report = reportFor("ads", "rejected");
      report.dataPractices = report.dataPractices!.map(
        (practice) => ({ ...practice, ...changes }) as DataPractice,
      );
      expect(calculateRejectScore(report)).toMatchObject({
        score,
        confidence: "Low",
      });
    },
  );
  it("keeps attempted, opaque and unknown-initiator traffic as evidence without asserting an independent transmission", () => {
    for (const [fields, score] of [
      [{ responses: 0 }, null],
      [{ initiator: "unknown" as const }, 60],
      [{ fieldCategories: ["language" as const], signature: undefined }, null],
    ] as const) {
      const report = reportFor(
        "ads",
        "rejected",
        fields as Partial<BrowserRequestFields>,
      );
      expect(
        report.dataPractices!.some((practice) =>
          practice.evidence.behavior.some((key) => key.includes("network")),
        ),
      ).toBe(true);
      expect(calculateRejectScore(report)).toMatchObject({
        score,
        confidence: "Low",
      });
    }
  });
  it("requires exact in-visit linkage to apply the strongest advertising rule", () => {
    const report = reportFor("ads", "rejected", { matchedStorage: undefined });
    expect(calculateRejectScore(report)?.score).toBe(30);
    // Asserting linkage in a model response cannot upgrade a mere co-occurrence.
    for (const practice of report.dataPractices!)
      practice.linkedIdentifier = true;
    expect(calculateRejectScore(report)?.score).toBe(30);
  });
  it("only rates a quiet visit provisionally with both policy topics and complete inspected coverage", () => {
    const report = reportFor("empty");
    expect(calculateScore(report)).toMatchObject({
      score: 80,
      confidence: "Low",
    });
    for (const changed of [
      { partial: true },
      { policyBrief: [] },
      { dataPractices: [] },
      { practiceCoverage: { ...report.practiceCoverage!, truncated: true } },
    ])
      expect(calculateScore({ ...report, ...changed }).score).toBeNull();
    const visit = report.evidence[0].observation;
    if (visit?.type !== "browser_consent_counts") throw Error("fixture");
    visit.externalDomains = ["unclassified.example.com"];
    expect(calculateScore(report).score).toBeNull();
  });
  it("accepts a cited purpose outside the short policy summary and rejects unsupported claims", () => {
    const report = reportFor("empty");
    const [purpose, recipients] = report.policyBrief!;
    report.policyBrief = [recipients];
    const claim = {
      category: "purpose" as const,
      confidence: "moderate" as const,
      text: purpose.text,
      source: purpose.source,
      quote: purpose.quote!,
    };
    expect(calculateScore({ ...report, policyClaims: [claim] }).score).toBe(80);
    for (const unsupported of [
      { ...claim, confidence: "low" as const },
      { ...claim, quote: "A different document." },
      { ...claim, source: recipients.source },
      { ...claim, source: "another-scan" },
    ])
      expect(
        calculateScore({ ...report, policyClaims: [unsupported] }).score,
      ).toBeNull();
  });
  it("treats identical measured quiet pages equally when the analyst reviewed a subset", () => {
    const report = reportFor("empty");
    const first = report.evidence[0];
    const visit = first.observation!;
    if (visit.type !== "browser_consent_counts")
      throw new Error("Unexpected fixture");
    report.pageSample = {
      limit: 1,
      discoveryLimited: false,
      discovered: 1,
      pages: [
        {
          url: page + "contact",
          source: "homepage_link",
          coverage: report.consentCoverage!,
        },
      ],
    };
    report.evidence.push({
      ...first,
      id: "browser-page-1-default",
      url: page + "contact",
      observation: { ...visit, type: "browser_content_page", network: [] },
    });
    const homepage = buildPracticeEvidenceBundle(report).practices.find(
      (f) => f.page === "homepage",
    )!;
    Object.assign(
      report,
      publishDataPractices(report, [
        {
          factId: homepage.factId,
          role: "unknown",
          purpose: "unknown",
          necessity: "unclear",
          confidence: "moderate",
          context: null,
          possibleConsentConflict: false,
        },
      ]),
    );
    const result = calculateScore(report);
    expect(result).toMatchObject({
      score: 80,
      confidence: "Low",
      rulesRevision: "contextual-practices-5",
    });
    expect(result.practiceAssessment!.ratings.map((r) => r.score)).toEqual([
      80, 80,
    ]);
    expect(result.practiceAssessment!.coverage).toContain(
      "before a consent choice",
    );
    report.evidence.at(-1)!.observation = {
      ...visit,
      type: "browser_content_page",
      network: [],
      externalDomains: ["unknown.example.net"],
    };
    expect(calculateScore(report).score).toBeNull();
  });
  it("protects archived numeric results and ignores an unconfirmed reject scenario", () => {
    const report = reportFor("ads", "rejected");
    report.rejectedScoring = calculateRejectScore(report);
    const archived = {
      methodologyVersion: "1.0.0",
      baseScore: 75,
      adjustments: [],
      score: 65,
      grade: "Mixed",
      verdict: "Archived",
      confidence: "Moderate",
    } as const;
    report.scoring = { ...archived, adjustments: [] };
    report.consentCoverage!.rejected = "control_unavailable";
    expect(verifiedRejectRating(report)).toBeUndefined();
    expect(evaluateHeadline(report)).toMatchObject({
      scenario: "accepted",
      rating: { score: null, grade: "Unrated" },
    });
  });
  it("publishes the two opposite fixture practices through the real citation and storage publisher", () => {
    for (const kind of ["chat", "ads"] as const) {
      const scenario = kind === "chat" ? "default" : "rejected";
      const report = reportFor(kind, scenario);
      const policy = report.evidence.find((item) => item.id === "policy")!;
      const judgments = buildPracticeEvidenceBundle(report).practices.map(
        (fact) => ({
          factId: fact.factId,
          purpose:
            kind === "chat" ? ("support" as const) : ("advertising" as const),
          role:
            kind === "chat"
              ? ("site_operator" as const)
              : ("independent" as const),
          necessity:
            kind === "chat"
              ? ("proportionate" as const)
              : ("optional" as const),
          confidence: "moderate" as const,
          context: { source: policy.id, text: policy.excerpt },
          possibleConsentConflict: false,
        }),
      );
      Object.assign(report, publishDataPractices(report, judgments));
      const score = () =>
        kind === "chat"
          ? calculateScore(report)
          : calculateRejectScore(report)!;
      expect(score().score).toBe(kind === "chat" ? 85 : 15);
      Object.assign(report, publishDataPractices(report)); // provider unavailable
      expect(score()).toMatchObject({
        score: kind === "chat" ? null : 50,
        confidence: "Low",
      });
    }
  });
  it("does not classify a documented processor serving requested support as unexplained advertising or a leak", () => {
    const report = reportFor("ads", "rejected", {
      fieldCategories: ["email_address_value"],
      signature: undefined,
      matchedStorage: undefined,
      targetDomain: "support.example.net",
    });
    const policy = report.evidence.find((item) => item.id === "policy")!;
    policy.excerpt =
      "For requested support, support.example.net is our processor and handles a contact address on our behalf to reply.";
    const visit = report.evidence[0].observation!;
    if (visit.type !== "browser_consent_counts")
      throw new Error("Unexpected fixture");
    visit.externalDomains = visit.responseDomains = ["support.example.net"];
    visit.afterChoice!.externalDomains = ["support.example.net"];
    const fact = buildPracticeEvidenceBundle(report).practices.find(
      (f) => f.request,
    )!;
    Object.assign(
      report,
      publishDataPractices(report, [
        {
          factId: fact.factId,
          purpose: "support",
          role: "processor",
          necessity: "proportionate",
          confidence: "moderate",
          context: { source: policy.id, text: policy.excerpt },
          possibleConsentConflict: false,
        },
      ]),
    );
    const result = calculateRejectScore(report)!;
    expect(result.score).toBeNull();
    expect(
      result.practiceAssessment!.ratings.find((r) => r.factId === fact.factId)
        ?.reason,
    ).toContain("operational feature");
  });
  it("can publish a recognized persistent browser ID without assigning a purpose or recipient", () => {
    const report = reportFor("ads");
    report.evidence = report.evidence.filter(
      (e) => e.observation?.type !== "browser_request_fields",
    );
    Object.assign(report, publishDataPractices(report));
    const result = calculateScore(report);
    expect(result).toMatchObject({ score: 72, confidence: "Low" });
    expect(result.practiceAssessment!.ratings[0].reason).toContain(
      "remain unverified",
    );
  });
});
