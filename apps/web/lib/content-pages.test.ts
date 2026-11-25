import { expect, it } from "vitest";
import type { DataPractice, Evidence, ScanReport } from "@datadeal/contracts";
import { scanReport } from "@datadeal/contracts";
import {
  contentPageEvidenceTitle,
  measuredPracticeFacts,
  publicContentPageSample,
} from "./content-pages";
import {
  publicReportEvidence,
  withPracticeEvidenceExcerpts,
} from "./public-report-evidence";
import { practiceTakeaways } from "./practice-takeaways";

const id = "7211ca23-5c3b-424c-9b26-14021ab1b81c";
const measured: Evidence = {
  id: "browser-page-1-default",
  kind: "observed_technical",
  scanId: id,
  retrievedAt: "2026-11-25T11:00:00.000Z",
  consentScenario: "default",
  url: "https://example.org/news/article",
  excerpt: "Full internal detail",
  observation: {
    type: "browser_content_page",
    requests: 10,
    cookies: 2,
    externalDomains: ["a.test", "b.test", "c.test", "d.test"],
    responseDomains: ["a.test", "b.test"],
    network: [
      {
        type: "browser_request_fields",
        targetDomain: "d.test",
        relation: "cross_site",
        method: "POST",
        scheme: "https",
        phase: "before_choice",
        fieldCategories: ["email_value"],
        sources: ["json"],
        attempts: 1,
        responses: 1,
      },
    ],
  },
};
const report: ScanReport = {
  id,
  completedAt: measured.retrievedAt,
  domain: "example.org",
  demo: false,
  partial: false,
  findings: [],
  pageSample: {
    discovered: 12,
    discoveryLimited: true,
    limit: 3,
    pages: [
      {
        url: "https://example.org/article",
        source: "sitemap",
        coverage: {
          default: "measured",
          rejected: "control_unavailable",
          accepted: "untested",
        },
      },
    ],
  },
  evidence: [measured],
};

it("links the selected URL to its actual same-origin visit and publishes only bounded examples", () => {
  expect(
    contentPageEvidenceTitle({
      ...measured,
      observation: undefined,
      id: "browser-page-12-default",
    }),
  ).toBe("Default visit · /news/article");
  expect(
    contentPageEvidenceTitle({
      ...measured,
      observation: undefined,
      id: "browser-page-13-default",
    }),
  ).toBeUndefined();
  const [page] = publicContentPageSample(report)!.pages;
  expect(page).toMatchObject({
    path: "/article",
    visits: [
      {
        scenario: "default",
        measurement: {
          finalPath: "/news/article",
          outside: 4,
          examples: ["a.test", "b.test", "c.test"],
        },
      },
      {
        scenario: "rejected",
        measurement: undefined,
        outcome: "control_unavailable",
      },
      { scenario: "accepted", measurement: undefined, outcome: "untested" },
    ],
  });
  expect(publicReportEvidence(report, [])).toEqual([]);
  const publicRows = publicReportEvidence(report, [measured.id]);
  expect(publicRows).toHaveLength(1);
  expect(contentPageEvidenceTitle(publicRows[0])).toBe(
    "Default visit · /news/article",
  );
  expect(publicRows[0].excerpt).toContain("4 outside domains");
  expect(JSON.stringify([page, publicRows])).not.toMatch(
    /d\.test|email_value|Full internal detail/,
  );
});

it("leaves other scans, mismatched scenarios, coverage and foreign redirects out of the page measurements", () => {
  for (const source of [
    { ...measured, scanId: "different-scan" },
    { ...measured, url: "https://other.test/news" },
    { ...measured, consentScenario: "accepted" as const },
    {
      ...measured,
      consentScenario: "rejected" as const,
      id: "browser-page-1-rejected",
    },
  ]) {
    const snapshot = { ...report, evidence: [source] };
    expect(
      publicContentPageSample(snapshot)?.pages[0].visits.every(
        ({ measurement }) => !measurement,
      ),
    ).toBe(true);
    expect(publicReportEvidence(snapshot, [])).toEqual([]);
  }
  expect(
    publicContentPageSample({ ...report, pageSample: undefined }),
  ).toBeUndefined();
});

it("shows the redacted field, timing, destination and response that support a sampled-page deduction", () => {
  const visit = measured.observation;
  if (visit?.type !== "browser_content_page")
    throw Error("Missing sampled visit");
  const group = {
    ...visit.network[0],
    fieldCategories: ["advertising_id" as const],
  };
  const publish = (responses: number) =>
    publicReportEvidence(
      {
        ...report,
        evidence: [
          {
            ...measured,
            observation: { ...visit, network: [{ ...group, responses }] },
          },
        ],
      },
      [measured.id],
    )[0];
  const source = publish(1);
  expect(source.url).toBe(measured.url);
  expect(source.excerpt).toMatch(
    /Default visit · d\.test.*advertising ID.*JSON body.*HTTP responses observed: 1/,
  );
  expect(source.observation).toBeUndefined();
  expect(publish(0).excerpt).not.toMatch(/advertising ID/);
});

function practiceReport(responses: number, matched: boolean) {
  const cookie = {
    name: "_fbp",
    scope: "same_site",
    site: "example.org",
    persistent: true,
    secure: true,
    httpOnly: false,
    sameSite: "Lax",
  };
  const sample = { cookies: { total: 1, inspected: 1, recognized: [cookie] } };
  return scanReport.parse({
    ...report,
    pageSample: {
      ...report.pageSample,
      pages: [
        {
          url: "https://example.org/contact",
          source: "sitemap",
          coverage: {
            default: "untested",
            accepted: "untested",
            rejected: "measured",
          },
        },
      ],
    },
    evidence: [
      {
        ...measured,
        id: "browser-page-1-rejected",
        consentScenario: "rejected",
        url: "https://example.org/contact",
        observation: {
          type: "browser_content_page",
          freshContext: true,
          finalPageKnown: true,
          requests: 8,
          cookies: 1,
          externalDomains: ["facebook.com", "unrelated.test"],
          responseDomains: responses
            ? ["facebook.com", "unrelated.test"]
            : ["unrelated.test"],
          afterChoice: {
            requests: 5,
            externalDomains: ["facebook.com", "unrelated.test"],
          },
          storageSummary: { beforeChoice: sample, end: sample },
          network: [
            {
              type: "browser_request_fields",
              targetDomain: "facebook.com",
              scheme: "https",
              method: "POST",
              relation: "cross_site",
              phase: "after_choice",
              signature: "meta_pixel_event",
              fieldCategories: ["event_name", "advertising_id"],
              sources: ["query", "json"],
              attempts: 3,
              responses,
              initiator: "tested_top_level",
              ...(matched && { matchedStorage: "fbp_cookie" }),
            },
            {
              type: "browser_request_fields",
              targetDomain: "unrelated.test",
              scheme: "https",
              method: "GET",
              relation: "cross_site",
              phase: "after_choice",
              fieldCategories: ["page_url"],
              sources: ["query"],
              attempts: 1,
              responses: 1,
            },
          ],
        },
      },
    ],
  });
}

it.each([
  [2, true],
  [0, false],
] as const)(
  "shows the exact cited sampled-page request to a guest (%i responses, storage match %s)",
  (responses, matched) => {
    const snapshot = practiceReport(responses, matched);
    const fact = measuredPracticeFacts(snapshot).find(
      (f) => f.request?.targetDomain === "facebook.com",
    )!;
    const [guest] = publicReportEvidence(snapshot, fact.evidenceIds, [
      fact.factId,
    ]);
    const advanced = withPracticeEvidenceExcerpts(snapshot, [fact.factId])
      .evidence[0];
    expect(guest.excerpt).toContain(
      "After rejecting optional consent · facebook.com",
    );
    expect(guest.excerpt).toMatch(
      /Meta Pixel event.*advertising ID.*event name/,
    );
    expect(guest.excerpt).toContain("JSON body");
    expect(guest.excerpt).toContain("URL query");
    expect(guest.excerpt).toContain(
      "Matching requests attempted: 3. HTTP responses observed: " + responses,
    );
    expect(guest.excerpt.includes("matched the value of _fbp")).toBe(matched);
    expect(JSON.stringify(guest)).not.toMatch(
      /unrelated\.test|Full internal detail|"network"|"storageSummary"/,
    );
    expect(advanced.excerpt).toContain(guest.excerpt);
    expect(advanced.observation).toEqual(snapshot.evidence[0].observation);
  },
);

it("targets the selected storage family and snapshot when the visit also contains unrelated network evidence", () => {
  const snapshot = practiceReport(2, true);
  const fact = measuredPracticeFacts(snapshot).find(
    (f) => f.observed === "storage" && f.storage?.snapshot === "before_choice",
  )!;
  const [guest] = publicReportEvidence(snapshot, fact.evidenceIds, [
    fact.factId,
  ]);
  expect(guest.excerpt).toContain(
    "Immediately before the consent choice, the browser contained _fbp in cookies.",
  );
  expect(JSON.stringify(guest)).not.toMatch(
    /facebook\.com|unrelated\.test|advertising ID|Full internal detail/,
  );
});

it("resolves a stored practice to its exact modal text and discards stale claims on the same visit", () => {
  const snapshot = practiceReport(2, false);
  const fact = measuredPracticeFacts(snapshot).find(
    (f) => f.request?.targetDomain === "facebook.com",
  )!;
  const stored: DataPractice = {
    factId: fact.factId,
    scenario: "rejected",
    dataClass: "page_activity",
    operation: "transmitted",
    recipient: "facebook.com",
    role: "unknown",
    purpose: "unknown",
    necessity: "unclear",
    persistence: "unknown",
    scope: "cross_site",
    control: "after_reject",
    trigger: "After rejecting",
    confidence: "low",
    linkedIdentifier: false,
    evidence: { behavior: fact.evidenceIds, context: [], link: [] },
    summary: "The endpoint answered an event request.",
    significance: "The request included an advertising identifier.",
    unknowns: [],
    mismatch: null,
  };
  const saved = {
    ...snapshot,
    dataPractices: [
      { ...stored, factId: "old-practice-id" },
      { ...stored, linkedIdentifier: true },
      { ...stored, recipient: "other.test" },
      { ...stored, operation: "stored" as const },
      stored,
    ],
  };
  const visible = practiceTakeaways(saved, "rejected", {}, false);
  expect(visible).toHaveLength(1);
  expect(practiceTakeaways(saved, "rejected", {}, true)).toEqual(visible);
  const evidence = publicReportEvidence(
    saved,
    fact.evidenceIds,
    visible.map((p) => p.factId),
  );
  expect(visible[0].citations).toEqual([
    {
      id: evidence[0].id,
      label: "Sampled visit · /contact",
      quote: evidence[0].excerpt,
    },
  ]);
});
