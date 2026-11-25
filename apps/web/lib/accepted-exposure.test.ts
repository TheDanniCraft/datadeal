import { expect, it } from "vitest";
import type { Evidence, PublishedScoring } from "@datadeal/contracts";
import { acceptedExposureSummary } from "./accepted-exposure";

const source: Evidence = {
  id: "field",
  scanId: "994c7476-d470-4d13-8281-d5c698c6b0b1",
  kind: "observed_technical",
  consentScenario: "accepted",
  retrievedAt: "2026-11-25T12:00:00.000Z",
  excerpt: "A matched outgoing request.",
  observation: {
    type: "browser_request_fields",
    targetDomain: "outside.org",
    relation: "cross_site",
    scheme: "https",
    phase: "after_choice",
    method: "POST",
    fieldCategories: ["advertising_id"],
    sources: ["form"],
    attempts: 1,
    responses: 1,
  },
};
const baseline: PublishedScoring = {
  score: 85,
  grade: "Good",
  methodologyVersion: "1.0.0",
  baseScore: 75,
  adjustments: [],
  confidence: "Moderate",
  verdict: "Review",
};
const accepted: PublishedScoring = {
  ...baseline,
  score: 65,
  grade: "Mixed",
  adjustments: [
    {
      rule: "external_advertising_field",
      title: "Field",
      explanation: "Matched",
      adjustment: -10,
      evidenceIds: ["field"],
      confidence: "moderate",
      severity: "caution",
    },
  ],
};
const rows = new Map([[source.id, source]]);
it("pairs a materially different accept-all exposure with its exact source without score arithmetic", () => {
  expect(
    acceptedExposureSummary(baseline, accepted, rows, source.scanId),
  ).toEqual({
    text: "After accepting all, the browser sent an advertising identifier field to outside.org.",
    evidenceId: source.id,
  });
});
it("preserves the existing visitor summary for ties, equal exposures and uncited or different-scenario facts", () => {
  expect(
    acceptedExposureSummary(
      baseline,
      { ...accepted, score: 85 },
      rows,
      source.scanId,
    ),
  ).toBeUndefined();
  expect(
    acceptedExposureSummary(
      { ...baseline, adjustments: accepted.adjustments },
      accepted,
      rows,
      source.scanId,
    ),
  ).toBeUndefined();
  expect(
    acceptedExposureSummary(baseline, accepted, new Map(), source.scanId),
  ).toBeUndefined();
  for (const row of [
    { ...source, consentScenario: "default" as const },
    { ...source, kind: "declared_first_party" as const },
    { ...source, scanId: "previous" },
  ]) {
    expect(
      acceptedExposureSummary(
        baseline,
        accepted,
        new Map([[source.id, row]]),
        source.scanId,
      ),
    ).toBeUndefined();
  }
});
