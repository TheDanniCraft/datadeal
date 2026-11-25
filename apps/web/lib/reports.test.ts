import { describe, expect, it, vi } from "vitest";
import { demos } from "./fixtures";
import {
  selfHostedAnalyticsDisclosure,
  publicProviderDisclosures,
  publicRequestFindings,
} from "./request-findings";
import type { Evidence, ScanReport } from "@datadeal/contracts";
import { evaluate } from "@datadeal/scoring";
import { publishedReportPayload } from "./published-report";
import { lookup, selectPublishedReport } from "./reports";

const storage = vi.hoisted(() => ({
  list: vi.fn(),
  olderPublishedReports: vi.fn(),
}));
vi.hoisted(() => vi.stubEnv("DATABASE_URL", "postgres://test"));
vi.mock("@datadeal/database", () => ({ connect: () => storage }));

const fixture = demos[1];
const rated: ScanReport = {
  ...fixture,
  demo: false,
  consentCoverage: {
    default: "measured",
    accepted: "measured",
    rejected: "untested",
  },
  acceptAllScoring: { ...evaluate(fixture), score: 65, grade: "Mixed" },
  evidence: [
    ...fixture.evidence,
    {
      id: "confirmed-accept",
      scanId: fixture.id,
      retrievedAt: fixture.completedAt,
      url: "https://" + fixture.domain + "/",
      kind: "observed_technical",
      consentScenario: "accepted",
      excerpt: "Confirmed accept-all visit.",
      observation: {
        type: "browser_consent_counts",
        requests: 4,
        cookies: 0,
        externalDomains: [],
        finalPageKnown: true,
        afterChoice: { acceptedAll: true, requests: 1, externalDomains: [] },
      },
    },
  ],
};
const unrated = {
  ...rated,
  id: "ed75b18b-66ca-4eb4-bf02-7427e8b3b778",
  evidence: [],
  findings: [],
  partial: true,
};
const previous = { report: rated, state: "completed" };
const partial = { report: unrated, state: "partially_completed" };

describe("published report selection", () => {
  it("normalizes legacy software-link edges before a graph, summary or AI result can attribute Cloud processing", () => {
    const common = { scanId: rated.id, retrievedAt: rated.completedAt };
    const quote = "Wir betreiben Plausible auf eigenen Servern.";
    const referral = {
      url: "https://thedannicraft.de/privacy",
      excerpt: quote,
    };
    const rows: Evidence[] = [
      {
        ...common,
        id: "local",
        kind: "declared_first_party",
        url: referral.url,
        excerpt: quote,
        observation: {
          type: "policy_section",
          topic: "sharing",
          heading: "Analytics",
          providerHosts: ["plausible.io"],
        },
      },
      {
        ...common,
        id: "cloud",
        kind: "third_party_reference",
        url: "https://plausible.io/privacy",
        excerpt: "Cloud policy",
        observation: {
          type: "provider_policy",
          heading: "Cloud",
          providerHost: "plausible.io",
          referringEvidenceId: "local",
        },
      },
      {
        ...common,
        id: "dpa",
        kind: "third_party_reference",
        url: "https://plausible.io/dpa",
        excerpt: "Cloud hosting",
        observation: {
          type: "processing_document",
          document: "dpa",
          heading: "Cloud",
          referral,
        },
      },
      {
        ...common,
        id: "browser",
        kind: "observed_technical",
        excerpt: "Analytics protocol",
        consentScenario: "default",
        observation: {
          type: "browser_request_fields",
          targetDomain: "thedannicraft.de",
          relation: "same_site",
          method: "POST",
          scheme: "https",
          phase: "before_choice",
          attempts: 1,
          responses: 1,
          sources: ["json"],
          signature: "plausible_event",
          fieldCategories: ["page_url"],
        },
      },
    ];
    const snapshot = {
      ...rated,
      domain: "thedannicraft.de",
      evidence: rows,
      policyBrief: [
        {
          topic: "sharing",
          source: "local",
          quote,
          text: "The hosted Plausible service receives the data.",
        },
      ],
    };
    const { report, score } = selectPublishedReport(
      [{ report: snapshot, state: "completed" }],
      false,
    );
    const comparable = selectPublishedReport(
      [
        {
          report: {
            ...snapshot,
            evidence: [rows[0], rows[3]],
            policyBrief: undefined,
          },
          state: "completed",
        },
      ],
      false,
    );
    expect(score).toEqual(comparable.score);
    expect(report?.evidence.map((row) => row.id)).toEqual(["local", "browser"]);
    expect(report?.evidence[0].observation).toMatchObject({
      providerHosts: [],
    });
    expect(report?.policyBrief).toBeUndefined();
    expect(publicProviderDisclosures(report)).toEqual([]);
    expect(selfHostedAnalyticsDisclosure(report)).toMatchObject({ quote });
    expect(publicRequestFindings(report)[0].text).toContain("same site");
    expect(publicRequestFindings(report)[0].text).not.toContain("Cloud");
  });
  it("keeps the same rated snapshot and reward identity when a rescan pushes it past the history limit", async () => {
    const recent = Array.from({ length: 19 }, (_, index) => ({
      id: `failed-${index}`,
      state: "failed",
      report: null,
    }));
    const published = { ...previous, id: rated.id };
    storage.list
      .mockResolvedValueOnce([...recent, published])
      .mockResolvedValueOnce([
        { id: "rescan", state: "queued", report: null },
        ...recent,
      ]);
    storage.olderPublishedReports.mockResolvedValueOnce([published]);

    const before = await lookup(rated.domain);
    const during = await lookup(rated.domain);
    expect(during.history[0]?.state).toBe("queued");
    expect(during.report?.id).toBe(before.report?.id);
    expect(during.report?.id).toBe(rated.id);
    expect(during.score?.score).toBe(before.score?.score);
    expect(storage.olderPublishedReports).toHaveBeenCalledWith(
      rated.domain,
      "failed-18",
    );
  });

  it.each(["queued", "fetching", "failed"])(
    "keeps the published rating when the new scan is %s",
    (state) => {
      const selection = selectPublishedReport(
        [{ state, report: unrated }, previous],
        false,
      );
      expect(selection.report?.id).toBe(rated.id);
      expect(selection.score?.score).toEqual(expect.any(Number));
    },
  );

  it("shows the new published coverage when a partial snapshot replaces a previous accept-all rating", () => {
    const selection = selectPublishedReport([partial, previous], false);
    expect(selection.report?.id).toBe(unrated.id);
    expect(selection.score?.score).toBeNull();
  });

  it("publishes a completed contextual assessment even when a legacy scan had a number", async () => {
    const latest = {
      ...unrated,
      partial: false,
      scoring: {
        methodologyVersion: "1.0.0",
        rulesRevision: "contextual-practices-2",
        score: null,
        grade: "Unrated",
        confidence: "Low",
        verdict: "Too little verified coverage.",
        adjustments: [],
        practiceAssessment: {
          coverage: "The request fields could not be classified.",
          ratings: [],
        },
      },
    };
    const history = [{ state: "completed", report: latest }, previous];
    expect(selectPublishedReport(history, false).report?.id).toBe(latest.id);
    storage.list.mockResolvedValueOnce(history);
    const payload = await publishedReportPayload(rated.domain);
    expect(payload.report).toMatchObject({
      scanId: latest.id,
      score: null,
      verdict: expect.stringContaining("Accept all"),
    });
  });

  it("returns the confirmed accept-all score to lookup, extension and API clients while retaining both scenario ratings", async () => {
    const base = evaluate(rated);
    const snapshot = {
      ...rated,
      scoring: { ...base, score: 90, grade: "Excellent" },
      acceptAllScoring: { ...base, score: 10, grade: "Critical" },
      consentCoverage: {
        default: "measured",
        rejected: "untested",
        accepted: "measured",
      },
    };
    storage.list.mockResolvedValueOnce([
      { report: snapshot, state: "completed" },
    ]);
    const { report } = await publishedReportPayload(rated.domain);
    expect(report).toMatchObject({
      score: 10,
      grade: "Critical",
      headlineScenario: "accepted",
    });
    storage.list.mockResolvedValueOnce([
      {
        report: {
          ...snapshot,
          consentCoverage: {
            ...snapshot.consentCoverage,
            accepted: "inconclusive",
          },
        },
        state: "completed",
      },
    ]);
    const unconfirmed = (await publishedReportPayload(rated.domain)).report;
    expect(unconfirmed).toMatchObject({
      score: null,
      grade: "Unrated",
    });
    expect(report).not.toHaveProperty("beforeChoiceRating");
    expect(report).not.toHaveProperty("acceptAllRating");
    expect(report).not.toHaveProperty("consentDifference");
    expect(unconfirmed).not.toHaveProperty("acceptAllRating");
  });

  it("shows an unrated report when a site has never had a rating", () => {
    const selection = selectPublishedReport([partial], false);
    expect(selection.report?.id).toBe(unrated.id);
    expect(selection.score?.score).toBeNull();
  });

  it("replaces the old rating when the new scan has a rating", () => {
    const next = {
      ...rated,
      id: unrated.id,
      evidence: rated.evidence.map((item) => ({ ...item, scanId: unrated.id })),
    };
    const selection = selectPublishedReport(
      [{ report: next, state: "completed" }, previous],
      false,
    );
    expect(selection.report?.id).toBe(next.id);
  });
});
