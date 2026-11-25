import type {
  BrowserRequestFields,
  BrowserStorageSnapshot,
  Evidence,
  ScanReport,
} from "@datadeal/contracts";
import { describe, expect, it } from "vitest";
import {
  acceptAllScoreChange,
  calculateScore,
  calculateAcceptAllScore,
  evaluateHeadline,
  verifiedAcceptAllRating,
} from "./index";

const id = "77ee51a5-6593-48e2-9d57-030bbba6f11d";
const retrievedAt = "2026-11-25T12:00:00.000Z";
const empty: BrowserStorageSnapshot = {
  cookies: { total: 0, inspected: 0, recognized: [] },
  web: {
    local: { total: 0, inspected: 0, categories: [] },
    session: { total: 0, inspected: 0, categories: [] },
  },
};
const cookie: BrowserStorageSnapshot["cookies"]["recognized"][number] = {
  name: "_ga",
  scope: "same_site",
  persistent: true,
  secure: true,
  httpOnly: false,
  sameSite: "Lax",
};
const tracking = {
  ...empty,
  cookies: { total: 1, inspected: 1, recognized: [cookie] },
};
function visit(
  scenario: "default" | "accepted",
  end: BrowserStorageSnapshot,
  beforeChoice?: BrowserStorageSnapshot,
): Evidence {
  return {
    scanId: id,
    id: "browser-consent-" + scenario,
    consentScenario: scenario,
    url: "https://example.org/",
    kind: "observed_technical",
    retrievedAt,
    excerpt: "Browser inspection",
    observation: {
      type: "browser_consent_counts",
      finalPageKnown: true,
      requests: 10,
      cookies: end.cookies.total,
      storage: {
        localEntries: end.web?.local.total ?? 0,
        sessionEntries: end.web?.session.total ?? 0,
      },
      externalDomains: [],
      storageSummary: { end, beforeChoice },
      ...(scenario === "accepted" && {
        afterChoice: { acceptedAll: true, requests: 5, externalDomains: [] },
      }),
    },
  };
}
function snapshot(...evidence: Evidence[]): ScanReport {
  return {
    id,
    completedAt: retrievedAt,
    domain: "example.org",
    demo: false,
    partial: false,
    consentCoverage: {
      default: "measured",
      accepted: "measured",
      rejected: "untested",
    },
    evidence,
    findings: [],
  };
}

describe("measured storage and field rules", () => {
  it("applies a prior-consent advertising disclosure only to a confirmed accept-all visit", () => {
    const end = {
      ...empty,
      cookies: { total: 3, inspected: 3, recognized: [] },
    };
    const accepted = visit("accepted", end, empty);
    const policy: Evidence = {
      ...accepted,
      id: "policy",
      kind: "declared_first_party",
      consentScenario: undefined,
      excerpt:
        "If you consent to tracking, we share personal data with advertisers.",
      observation: {
        type: "policy_section",
        topic: "sharing",
        heading: "Your choices",
      },
    };
    const report = snapshot(visit("default", end), accepted, policy);
    report.findings.push({
      rule: "policy_available",
      title: "Privacy policy available",
      explanation: "Retrieved the policy.",
      confidence: "moderate",
      severity: "positive",
      evidenceIds: [policy.id],
    });
    const before = calculateScore(report);
    expect(before.score).toBeNull();
    expect(before.adjustments).toContainEqual(
      expect.objectContaining({
        rule: "declared_advertising_sharing",
        adjustment: 0,
        evidenceIds: [policy.id],
      }),
    );
    expect(calculateAcceptAllScore(report)?.score).toBe(65);
    expect(
      calculateAcceptAllScore({
        ...report,
        consentCoverage: {
          ...report.consentCoverage!,
          accepted: "control_unavailable",
        },
      }),
    ).toBeUndefined();
    const other = {
      ...policy,
      id: "separate-disclosure",
      excerpt: "We share personal information with advertisers.",
    };
    const separate = calculateScore({
      ...report,
      evidence: [...report.evidence, other],
    });
    expect(separate.score).toBe(65);
    expect(separate.adjustments).toContainEqual(
      expect.objectContaining({
        rule: "declared_advertising_sharing",
        adjustment: -15,
        evidenceIds: [other.id],
      }),
    );
    const observed: Evidence = {
      ...accepted,
      id: "ad-before",
      consentScenario: "default",
      observation: {
        type: "browser_request_fields",
        targetDomain: "outside.net",
        scheme: "https",
        relation: "cross_site",
        method: "GET",
        phase: "before_choice",
        attempts: 1,
        responses: 1,
        fieldCategories: ["advertising_id"],
        sources: ["query"],
      },
    };
    const independent = calculateScore({
      ...report,
      evidence: [...report.evidence, observed],
    });
    expect(independent.score).toBe(70);
    expect(independent.adjustments).toContainEqual(
      expect.objectContaining({
        rule: "external_advertising_field",
        adjustment: -10,
        evidenceIds: [observed.id],
      }),
    );
  });
  it("keeps chat continuity neutral and scores a confirmed visitor-ID store and answered event once after acceptance", () => {
    const chat = {
      ...empty,
      cookies: {
        total: 1,
        inspected: 1,
        recognized: [{ ...cookie, name: "Chatwoot conversation" as const }],
      },
    };
    const consented = {
      ...chat,
      web: {
        ...empty.web!,
        local: {
          total: 3,
          inspected: 3,
          categories: ["permutive_visitor_id", "consent", "session"] as const,
        },
      },
    };
    const accepted = visit(
      "accepted",
      {
        ...consented,
        web: {
          ...consented.web,
          local: {
            ...consented.web.local,
            categories: [...consented.web.local.categories],
          },
        },
      },
      chat,
    );
    const report = snapshot(visit("default", chat), accepted);
    report.evidence.push(
      {
        ...accepted,
        id: "event",
        observation: {
          type: "browser_request_fields",
          signature: "permutive_event",
          targetDomain: "permutive.app",
          scheme: "https",
          relation: "cross_site",
          method: "POST",
          phase: "after_choice",
          attempts: 2,
          responses: 1,
          fieldCategories: ["identifier", "event_name"],
          sources: ["json"],
        },
      },
      {
        ...accepted,
        id: "policy",
        consentScenario: undefined,
        kind: "declared_first_party",
        excerpt: "We share personal data with advertisers.",
        observation: {
          type: "policy_section",
          heading: "Sharing",
          topic: "sharing",
        },
      },
    );
    report.findings.push({
      rule: "policy_available",
      title: "Privacy policy available",
      explanation: "Retrieved the policy.",
      confidence: "moderate",
      severity: "positive",
      evidenceIds: ["policy"],
    });
    expect(calculateScore(report).score).toBe(65);
    const rating = calculateAcceptAllScore(report);
    expect(rating?.score).toBe(51);
    expect(rating?.adjustments).toContainEqual(
      expect.objectContaining({
        rule: "recognized_tracking_storage",
        adjustment: -6,
        evidenceIds: [accepted.id],
      }),
    );
    expect(rating?.adjustments).toContainEqual(
      expect.objectContaining({
        rule: "external_identifier_context",
        adjustment: -8,
        evidenceIds: ["event"],
      }),
    );
  });
  it("charges persistent known storage once, with no cost for necessary or unclassified storage", () => {
    const factor = (end: BrowserStorageSnapshot) =>
      calculateScore(snapshot(visit("default", end))).adjustments;
    expect(factor(tracking)).toEqual([
      expect.objectContaining({
        rule: "recognized_tracking_storage",
        adjustment: -6,
      }),
    ]);
    for (const change of [
      { ...cookie, name: "PHPSESSID" as const },
      { ...cookie, name: "OptanonConsent" as const },
      { ...cookie, name: "__cf_bm" as const },
      { ...cookie, name: "Chatwoot conversation" as const },
      {
        ...cookie,
        name: "Permutive visitor ID" as const,
        scope: "outside_site" as const,
      },
      { ...cookie, name: "Permutive visitor ID" as const, persistent: false },
      { ...cookie, persistent: false },
    ])
      expect(
        factor({
          ...empty,
          cookies: { total: 8, inspected: 8, recognized: [change] },
        }),
      ).toEqual([]);
    const local = {
      total: 3,
      inspected: 3,
      categories: ["session", "analytics", "advertising"] as const,
    };
    expect(
      factor({
        ...tracking,
        web: {
          ...empty.web!,
          local: { ...local, categories: [...local.categories] },
        },
      }),
    ).toHaveLength(1);
    expect(
      factor({
        ...empty,
        web: {
          ...empty.web!,
          local: {
            total: 5,
            inspected: 5,
            categories: ["unclassified", "consent", "security", "session"],
          },
        },
      }),
    ).toEqual([]);
  });

  it("attributes accept-all additions only with the store's own complete pre-choice inspection", () => {
    function adjustments(
      end: BrowserStorageSnapshot,
      before?: BrowserStorageSnapshot,
    ) {
      return calculateAcceptAllScore(snapshot(visit("accepted", end, before)))
        ?.adjustments;
    }
    expect(adjustments(tracking, empty)).toEqual([
      expect.objectContaining({
        rule: "recognized_tracking_storage",
        adjustment: -6,
      }),
    ]);
    for (const before of [
      undefined,
      tracking,
      { ...empty, cookies: { ...empty.cookies, total: 90, inspected: 64 } },
    ])
      expect(adjustments(tracking, before)).toEqual([]);
    const web = {
      ...empty,
      web: {
        ...empty.web!,
        local: { total: 1, inspected: 1, categories: ["analytics" as const] },
      },
    };
    expect(adjustments(web, empty)).toEqual([
      expect.objectContaining({ rule: "recognized_tracking_storage" }),
    ]);
    for (const before of [
      { cookies: empty.cookies },
      web,
      {
        ...empty,
        web: {
          ...empty.web!,
          local: { total: 90, inspected: 64, categories: [] },
        },
      },
    ])
      expect(adjustments(web, before)).toEqual([]);
    expect(
      calculateScore(snapshot(visit("accepted", tracking, empty))).adjustments,
    ).toEqual([]);
  });

  it("scores actual answered field combinations in the correct phase and never infers address ownership", () => {
    const shape: BrowserRequestFields = {
      type: "browser_request_fields",
      targetDomain: "external.net",
      scheme: "https",
      relation: "cross_site",
      method: "POST",
      phase: "after_choice",
      attempts: 2,
      responses: 1,
      fieldCategories: ["identifier", "event_name"],
      sources: ["json"],
    };
    const home = visit("accepted", tracking);
    function report(change: Partial<BrowserRequestFields>) {
      return snapshot(home, {
        ...home,
        id: "network",
        observation: { ...shape, ...change },
      });
    }
    expect(calculateAcceptAllScore(report({}))?.adjustments).toEqual([
      expect.objectContaining({
        rule: "external_identifier_context",
        adjustment: -8,
        evidenceIds: ["network"],
      }),
    ]);
    for (const change of [
      { fieldCategories: ["identifier"] },
      { fieldCategories: ["email", "email_value"] },
      { responses: 0 },
      { phase: "before_choice" },
      { relation: "same_site" },
      { scheme: "http" },
      { attempts: 6 },
    ] satisfies Partial<BrowserRequestFields>[])
      expect(calculateAcceptAllScore(report(change))?.adjustments).toEqual([]);
    expect(
      calculateAcceptAllScore(
        report({
          fieldCategories: [
            "email_address_value",
            "advertising_id",
            "identifier",
            "page_url",
          ],
        }),
      )?.adjustments,
    ).toEqual([
      expect.objectContaining({
        rule: "external_email_field",
        adjustment: -12,
        explanation: expect.stringContaining("owner"),
      }),
    ]);
    expect(calculateScore(report({})).adjustments).toEqual([]);
  });
});

describe("published headline selection", () => {
  const base = calculateScore(snapshot());
  const numeric = { ...base, score: 65, grade: "Mixed" as const };
  it("requires two independently verified accept-all ratings with the same identified rules and baseline", () => {
    const first = {
      ...snapshot(visit("accepted", tracking, empty)),
      acceptAllScoring: {
        ...numeric,
        rulesRevision: "historical-rules",
        baseScore: 75,
      },
    };
    const nextId = "3f633d93-24e2-42bc-95d5-79a9ae58a596";
    const next = {
      ...first,
      id: nextId,
      evidence: first.evidence.map((row) => ({ ...row, scanId: nextId })),
      acceptAllScoring: { ...first.acceptAllScoring, score: 70 },
    };
    expect(acceptAllScoreChange(first, next)).toEqual({
      before: 65,
      after: 70,
    });
    expect(
      acceptAllScoreChange(first, { ...next, evidence: [] }),
    ).toBeUndefined();
    expect(
      acceptAllScoreChange(
        { ...first, acceptAllScoring: undefined, scoring: numeric },
        next,
      ),
    ).toBeUndefined();
    for (const change of [
      { baseScore: 50 },
      { methodologyVersion: "different" },
      { rulesRevision: "different" },
      { score: null },
    ]) {
      expect(
        acceptAllScoreChange(first, {
          ...next,
          acceptAllScoring: { ...next.acceptAllScoring, ...change },
        }),
      ).toBeUndefined();
    }
    expect(
      acceptAllScoreChange(
        {
          ...first,
          acceptAllScoring: {
            ...first.acceptAllScoring,
            rulesRevision: undefined,
          },
        },
        {
          ...next,
          acceptAllScoring: {
            ...next.acceptAllScoring,
            rulesRevision: undefined,
          },
        },
      ),
    ).toBeUndefined();
  });
  it("uses the confirmed accept-all score even when another scenario has a lower score", () => {
    const report = {
      ...snapshot(visit("accepted", tracking, empty)),
      scoring: { ...numeric, score: 0 },
      rejectedScoring: { ...numeric, score: 5 },
      acceptAllScoring: { ...numeric, score: 70 },
    };
    expect(evaluateHeadline(report)).toEqual({
      scenario: "accepted",
      rating: report.acceptAllScoring,
    });
    expect(
      evaluateHeadline({ ...report, acceptAllScoring: undefined }).rating.score,
    ).toBeNull();
  });
  it("requires a confirmed same-site accept-all homepage visit for the stored rating and preserves history", () => {
    const source = visit("accepted", tracking, empty);
    const archived = {
      ...snapshot(source),
      scoring: { ...numeric, methodologyVersion: "0.9.0" },
      acceptAllScoring: {
        ...numeric,
        score: 48,
        grade: "Concerning" as const,
        rulesRevision: undefined,
      },
    };
    expect(evaluateHeadline(archived)).toEqual({
      scenario: "accepted",
      rating: archived.acceptAllScoring,
    });
    const observation = source.observation!;
    if (observation.type !== "browser_consent_counts")
      throw new Error("Expected homepage");
    for (const invalid of [
      { ...source, scanId: "different" },
      { ...source, url: "https://another.org/" },
      { ...source, url: undefined },
      { ...source, kind: "declared_first_party" as const },
      { ...source, consentScenario: "rejected" as const },
      { ...source, observation: { ...observation, finalPageKnown: false } },
      {
        ...source,
        observation: {
          ...observation,
          afterChoice: { ...observation.afterChoice!, acceptedAll: false },
        },
      },
    ]) {
      const report = { ...archived, evidence: [invalid] };
      expect(verifiedAcceptAllRating(report)).toBeUndefined();
      expect(evaluateHeadline(report)).toMatchObject({
        scenario: "accepted",
        rating: { score: null, grade: "Unrated", adjustments: [] },
      });
    }
    expect(
      verifiedAcceptAllRating({ ...archived, partial: true }),
    ).toBeUndefined();
    expect(
      verifiedAcceptAllRating({
        ...archived,
        evidence: [source, { ...source, id: "second-accepted-homepage" }],
      }),
    ).toBeUndefined();
    expect(
      verifiedAcceptAllRating({
        ...archived,
        consentCoverage: {
          ...archived.consentCoverage!,
          accepted: "inconclusive",
        },
      }),
    ).toBeUndefined();
    expect(
      evaluateHeadline({ ...archived, acceptAllScoring: undefined }).rating,
    ).toMatchObject({ score: null, grade: "Unrated" });
  });
});
