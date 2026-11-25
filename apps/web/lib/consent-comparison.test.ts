import { expect, it } from "vitest";
import type { Evidence, ScanReport } from "@datadeal/contracts";
import {
  compareConsentDestinations,
  consentChoiceTakeaway,
} from "./consent-comparison";

const id = "e7cc7be6-0674-48f8-8866-1987a6c53406";
const time = "2026-11-25T10:00:00Z";
function row(choice: "accepted" | "rejected", domains: string[]): Evidence {
  return {
    id: "browser-consent-" + choice,
    scanId: id,
    kind: "observed_technical",
    url: "https://example.com/",
    consentScenario: choice,
    retrievedAt: time,
    excerpt: "Browser evidence",
    observation: {
      type: "browser_consent_counts",
      finalPageKnown: true,
      requests: 70,
      cookies: 1,
      externalDomains: ["prechoice.example"],
      afterChoice: {
        requests: 21,
        externalDomains: domains,
        acceptedAll: choice === "accepted",
      },
    },
  };
}
const report: ScanReport = {
  id,
  domain: "example.com",
  demo: false,
  partial: false,
  completedAt: time,
  findings: [],
  consentCoverage: {
    default: "measured",
    accepted: "measured",
    rejected: "measured",
  },
  evidence: [
    row("accepted", ["one.example", "shared.example"]),
    row("rejected", ["two.example", "shared.example"]),
  ],
};

it("compares only requests after the clicks and keeps the exact visit sources", () => {
  const result = compareConsentDestinations(report)!;
  expect(result.text).toContain("one.example only on the accept visit");
  expect(result.text).toContain("two.example only on the reject visit");
  expect(result.text).not.toMatch(/shared|prechoice|sold|tracking/);
  expect(result.takeaway).toEqual({
    text: "After accepting all, the browser tried to reach one.example.",
    evidenceId: "browser-consent-accepted",
  });
  expect(result.sources.map((s) => s.id)).toEqual([
    "browser-consent-accepted",
    "browser-consent-rejected",
  ]);
  expect(result.sources[0].excerpt).toContain(
    "2 outside domains, including one.example and shared.example",
  );
});

it("explains net storage changes inside an accepted visit without assuming a tracking purpose", () => {
  const observed = row("accepted", ["outside.example"]);
  if (observed.observation?.type !== "browser_consent_counts")
    throw Error("Missing visit");
  const store = (total: number) => ({
    total,
    inspected: total,
    categories: total ? ["unclassified" as const] : [],
  });
  const jar = (total: number) => ({ total, inspected: total, recognized: [] });
  observed.observation.storageSummary = {
    beforeChoice: {
      cookies: jar(0),
      web: { session: store(0), local: store(0) },
    },
    end: { cookies: jar(2), web: { session: store(1), local: store(0) } },
  };
  const partial = {
    ...report,
    consentCoverage: {
      ...report.consentCoverage!,
      rejected: "inconclusive" as const,
    },
    evidence: [observed],
  };
  expect(consentChoiceTakeaway(partial, undefined)).toEqual({
    text: "After accepting all, the browser held 2 more unclassified cookies and 1 more session storage entry than just before the choice.",
    evidenceId: "browser-consent-accepted",
  });
  observed.observation.storageSummary.beforeChoice = undefined;
  expect(consentChoiceTakeaway(partial, undefined)?.text).toBe(
    "After accepting all, the browser tried to reach outside.example.",
  );
  delete observed.observation.afterChoice;
  expect(consentChoiceTakeaway(partial, undefined)).toBeUndefined();
});

it("requires two unambiguous comparable measurements from the same scan and page", () => {
  const [accepted, rejected] = report.evidence;
  for (const bad of [
    { ...rejected, url: "https://example.com/login" },
    { ...rejected, scanId: "previous" },
    { ...rejected, observation: undefined },
    {
      ...rejected,
      observation: { ...rejected.observation!, afterChoice: undefined },
    },
    {
      ...rejected,
      observation: { ...rejected.observation!, finalPageKnown: false },
    },
  ])
    expect(
      compareConsentDestinations({ ...report, evidence: [accepted, bad] }),
    ).toBeUndefined();
  expect(
    compareConsentDestinations({
      ...report,
      evidence: [accepted, rejected, rejected],
    }),
  ).toBeUndefined();
  expect(
    compareConsentDestinations({
      ...report,
      consentCoverage: { ...report.consentCoverage!, rejected: "inconclusive" },
    }),
  ).toBeUndefined();
});

it("distinguishes zero outside requests from an incomplete list", () => {
  const empty = compareConsentDestinations({
    ...report,
    evidence: [row("accepted", []), row("rejected", [])],
  });
  expect(empty?.text).toContain(
    "no requests to outside domains after either choice",
  );
  expect(empty?.takeaway).toBeUndefined();
  const capped = compareConsentDestinations({
    ...report,
    evidence: [
      row(
        "accepted",
        Array.from({ length: 20 }, (_, n) => "host" + n + ".example"),
      ),
      row("rejected", ["unlisted.example"]),
    ],
  })!;
  expect(capped.text).toContain("at least 20");
  expect(capped.text).not.toMatch(/only on|same outside/);
  expect(capped.takeaway?.text).toBe(
    "After accepting all, the browser tried to reach host0.example.",
  );
});

it("cites both independent runs when comparing their end-of-visit cookie counts", () => {
  const accepted = row("accepted", ["outside.example"]);
  const baseline: Evidence = {
    ...row("accepted", []),
    id: "baseline",
    consentScenario: "default",
  };
  if (baseline.observation?.type !== "browser_consent_counts")
    throw Error("Missing visit");
  baseline.observation.cookies = 0;
  delete baseline.observation.afterChoice;
  const reportPair = { ...report, evidence: [baseline, accepted] };
  expect(consentChoiceTakeaway(reportPair, undefined)).toEqual({
    text: "After accepting all, the browser tried to reach outside.example and ended the visit with 1 cookie, compared with 0 on the visit without a choice.",
    evidenceId: accepted.id,
    beforeChoiceEvidenceId: baseline.id,
  });
  for (const unmatched of [
    { ...baseline, url: "https://example.com/elsewhere" },
    { ...baseline, scanId: "another" },
    { ...baseline, kind: "declared_first_party" as const },
  ]) {
    expect(
      consentChoiceTakeaway(
        { ...reportPair, evidence: [unmatched, accepted] },
        undefined,
      )?.beforeChoiceEvidenceId,
    ).toBeUndefined();
  }
});
