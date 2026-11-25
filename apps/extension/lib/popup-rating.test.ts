import { describe, expect, it, vi } from "vitest";
import type { DomainLookup } from "@datadeal/contracts";
import { comparableReport, publishedRating } from "./popup-rating";

vi.mock("wxt/browser", () => ({ browser: {} }));

const base: NonNullable<DomainLookup["report"]> = {
  demo: false,
  partial: false,
  completedAt: "2026-11-25T12:00:00.000Z",
  score: 65,
  grade: "Mixed",
  verdict: "Use with caution.",
  confidence: "Moderate",
  warnings: [],
};
describe("extension comparison scores", () => {
  it.each([undefined, "default", "rejected"] as const)(
    "keeps a %s legacy number off both the popup and badge",
    (headlineScenario) => {
      const report = { ...base, headlineScenario };
      expect(comparableReport(report)).toMatchObject({
        score: null,
        grade: "Unrated",
        confidence: "Low",
      });
      expect(publishedRating(report)).toBeNull();
    },
  );
  it("shows an explicit accepted score and keeps the server's coverage explanation for unrated sites", () => {
    const scoped = {
      ...base,
      headlineScenario: "default" as const,
      noChoiceVisit: true as const,
    };
    expect(comparableReport(scoped)).toBe(scoped);
    expect(publishedRating(scoped)).toEqual({ score: 65, grade: "Mixed" });
    const accepted = { ...base, headlineScenario: "accepted" as const };
    expect(comparableReport(accepted)).toBe(accepted);
    expect(publishedRating(accepted)).toEqual({ score: 65, grade: "Mixed" });
    const missing = {
      ...base,
      score: null,
      grade: "Unrated",
      verdict: "No confirmed choice.",
    };
    expect(comparableReport(missing)).toBe(missing);
    expect(publishedRating(missing)).toBeNull();
  });
});
