import { describe, expect, it } from "vitest";
import type {
  BrowserRequestFields,
  Evidence,
  ScanReport,
} from "@datadeal/contracts";
import { calculateAcceptAllScore, calculateScore } from "./index";

const id = "45321bd1-b894-46cf-bfeb-2fecc556f740";
const date = "2026-11-25T11:00:00.000Z";
const coverage = {
  default: "measured",
  accepted: "measured",
  rejected: "measured",
} as const;
const field: BrowserRequestFields = {
  type: "browser_request_fields",
  targetDomain: "outside.org",
  scheme: "https",
  relation: "cross_site",
  method: "POST",
  phase: "before_choice",
  attempts: 2,
  responses: 1,
  sources: ["json"],
  fieldCategories: ["advertising_id"],
};
const sampled = {
  id: "browser-page-1-default",
  scanId: id,
  kind: "observed_technical",
  consentScenario: "default",
  url: "https://www.example.com/news/story",
  retrievedAt: date,
  excerpt: "Measured article visit",
  observation: {
    type: "browser_content_page",
    finalPageKnown: true,
    requests: 10,
    cookies: 2,
    externalDomains: ["outside.org"],
    responseDomains: ["outside.org"],
    network: [field],
  },
} satisfies Evidence;
const report: ScanReport = {
  id,
  domain: "example.com",
  completedAt: date,
  demo: false,
  partial: false,
  evidence: [sampled],
  findings: [],
  consentCoverage: coverage,
  pageSample: {
    discovered: 1,
    discoveryLimited: false,
    limit: 1,
    pages: [
      { url: "https://www.example.com/story", source: "sitemap", coverage },
    ],
  },
};
const adRule = "external_advertising_field";

describe("sampled-page advertising evidence", () => {
  it("counts an answered outside field on a measured article once, even with matching homepage and repeated groups", () => {
    const result = calculateScore(report);
    expect(result.adjustments).toEqual([
      expect.objectContaining({
        rule: adRule,
        adjustment: -10,
        evidenceIds: [sampled.id],
        explanation: expect.stringMatching(
          /sampled page.*before any consent choice/,
        ),
      }),
    ]);
    const homepage = { ...sampled, id: "homepage-request", observation: field };
    const duplicateFields = {
      ...sampled,
      observation: { ...sampled.observation, network: [field, field] },
    };
    const combined = calculateScore({
      ...report,
      evidence: [homepage, duplicateFields],
    });
    expect(combined.adjustments).toHaveLength(1);
    expect(combined.adjustments[0]).toMatchObject({
      adjustment: -10,
      evidenceIds: [homepage.id, sampled.id],
    });
  });

  it("keeps the homepage storage bonus scoped when a sampled page stored cookies", () => {
    const homepage: Evidence = {
      ...sampled,
      id: "browser-consent-default",
      url: "https://www.example.com/",
      observation: {
        type: "browser_consent_counts",
        requests: 4,
        cookies: 0,
        storage: { localEntries: 0, sessionEntries: 0 },
        externalDomains: [],
      },
    };
    const result = calculateScore({ ...report, evidence: [homepage, sampled] });
    expect(
      result.adjustments.find(
        (row) => row.rule === "no_default_browser_storage",
      ),
    ).toMatchObject({
      adjustment: 5,
      title: expect.stringContaining("homepage visit"),
      evidenceIds: [homepage.id],
    });
  });

  it("ignores counts alone, unrelated visits, unmeasured scenarios and unsupported request groups", () => {
    const pages = report.pageSample!;
    const page = pages.pages[0];
    const unsupported: Evidence[] = [
      { ...sampled, id: "browser-page-2-default" },
      { ...sampled, scanId: "different-scan" },
      { ...sampled, url: "https://foreign.org/story" },
      { ...sampled, kind: "declared_first_party" },
      { ...sampled, consentScenario: "rejected" },
      {
        ...sampled,
        observation: { ...sampled.observation, finalPageKnown: false },
      },
      { ...sampled, observation: { ...sampled.observation, network: [] } },
      ...(
        [
          { phase: "after_choice" },
          { relation: "same_site" },
          { relation: "same_origin" },
          { targetDomain: "example.com" },
          { fieldCategories: ["identifier"] },
          { scheme: "http" },
          { sources: [] },
          { responses: 0 },
          { responses: 3 },
          { attempts: 15 },
        ] satisfies Partial<BrowserRequestFields>[]
      ).map((change) => ({
        ...sampled,
        observation: {
          ...sampled.observation,
          network: [{ ...field, ...change }],
        },
      })),
    ];
    for (const source of unsupported)
      expect(
        calculateScore({ ...report, evidence: [source] }).adjustments,
      ).toEqual([]);
    for (const selected of [
      { ...page, coverage: { ...coverage, default: "inconclusive" as const } },
      { ...page, url: "https://foreign.org/story" },
    ])
      expect(
        calculateScore({
          ...report,
          pageSample: { ...pages, pages: [selected] },
        }).adjustments,
      ).toEqual([]);
  });

  it("requires the article's own accept-all choice and an answered field after that choice", () => {
    const afterChoice = {
      requests: 2,
      externalDomains: ["outside.org"],
      acceptedAll: true,
    };
    const homepage: Evidence = {
      ...sampled,
      id: "browser-consent-accepted",
      consentScenario: "accepted",
      url: "https://www.example.com/",
      observation: {
        type: "browser_consent_counts",
        finalPageKnown: true,
        requests: 5,
        cookies: 2,
        externalDomains: [],
        afterChoice: { ...afterChoice, externalDomains: [] },
      },
    };
    const article = {
      ...sampled,
      id: "browser-page-1-accepted",
      consentScenario: "accepted",
      observation: {
        ...sampled.observation,
        afterChoice,
        network: [{ ...field, phase: "after_choice" }],
      },
    } satisfies Evidence;
    const snapshot = (source: Evidence) => ({
      ...report,
      evidence: [homepage, source],
    });
    expect(calculateScore(snapshot(article)).adjustments).toEqual([]);
    expect(calculateAcceptAllScore(snapshot(article))?.adjustments).toEqual([
      expect.objectContaining({
        adjustment: -10,
        evidenceIds: [article.id],
        explanation: expect.stringContaining("after accepting all"),
      }),
    ]);
    for (const changed of [
      { afterChoice: { ...afterChoice, acceptedAll: false } },
      { afterChoice: undefined },
      { afterChoice: { ...afterChoice, requests: 0 } },
      { network: [field] },
    ])
      expect(
        calculateAcceptAllScore(
          snapshot({
            ...article,
            observation: { ...article.observation, ...changed },
          }),
        )?.adjustments,
      ).toEqual([]);
  });
});
