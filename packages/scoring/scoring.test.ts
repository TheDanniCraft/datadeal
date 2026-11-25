import { describe, expect, it } from "vitest";
import { calculateAcceptAllScore, calculateScore, evaluate } from "./index";
import type { ScanReport } from "@datadeal/contracts";

const id = "00100000-0000-4000-8000-000000000005";
const completedAt = "2026-01-01T12:00:00.000Z";
const baseline: ScanReport = {
  id,
  completedAt,
  domain: "example.com",
  demo: true,
  partial: false,
  evidence: [
    {
      id: "e1",
      scanId: id,
      kind: "observed_technical",
      excerpt: "Fixture",
      retrievedAt: completedAt,
    },
  ],
  findings: (
    ["policy_available", "optional_control", "necessary_processor"] as const
  ).map((rule) => ({
    rule,
    title: rule,
    explanation: rule,
    confidence: "moderate",
    severity: "positive",
    evidenceIds: ["e1"],
  })),
};

describe("versioned scoring", () => {
  it("keeps a public agreement neutral even if a stored finding tries to score it", () => {
    const report: ScanReport = {
      ...baseline,
      evidence: [
        {
          ...baseline.evidence[0],
          kind: "declared_first_party",
          observation: {
            type: "processing_document",
            document: "dpa",
            heading: "Processor obligations",
          },
        },
      ],
    };
    expect(calculateScore(report).adjustments).toEqual([]);
  });
  it("counts a populated outside advertising field once only in its measured scenario", () => {
    const source: ScanReport["evidence"][number] = {
      ...baseline.evidence[0],
      id: "request",
      consentScenario: "default",
      observation: {
        type: "browser_request_fields",
        scheme: "https",
        relation: "cross_site",
        method: "POST",
        phase: "before_choice",
        targetDomain: "advertiser.example",
        attempts: 2,
        responses: 1,
        fieldCategories: ["advertising_id"],
        sources: ["json"],
      },
    };
    const score = (rows: typeof baseline.evidence) =>
      calculateScore({
        ...baseline,
        evidence: [...baseline.evidence, ...rows],
      });
    const o = source.observation!;
    if (o.type !== "browser_request_fields")
      throw new Error("Unexpected fixture");
    expect(score([source, { ...source, id: "another" }]).score).toBe(80);
    for (const row of [
      { ...source, consentScenario: "accepted" as const },
      { ...source, observation: { ...o, responses: 0 } },
      { ...source, observation: { ...o, relation: "same_site" as const } },
      {
        ...source,
        observation: { ...o, fieldCategories: ["email_value" as const] },
      },
    ])
      expect(score([row]).score).toBe(90);
    const disclosure: typeof source = {
      ...baseline.evidence[0],
      id: "adpolicy",
      kind: "declared_first_party",
      excerpt: "We share personal data with advertisers.",
      observation: {
        type: "policy_section",
        heading: "Sharing",
        topic: "sharing",
      },
    };
    expect(score([source, disclosure]).score).toBe(75);
  });
  it("scores an explicit accept-all visit separately and leaves other choices unscored", () => {
    const observation = {
      type: "browser_consent_counts" as const,
      requests: 2,
      cookies: 0,
      storage: { localEntries: 0, sessionEntries: 0 },
      externalDomains: [],
    };
    const defaultVisit = {
      ...baseline.evidence[0],
      id: "default",
      consentScenario: "default" as const,
      observation,
    };
    const accepted = {
      ...defaultVisit,
      id: "accepted",
      consentScenario: "accepted" as const,
      observation: {
        ...observation,
        cookies: 2,
        afterChoice: { externalDomains: [], requests: 1, acceptedAll: true },
      },
    };
    const sharing = {
      ...baseline.evidence[0],
      id: "policy",
      kind: "declared_first_party" as const,
      observation: {
        type: "policy_section" as const,
        topic: "sharing" as const,
        heading: "Who receives information",
      },
      excerpt:
        "Here’s more detail about who we share information with: Partners Advertisers and Audience Network publishers (if we show you ads).",
    };
    const report: ScanReport = {
      ...baseline,
      demo: false,
      findings: [baseline.findings[0]],
      consentCoverage: {
        default: "measured",
        accepted: "measured",
        rejected: "untested",
      },
      evidence: [...baseline.evidence, sharing, defaultVisit, accepted],
    };
    expect(calculateScore(report).score).toBe(70);
    const result = calculateAcceptAllScore(report);
    expect(result?.score).toBe(65);
    expect(
      result?.adjustments.some((item) => item.evidenceIds.includes("default")),
    ).toBe(false);
    const prior = {
      ...report,
      scoring: { ...calculateScore(report), score: 85 },
    };
    expect(evaluate(prior).score).toBe(85);
    expect(
      evaluate({
        ...prior,
        scoringCorrection: {
          correctedAt: completedAt,
          reason: "Corrected advertising disclosure",
          result: calculateScore(report),
        },
      }).score,
    ).toBe(70);
    for (const acceptedAll of [false, undefined]) {
      expect(
        calculateAcceptAllScore({
          ...report,
          evidence: [
            defaultVisit,
            {
              ...accepted,
              observation: {
                ...accepted.observation,
                afterChoice: {
                  ...accepted.observation.afterChoice,
                  acceptedAll,
                },
              },
            },
          ],
        }),
      ).toBeUndefined();
    }
    expect(
      calculateAcceptAllScore({
        ...report,
        consentCoverage: {
          default: "measured",
          accepted: "inconclusive",
          rejected: "measured",
        },
      }),
    ).toBeUndefined();
  });
  it("scores a settings-dependent personalization disclosure from a cited purpose section", () => {
    const evidence: ScanReport["evidence"][number] = {
      ...baseline.evidence[0],
      id: "ads-purpose",
      kind: "declared_first_party",
      excerpt:
        "Depending on your settings, we may show you personalized ads based on your interests or activity.",
      observation: {
        type: "policy_section",
        topic: "purpose",
        heading: "Advertising",
      },
    };
    const score = (source: typeof evidence) =>
      calculateScore({ ...baseline, evidence: [...baseline.evidence, source] });
    expect(score(evidence).adjustments.at(-1)).toMatchObject({
      rule: "declared_ad_personalization",
      adjustment: -5,
      evidenceIds: [evidence.id],
    });
    expect(
      score({
        ...evidence,
        excerpt: "We do not use your interests for personalized ads.",
      }).score,
    ).toBe(90);
  });
  it("requires a default visit and cited purpose before a processor disclosure supports a grade", () => {
    const policy = (topic: "purpose" | "sharing", excerpt: string) => ({
      ...baseline.evidence[0],
      id: topic,
      kind: "declared_first_party" as const,
      observation: { type: "policy_section" as const, topic, heading: topic },
      excerpt,
    });
    const sources = [
      policy("purpose", "We use information to deliver requested services."),
      policy("sharing", "Providers process it for us under our instructions."),
    ];
    const visit = {
      ...baseline.evidence[0],
      id: "standard",
      consentScenario: "default" as const,
      observation: {
        type: "browser_consent_counts" as const,
        requests: 2,
        cookies: 1,
        externalDomains: [],
      },
    };
    const report: ScanReport = {
      ...baseline,
      demo: false,
      evidence: [...baseline.evidence, ...sources, visit],
      findings: [baseline.findings[0]],
      policyBrief: sources.map(({ id, excerpt, observation }) => ({
        topic: observation.topic,
        source: id,
        text: excerpt,
        quote: excerpt,
      })),
    };
    const score = calculateScore(report);
    expect(score.score).toBe(80);
    expect(score.adjustments.at(-1)).toMatchObject({
      rule: "declared_processor",
      adjustment: 0,
      evidenceIds: ["sharing"],
    });
    expect(
      calculateScore({ ...report, evidence: report.evidence.slice(0, -1) })
        .score,
    ).toBeNull();
    expect(
      calculateScore({
        ...report,
        policyBrief: report.policyBrief?.filter(
          ({ topic }) => topic !== "purpose",
        ),
      }).score,
    ).toBeNull();
  });
  it("retains the consent condition on a German identifier-sharing disclosure", () => {
    const source: ScanReport["evidence"][number] = {
      ...baseline.evidence[0],
      id: "conditional-ad-sharing",
      kind: "declared_first_party",
      excerpt:
        "Wenn Sie Ihre Einwilligung für shop.example erteilt haben, nutzen wir Kennungen für Werbung. Wir nutzen Dienste externer Dritter, die gemäß Art. 4 DSGVO für ihre Verarbeitung verantwortlich sind.",
      observation: {
        type: "policy_section",
        topic: "sharing",
        heading: "Weitergabe von Nutzerkennungen zu Werbezwecken",
      },
    };
    const result = calculateScore({
      ...baseline,
      evidence: [...baseline.evidence, source],
    });
    expect(result.adjustments.at(-1)).toMatchObject({
      rule: "declared_advertising_sharing",
      adjustment: 0,
      explanation: expect.stringMatching(/if you consent to tracking/i),
      evidenceIds: [source.id],
    });
  });
  it("scores an explicit recipient disclosure independently of AI-selected quotations", () => {
    const quote = "We share personal data with advertisers.";
    const source: ScanReport["evidence"][number] = {
      ...baseline.evidence[0],
      id: "advertiser-disclosure",
      kind: "declared_first_party",
      excerpt: quote,
      observation: {
        type: "policy_section",
        topic: "sharing",
        heading: "Advertising partners",
      },
    };
    const claim = {
      category: "recipient",
      confidence: "moderate",
      text: "The policy lists advertising partners.",
      source: source.id,
      quote,
    } as const;
    const report = { ...baseline, evidence: [...baseline.evidence, source] };
    const result = calculateScore({ ...report, policyClaims: [claim] });
    expect(result.adjustments).toContainEqual(
      expect.objectContaining({
        rule: "declared_advertising_sharing",
        adjustment: -15,
        evidenceIds: [source.id],
      }),
    );
    for (const omittedOrInvalid of [
      undefined,
      { ...claim, confidence: "low" as const },
      { ...claim, quote: "We share personal information with advertisers." },
    ]) {
      const replay = calculateScore({
        ...report,
        policyClaims: omittedOrInvalid ? [omittedOrInvalid] : [],
      });
      expect(replay.adjustments).toEqual(result.adjustments);
    }
    for (const unsupportedSource of [
      { ...source, excerpt: "It is false that " + quote },
      {
        ...source,
        excerpt:
          "We share personal data with advertisers only in aggregated, anonymous form.",
      },
      { ...source, kind: "inferred_infrastructure" as const },
      { ...source, scanId: "previous-scan" },
      {
        ...source,
        observation: {
          type: "policy_section" as const,
          topic: "purpose" as const,
          heading: "Advertising",
        },
      },
    ]) {
      const replay = calculateScore({
        ...report,
        evidence: [...baseline.evidence, unsupportedSource],
        policyClaims: [claim],
      });
      expect(replay.adjustments).not.toContainEqual(
        expect.objectContaining({ rule: "declared_advertising_sharing" }),
      );
    }
  });
  it("retains the ads-shown condition for a recipient list across different quote boundaries", () => {
    const list =
      "Partner Werbetreibende und Audience Network-Publisher (wenn wir dir Werbeanzeigen zeigen)";
    const disclosure =
      "Weitere Einzelheiten dazu, an wen wir Informationen weitergeben: " +
      list;
    const denySale =
      "Wir verkaufen keine deiner Informationen an irgendjemanden.";
    const score = (excerpt: string, quote: string) =>
      calculateScore({
        ...baseline,
        domain: "unrelated.example",
        evidence: [
          ...baseline.evidence,
          {
            ...baseline.evidence[0],
            id: "recipients",
            kind: "declared_first_party",
            excerpt,
            observation: {
              type: "policy_section",
              topic: "sharing",
              heading: "Empfänger",
            },
          },
        ],
        policyBrief: [
          {
            topic: "sharing",
            source: "recipients",
            quote,
            text: "Policy recipients.",
          },
        ],
      });
    for (const quote of [list, disclosure, denySale]) {
      const result = score(
        denySale +
          " " +
          disclosure +
          "Partner, die unsere Analysedienste nutzen",
        quote,
      );
      expect(result.adjustments.at(-1)).toMatchObject({
        rule: "declared_advertising_sharing",
        adjustment: -15,
        evidenceIds: ["recipients"],
        explanation: expect.stringContaining("when ads are shown to you"),
      });
    }
    for (const insufficient of [
      denySale,
      list,
      "Nicht zutreffend: " + disclosure,
      disclosure.replace("weitergeben:", "nicht weitergeben:"),
      disclosure.replace(
        "wenn wir dir Werbeanzeigen zeigen",
        "nur in anonymisierter Form",
      ),
    ]) {
      expect(score(insufficient, insufficient).adjustments).not.toContainEqual(
        expect.objectContaining({ rule: "declared_advertising_sharing" }),
      );
    }
  });
  it("derives measured advertising only when the default response and policy agree", () => {
    const publication: ScanReport["evidence"][number] = {
      ...baseline.evidence[0],
      id: "ad-policy",
      kind: "declared_first_party",
      excerpt: "We share personal information with Google Ad Manager.",
      observation: {
        type: "policy_section",
        topic: "sharing",
        heading: "Sharing",
      },
    };
    const visit = {
      ...baseline.evidence[0],
      id: "visit",
      consentScenario: "default" as const,
      observation: {
        type: "browser_consent_counts" as const,
        requests: 4,
        cookies: 1,
        externalDomains: ["doubleclick.net"],
        responseDomains: ["doubleclick.net"],
      },
    };
    const result = (evidence: ScanReport["evidence"]) =>
      calculateScore({
        ...baseline,
        evidence: [...baseline.evidence, ...evidence],
      });
    expect(result([visit, publication]).adjustments[0]).toMatchObject({
      rule: "independent_ads",
      adjustment: -20,
      evidenceIds: ["visit", "ad-policy"],
    });
    expect(result([visit]).score).toBe(90);
    expect(
      result([
        visit,
        {
          ...publication,
          excerpt:
            "It is false that we share personal information with Google Ad Manager.",
        },
      ]).score,
    ).toBe(90);
    expect(
      result([{ ...visit, consentScenario: "accepted" }, publication]).score,
    ).toBe(90);
    expect(
      result([
        {
          ...visit,
          observation: { ...visit.observation, responseDomains: [] },
        },
        publication,
      ]).score,
    ).toBe(90);
  });
  it.each(["0.9.0", "1.0.0.0", "1.2.0"])(
    "reads a published rating with its original methodology version %s",
    (archivedVersion) => {
      const published = {
        ...calculateScore(baseline),
        methodologyVersion: archivedVersion,
      };
      const archived = { ...baseline, scoring: published };
      expect(evaluate(archived)).toEqual(published);
      expect(calculateScore(archived).methodologyVersion).toBe("1.0.0");
    },
  );
  it("applies evidence-backed rules once and keeps necessary processing neutral", () => {
    const result = evaluate({
      ...baseline,
      findings: [...baseline.findings, baseline.findings[0]],
    });
    expect(result.score).toBe(90);
    expect(
      result.adjustments.find((item) => item.rule === "necessary_processor")
        ?.adjustment,
    ).toBe(0);
    expect(
      result.adjustments
        .filter((item) => item.rule === "policy_available")
        .map((item) => item.adjustment),
    ).toEqual([5, 0]);
  });
  it("withholds the score when evidence is missing or incomplete", () => {
    expect(evaluate({ ...baseline, partial: true }).score).toBeNull();
    expect(evaluate({ ...baseline, evidence: [] }).score).toBeNull();
  });
  it("awards a bounded adjustment only for measured empty storage on the default visit", () => {
    const standard = {
      ...baseline.evidence[0],
      id: "standard-visit",
      consentScenario: "default" as const,
      observation: {
        type: "browser_consent_counts" as const,
        requests: 37,
        cookies: 0,
        storage: { localEntries: 0, sessionEntries: 0 },
        externalDomains: [],
      },
    };
    const score = (visit: ScanReport["evidence"][number]) =>
      calculateScore({
        ...baseline,
        evidence: [...baseline.evidence, visit],
        findings: [baseline.findings[0]],
      });
    expect(score(standard).score).toBe(85);
    const shallowLive: ScanReport = {
      ...baseline,
      demo: false,
      evidence: [...baseline.evidence, standard],
      findings: [baseline.findings[0]],
    };
    expect(calculateScore(shallowLive).score).toBeNull();
    const policySections = (["purpose", "sharing"] as const).map((topic) => ({
      ...baseline.evidence[0],
      id: topic,
      kind: "declared_first_party" as const,
      excerpt: `The policy expressly describes ${topic} for the service.`,
      observation: { type: "policy_section" as const, topic, heading: topic },
    }));
    expect(
      calculateScore({
        ...shallowLive,
        evidence: [...shallowLive.evidence, ...policySections],
        policyBrief: policySections.map(({ id, excerpt, observation }) => ({
          topic: observation.topic,
          source: id,
          text: excerpt,
          quote: excerpt,
        })),
      }).score,
    ).toBe(85);
    expect(score(standard).adjustments.at(-1)).toMatchObject({
      rule: "no_default_browser_storage",
      adjustment: 5,
      evidenceIds: [standard.id],
    });
    expect(
      score({ ...standard, consentScenario: "rejected" }).score,
    ).toBeNull();
    expect(
      score({
        ...standard,
        observation: { ...standard.observation, storage: undefined },
      }).score,
    ).toBeNull();
    expect(
      score({
        ...standard,
        observation: { ...standard.observation, cookies: 1 },
      }).score,
    ).toBeNull();
  });
  it("does not award points for clicking a reject control alone", () => {
    const click = {
      ...baseline.evidence[0],
      id: "reject-click",
      consentScenario: "rejected" as const,
      observation: {
        type: "browser_consent_counts" as const,
        requests: 3,
        cookies: 1,
        externalDomains: [],
        afterChoice: { requests: 1, externalDomains: [] },
      },
    };
    const result = calculateScore({
      ...baseline,
      evidence: [...baseline.evidence, click],
      findings: baseline.findings.map((finding) =>
        finding.rule === "optional_control"
          ? { ...finding, evidenceIds: [click.id] }
          : finding,
      ),
    });
    expect(
      result.adjustments.find(({ rule }) => rule === "optional_control")
        ?.adjustment,
    ).toBe(0);
    expect(result.score).toBeNull();
  });
  it.each([
    [undefined, 90, 0],
    ["accepted", 90, 0],
    ["rejected", 90, 0],
    ["default", 70, -20],
  ] as const)(
    "scores advertising from a %s visit only if it represents the default",
    (consentScenario, score, adjustment) => {
      const result = calculateScore({
        ...baseline,
        evidence: [
          ...baseline.evidence,
          { ...baseline.evidence[0], id: "ads", consentScenario },
        ],
        findings: [
          ...baseline.findings,
          {
            rule: "independent_ads",
            title: "Advertising request",
            explanation: "The browser attempted an advertising request.",
            confidence: "high",
            severity: "caution",
            evidenceIds: ["ads"],
          },
        ],
      });
      expect(result.score).toBe(score);
      expect(result.adjustments.at(-1)?.adjustment).toBe(adjustment);
    },
  );
  it("deducts for verified advertising disclosures once, using the measured factor when available", () => {
    const quote =
      "An wen wir Informationen weitergeben: Partner, Werbetreibende und Publisher.";
    const sharing: ScanReport["evidence"][number] = {
      ...baseline.evidence[0],
      id: "sharing",
      kind: "declared_first_party",
      excerpt: quote,
      observation: {
        type: "policy_section",
        topic: "sharing",
        heading: "Empfänger",
      },
    };
    const report: ScanReport = {
      ...baseline,
      evidence: [...baseline.evidence, sharing],
      policyBrief: [
        { topic: "sharing", source: sharing.id, text: quote, quote },
      ],
    };
    expect(calculateScore(report).adjustments.at(-1)).toMatchObject({
      rule: "declared_advertising_sharing",
      adjustment: -15,
      evidenceIds: [sharing.id],
    });
    expect(
      calculateScore({
        ...report,
        evidence: [
          ...baseline.evidence,
          {
            ...sharing,
            excerpt: "We do not share information with advertisers.",
          },
        ],
      }).score,
    ).toBe(90);
    const observed = {
      ...baseline.evidence[0],
      id: "ads",
      consentScenario: "default" as const,
    };
    const result = calculateScore({
      ...report,
      evidence: [...report.evidence, observed],
      findings: [
        ...report.findings,
        {
          rule: "independent_ads",
          title: "Advertising connection",
          explanation: "Measured on the default visit.",
          confidence: "high",
          severity: "caution",
          evidenceIds: [observed.id],
        },
      ],
    });
    expect(result.score).toBe(70);
    expect(result.adjustments.at(-1)).toMatchObject({
      rule: "declared_advertising_sharing",
      adjustment: 0,
    });
  });
});
