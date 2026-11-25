import { expect, it } from "vitest";
import type { ScanReport } from "@datadeal/contracts";
import { changedScoreDrivers, documentChanges } from "./history";

it("reports changed and newly retrieved documents without treating retrieval gaps as removal", () => {
  const id = "00100000-0000-4000-8000-000000000005";
  const completedAt = "2026-01-01T12:00:00.000Z";
  const snapshot = (documents: Record<string, string>): ScanReport => ({
    id,
    completedAt,
    domain: "example.com",
    demo: false,
    partial: true,
    findings: [],
    evidence: Object.entries(documents).map(([path, hash]) => ({
      id: path,
      url: "https://example.com/" + path,
      hash,
      excerpt: "Policy text",
      scanId: id,
      retrievedAt: completedAt,
      kind: "declared_first_party",
    })),
  });
  const previous = snapshot({
    privacy: "first",
    terms: "same",
    cookies: "old",
  });
  const current = snapshot({
    privacy: "revised",
    terms: "same",
    disclosure: "new",
  });
  const carriedFromOlderScan = {
    ...previous.evidence[0],
    id: "carried",
    scanId: "00100000-0000-4000-8000-000000000004",
    hash: "unrelated",
  };
  previous.evidence.push(carriedFromOlderScan);
  current.evidence.push(carriedFromOlderScan);

  expect(documentChanges(previous, current)).toEqual([
    {
      evidenceId: "privacy",
      url: "https://example.com/privacy",
      kind: "Text changed",
    },
    {
      evidenceId: "disclosure",
      url: "https://example.com/disclosure",
      kind: "Newly retrieved",
    },
  ]);

  current.evidence[0].excerpt =
    "Policy text now describes sharing with a vendor.";
  expect(documentChanges(previous, current)?.[0].passage).toEqual({
    before: "Policy text",
    after: "Policy text now describes sharing with a vendor.",
  });
  expect(documentChanges(previous, snapshot({}))).toBeNull();
  expect(documentChanges(previous, snapshot({ privacy: "first" }))).toEqual([]);
});

it("explains changes from each scan’s cited, score-setting accept-all practices", () => {
  function rated(day: number, value: number): ScanReport {
    const id = "00100000-0000-4000-8000-00000000000" + day;
    const date = "2026-01-0" + day + "T12:00:00Z";
    return {
      id,
      completedAt: date,
      domain: "example.org",
      partial: false,
      demo: false,
      findings: [],
      consentCoverage: {
        accepted: "measured",
        rejected: "untested",
        default: "measured",
      },
      evidence: [
        {
          id: "visit",
          scanId: id,
          kind: "observed_technical",
          retrievedAt: date,
          excerpt: "Visit",
          url: "https://example.org/",
          consentScenario: "accepted",
          observation: {
            type: "browser_consent_counts",
            requests: 3,
            cookies: 0,
            externalDomains: [],
            finalPageKnown: true,
            freshContext: true,
            afterChoice: {
              acceptedAll: true,
              requests: 1,
              externalDomains: [],
            },
          },
        },
      ],
      acceptAllScoring: {
        score: value,
        methodologyVersion: "1.0.0",
        rulesRevision: "revision-a",
        grade: "Mixed",
        verdict: "Use with caution.",
        confidence: "Low",
        adjustments: [],
        practiceAssessment: {
          coverage: "Homepage",
          ratings: [
            {
              factId: "one",
              score: value,
              reason: "The determining practice",
              evidenceIds: ["visit"],
            },
            {
              factId: "two",
              score: 90,
              reason: "Another practice",
              evidenceIds: ["visit"],
            },
          ],
        },
      },
    };
  }
  const before = rated(1, 68),
    after = rated(2, 62);
  const change = changedScoreDrivers(before, after);
  expect(change?.earlier.score).toBe(68);
  expect(change?.later.reasons).toEqual([
    {
      text: "The determining practice",
      sources: [{ id: "visit", label: "Browser observation" }],
    },
  ]);
  expect(changedScoreDrivers(after, before)).toBeUndefined();
  expect(changedScoreDrivers(before, rated(2, 68))).toBeUndefined();
  const changedRules = rated(2, 62);
  changedRules.acceptAllScoring!.rulesRevision = "revision-b";
  expect(changedScoreDrivers(before, changedRules)).toBeUndefined();
  after.evidence[0]!.scanId = before.id;
  expect(changedScoreDrivers(before, after)).toBeUndefined();
  const missingSource = rated(2, 62);
  missingSource.acceptAllScoring!.practiceAssessment!.ratings[0]!.evidenceIds =
    ["missing"];
  expect(changedScoreDrivers(before, missingSource)).toBeUndefined();
});
