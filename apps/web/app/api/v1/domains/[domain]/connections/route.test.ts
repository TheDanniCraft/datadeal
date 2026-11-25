import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const { getSession, hasPro, lookup, observedProviderReferences } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    hasPro: vi.fn(),
    lookup: vi.fn(),
    observedProviderReferences: vi.fn(),
  }),
);
vi.mock("../../../../../../lib/auth", () => ({
  auth: { api: { getSession } },
}));
vi.mock("../../../../../../lib/reports", () => ({
  database: { hasPro, observedProviderReferences },
  lookup,
}));

const domain = "example.com";
const connections = () =>
  GET(
    new Request(
      `https://datadeal.example/api/v1/domains/${domain}/connections`,
    ),
    {
      params: Promise.resolve({ domain }),
    },
  );

beforeEach(() => vi.resetAllMocks());

it("denies graph expansion before loading report evidence", async () => {
  getSession
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ user: { id: "free" } });
  hasPro.mockResolvedValue(false);
  expect((await connections()).status).toBe(401);
  expect((await connections()).status).toBe(403);
  expect(lookup).not.toHaveBeenCalled();
  expect(observedProviderReferences).not.toHaveBeenCalled();
});

it("returns merged citations from the current scan to a Pro account", async () => {
  getSession.mockResolvedValue({ user: { id: "pro" } });
  hasPro.mockResolvedValue(true);
  const references = [
    { domain: "another.example", scanId: "another-scan", evidenceId: "visit" },
  ];
  observedProviderReferences.mockResolvedValue(references);
  lookup.mockResolvedValue({
    report: {
      id: "current-scan",
      domain,
      demo: false,
      evidence: [
        {
          scanId: "previous-scan",
          id: "old",
          kind: "declared_first_party",
          observation: {
            type: "policy_section",
            providerHosts: ["old.example"],
          },
        },
        {
          scanId: "current-scan",
          id: "policy",
          kind: "declared_first_party",
          observation: {
            type: "policy_section",
            providerHosts: ["provider.example"],
          },
        },
        {
          scanId: "current-scan",
          id: "visit",
          kind: "observed_technical",
          observation: {
            type: "browser_consent_counts",
            externalDomains: [domain, "provider.example"],
          },
        },
      ],
    },
  });
  const response = await connections();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({
    domain,
    scanId: "current-scan",
    references,
    destinations: [
      {
        label: "provider.example",
        declaredEvidenceId: "policy",
        observedEvidenceId: "visit",
      },
    ],
  });
});

it("links a provider seen only on an accepted article visit to that measurement", async () => {
  getSession.mockResolvedValue({ user: { id: "pro" } });
  hasPro.mockResolvedValue(true);
  observedProviderReferences.mockResolvedValue([]);
  const url = "https://example.com/news";
  const evidence = ["default", "accepted"].map((scenario) => ({
    scanId: "scan",
    id: "browser-page-1-" + scenario,
    kind: "observed_technical",
    url,
    consentScenario: scenario,
    observation: {
      type: "browser_content_page",
      requests: 5,
      externalDomains: [scenario + ".example"],
    },
  }));
  lookup.mockResolvedValue({
    report: {
      id: "scan",
      domain,
      evidence,
      pageSample: {
        pages: [
          {
            url,
            coverage: {
              default: "inconclusive",
              accepted: "measured",
              rejected: "untested",
            },
          },
        ],
      },
    },
  });
  expect((await (await connections()).json()).destinations).toEqual([
    {
      label: "accepted.example",
      observedEvidenceId: "browser-page-1-accepted",
    },
  ]);
});
