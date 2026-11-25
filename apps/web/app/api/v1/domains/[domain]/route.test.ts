import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const { database, lookup } = vi.hoisted(() => ({
  lookup: vi.fn(),
  database: {
    requestScan: vi.fn(),
  },
}));

vi.mock("../../../../../lib/reports", () => ({ database, lookup }));
vi.mock("../../../../../lib/auth", () => ({ auth: null }));

const origin = "https://datadeal.example";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_ORIGIN", origin);
});

afterEach(() => vi.unstubAllEnvs());

const requestScan = (headers: Record<string, string> = {}) =>
  POST(
    new Request(origin + "/api/v1/domains/example.com", {
      method: "POST",
      headers: { Origin: origin, ...headers },
    }),
    { params: Promise.resolve({ domain: "example.com" }) },
  );

it("keeps production guest scans out of the queue without a trusted client IP", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATADEAL_TRUSTED_CLIENT_IP_HEADER", "x-datadeal-client-ip");
  vi.stubEnv("DATADEAL_SCAN_LIMIT_SECRET", "s".repeat(32));
  const response = await requestScan();
  expect(response.status).toBe(503);
  expect(database.requestScan).not.toHaveBeenCalled();
});

it("uses separate hourly and daily limits for a verified production guest", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATADEAL_TRUSTED_CLIENT_IP_HEADER", "x-datadeal-client-ip");
  vi.stubEnv("DATADEAL_SCAN_LIMIT_SECRET", "s".repeat(32));
  database.requestScan.mockResolvedValue({ code: "accepted", id: "queued" });
  const response = await requestScan({ "x-datadeal-client-ip": "192.0.2.1" });
  expect(response.status).toBe(202);
  expect(database.requestScan).toHaveBeenCalledWith(
    "example.com",
    expect.stringMatching(/^client:[0-9a-f]{64}$/),
    expect.stringMatching(/^daily:client:[0-9a-f]{64}$/),
    undefined,
  );
});

it("returns the public summary and critical warnings without advanced evidence", async () => {
  lookup.mockResolvedValue({
    host: "example.com",
    history: [{ state: "completed" }],
    report: {
      findings: [],
      id: "current-scan",
      policyBrief: [
        {
          text: "The policy describes account data collection.",
          source: "public-policy-evidence",
          topic: "collection",
          quote: "We collect account data.",
        },
      ],
      evidence: [
        {
          id: "public-policy-evidence",
          scanId: "current-scan",
          kind: "declared_first_party",
          observation: { type: "policy_section", topic: "collection" },
          excerpt: "We collect account data. Private evidence detail",
        },
      ],
    },
    score: {
      score: 70,
      grade: "mixed",
      verdict: "Use with caution",
      adjustments: [
        {
          severity: "critical",
          title: "Critical warning",
          evidenceIds: ["private-evidence-id"],
        },
        {
          severity: "caution",
          rule: "sensitive_processing",
          title: "Sensitive information collected",
          evidenceIds: ["missing-section", "public-policy-evidence"],
        },
      ],
    },
  });
  const response = await GET(
    new Request(origin + "/api/v1/domains/example.com"),
    {
      params: Promise.resolve({ domain: "example.com" }),
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    domain: "example.com",
    state: "completed",
    report: {
      scanId: "current-scan",
      score: null,
      grade: "Unrated",
      confidence: "Low",
      methodologyVersion: "1.0.0",
      verdict: expect.stringContaining("Accept all"),
      policyOnly: false,
      policySummary: ["The policy describes account data collection."],
      visitorSummary: [
        {
          text: "The policy describes account data collection.",
          evidenceIds: ["public-policy-evidence"],
          evidenceLabels: ["Privacy policy"],
        },
      ],
      policyEvidenceId: "public-policy-evidence",
      policyEvidenceIds: ["public-policy-evidence"],
      warnings: ["Critical warning", "Sensitive information collected"],
      warningEvidenceIds: [null, "public-policy-evidence"],
    },
  });
});

it("puts the cited advertising disclosure ahead of lower-impact policy details", async () => {
  const excerpts = {
    collection: "We collect contact details.",
    purpose: "We use those details to provide our service.",
    sharing: "We share data with advertisers to show ads.",
  };
  lookup.mockResolvedValue({
    host: "example.com",
    history: [{ state: "completed" }],
    report: {
      findings: [],
      id: "current-scan",
      evidence: Object.entries(excerpts).map(([topic, excerpt]) => ({
        id: topic,
        scanId: "current-scan",
        kind: "declared_first_party",
        observation: { type: "policy_section", topic },
        excerpt,
      })),
      policyBrief: [
        {
          topic: "collection",
          source: "collection",
          quote: excerpts.collection,
          text: "Contact details can be collected.",
        },
        {
          topic: "purpose",
          source: "purpose",
          quote: excerpts.purpose,
          text: "The site processes those details to deliver its service.",
        },
        {
          topic: "sharing",
          source: "sharing",
          quote: excerpts.sharing,
          text: "Advertisers receive data when the site shows ads.",
        },
      ],
      scoring: {
        adjustments: [
          {
            rule: "declared_advertising_sharing",
            adjustment: -15,
            evidenceIds: ["sharing"],
          },
        ],
      },
    },
    score: { score: 70, grade: "Mixed", adjustments: [] },
  });
  const response = await GET(
    new Request(origin + "/api/v1/domains/example.com"),
    {
      params: Promise.resolve({ domain: "example.com" }),
    },
  );
  expect(await response.json()).toMatchObject({
    report: {
      policySummary: [
        "Advertisers receive data when the site shows ads.",
        "Contact details can be collected.",
      ],
    },
  });
});

it("preserves policy context on a default-only legacy scan without an AI summary", async () => {
  const host = "thedannicraft.de";
  lookup.mockResolvedValue({
    host,
    history: [{ state: "completed" }],
    report: {
      findings: [],
      id: "current-scan",
      domain: host,
      evidence: [
        {
          id: "booking-policy",
          scanId: "current-scan",
          kind: "declared_first_party",
          excerpt:
            "The contact page can open the booking interface provided by Morgen.",
          observation: { type: "policy_section", topic: "sharing" },
        },
      ],
    },
    score: { score: 85, grade: "Good", adjustments: [] },
  });
  const response = await GET(new Request(`${origin}/api/v1/domains/${host}`), {
    params: Promise.resolve({ domain: host }),
  });
  expect(await response.json()).toMatchObject({
    report: {
      score: null,
      policyOnly: false,
      policySummary: [
        "The policy says “The contact page can open the booking interface provided by Morgen.”",
      ],
    },
  });
});

it("returns cited first-party excerpts to the extension when no AI summary exists", async () => {
  const host = "example.com";
  const scanId = "10000000-0000-4000-8000-000000000001";
  lookup.mockResolvedValue({
    host,
    history: [],
    report: {
      findings: [],
      id: scanId,
      domain: host,
      preferredPolicyEvidenceId: "sharing",
      evidence: [
        {
          id: "older",
          scanId: "past-scan",
          kind: "declared_first_party",
          excerpt: "We share your data with advertisers.",
          observation: { type: "policy_section", topic: "sharing" },
        },
        {
          id: "collection",
          scanId,
          kind: "declared_first_party",
          excerpt: "We collect your email address when you register.",
          observation: { type: "policy_section", topic: "collection" },
        },
        {
          id: "sharing",
          scanId,
          kind: "declared_first_party",
          excerpt: "We share your address with our delivery provider.",
          observation: { type: "policy_section", topic: "sharing" },
        },
      ],
    },
    score: { score: 70, grade: "Mixed", adjustments: [] },
  });
  const response = await GET(new Request(`${origin}/api/v1/domains/${host}`), {
    params: Promise.resolve({ domain: host }),
  });
  expect(await response.json()).toMatchObject({
    report: {
      scanId,
      policyEvidenceIds: ["sharing", "collection"],
      policySummary: [
        "The policy says “We share your address with our delivery provider.”",
        "The policy says “We collect your email address when you register.”",
      ],
    },
  });
});

it("publishes a saved AI summary when its original policy quote matches", async () => {
  const host = "thedannicraft.de";
  const quote =
    "The contact page can open the booking interface provided by Morgen.";
  lookup.mockResolvedValue({
    host,
    history: [],
    report: {
      findings: [],
      id: "current-scan",
      domain: host,
      evidence: [
        {
          id: "booking-policy",
          scanId: "current-scan",
          kind: "declared_first_party",
          excerpt: quote,
          observation: { type: "policy_section", topic: "sharing" },
        },
      ],
      policyBrief: [
        {
          source: "booking-policy",
          topic: "sharing",
          quote,
          text: "Morgen provides an optional booking interface.",
        },
      ],
    },
    score: { score: 85, grade: "Good", adjustments: [] },
  });
  const response = await GET(new Request(`${origin}/api/v1/domains/${host}`), {
    params: Promise.resolve({ domain: host }),
  });
  expect(await response.json()).toMatchObject({
    report: {
      policySummary: ["Morgen provides an optional booking interface."],
      policyEvidenceIds: ["booking-policy"],
    },
  });
});

it("explains what is missing from an unrated report with a verified browser visit", async () => {
  lookup.mockResolvedValue({
    host: "example.com",
    history: [{ state: "partially_completed" }],
    report: {
      findings: [],
      id: "current-scan",
      evidence: [
        {
          scanId: "current-scan",
          kind: "observed_technical",
          consentScenario: "default",
          observation: {
            type: "browser_consent_counts",
            requests: 5,
            externalDomains: [],
            cookies: 0,
          },
        },
      ],
    },
    score: { score: null, grade: "Unrated", adjustments: [] },
  });
  const response = await GET(
    new Request(`${origin}/api/v1/domains/example.com`),
    {
      params: Promise.resolve({ domain: "example.com" }),
    },
  );
  expect(await response.json()).toMatchObject({
    report: {
      score: null,
      policyOnly: false,
      browserSummary:
        "On the tested homepage, we saw no requests to outside domains and found no cookies at the end.",
      verdict: expect.stringContaining("Accept all"),
    },
  });
});

it("returns the accepted scan ID from the transactional queue operation", async () => {
  database.requestScan.mockResolvedValue({
    id: "existing-scan",
    code: "accepted",
  });
  const response = await requestScan();
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ id: "existing-scan" });
  expect(database.requestScan).toHaveBeenCalledOnce();
});

it("reports the remaining domain cooldown", async () => {
  database.requestScan.mockResolvedValue({
    code: "domain_cooldown",
    retryAfter: 450,
  });
  const response = await requestScan();
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("450");
  expect(await response.json()).toMatchObject({ code: "domain_cooldown" });
});

it("accepts same-origin loopback aliases in development only", async () => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  database.requestScan.mockResolvedValue({
    id: "existing-scan",
    code: "accepted",
  });
  const submit = (origin: string) =>
    POST(
      new Request("http://localhost:3000/api/v1/domains/example.com", {
        method: "POST",
        headers: { Origin: origin },
      }),
      { params: Promise.resolve({ domain: "example.com" }) },
    );
  vi.stubEnv("NODE_ENV", "development");
  expect((await submit("http://localhost:3000")).status).toBe(202);
  expect((await submit("http://localhost:3001")).status).toBe(403);
  vi.stubEnv("NODE_ENV", "production");
  expect((await submit("http://localhost:3000")).status).toBe(403);
});

it("returns a retry interval if the limit prevents a new scan", async () => {
  database.requestScan.mockResolvedValue({ code: "hourly_limit" });
  const response = await requestScan();
  expect(response.status).toBe(429);
  expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect(await response.json()).toMatchObject({ code: "hourly_limit" });
});
