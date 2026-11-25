import { expect, it, vi } from "vitest";
import {
  domainLookup,
  type Evidence,
  type ScanReport,
} from "@datadeal/contracts";
import { evaluate } from "@datadeal/scoring";
import { publishedReportPayload } from "./published-report";
import { lookup } from "./reports";

vi.mock("./reports", () => ({ lookup: vi.fn() }));

const id = "e7cc7be6-0674-48f8-8866-1987a6c53406";
const date = "2026-11-25T11:00:00.000Z";
const root: Evidence = {
  id: "browser-consent-default",
  scanId: id,
  kind: "observed_technical",
  consentScenario: "default",
  url: "https://example.org/",
  retrievedAt: date,
  excerpt: "Homepage measurement",
  observation: {
    type: "browser_consent_counts",
    requests: 4,
    cookies: 0,
    externalDomains: [],
  },
};
const page: Evidence = {
  ...root,
  id: "browser-page-1-default",
  url: "https://example.org/news/story",
  observation: {
    type: "browser_content_page",
    requests: 30,
    cookies: 1,
    externalDomains: Array.from({ length: 20 }, (_, i) => `provider${i}.org`),
    network: [],
  },
};
const sample: ScanReport = {
  id,
  domain: "example.org",
  completedAt: date,
  partial: false,
  demo: false,
  findings: [],
  evidence: [root, page],
  pageSample: {
    discovered: 12,
    discoveryLimited: false,
    limit: 3,
    pages: [
      {
        url: page.url!,
        source: "sitemap",
        coverage: {
          default: "measured",
          rejected: "untested",
          accepted: "untested",
        },
      },
    ],
  },
};

async function payload(report: ScanReport) {
  vi.mocked(lookup).mockResolvedValueOnce({
    host: report.domain,
    score: evaluate(report),
    report,
    history: [],
  });
  return domainLookup.parse(await publishedReportPayload(report.domain)).report;
}

it("publishes a bounded, source-linked default page comparison without exposing the network in the extension API", async () => {
  const report = await payload(sample);
  expect(report?.contentPageDifference).toEqual({
    text: "Before a consent choice, the browser tried to reach at least 20 outside domains on /news/story, compared with 0 on the homepage.",
    evidenceId: "browser-page-1-default",
  });
  expect(report?.browserEvidenceId).toBe("browser-consent-default");
  expect(JSON.stringify(report)).not.toMatch(
    /provider0\.org|browser_content_page/,
  );
});

it("omits the comparison for historical, unmeasured or different-scenario observations", async () => {
  for (const report of [
    { ...sample, pageSample: undefined },
    { ...sample, evidence: [page] },
    {
      ...sample,
      evidence: [root, { ...page, consentScenario: "accepted" as const }],
    },
    { ...sample, evidence: [root, { ...page, scanId: "different-scan" }] },
  ])
    expect((await payload(report))?.contentPageDifference).toBeUndefined();
});
