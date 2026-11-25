import { expect, it } from "vitest";
import type {
  BrowserRequestFields,
  Evidence,
  ScanReport,
} from "@datadeal/contracts";
import { publicReportEvidence } from "./public-report-evidence";
import {
  publicProviderDisclosures,
  publicRequestFindings,
  selfHostedAnalyticsDisclosure,
} from "./request-findings";
import { inspectionSummary, summarizeDefaultVisit } from "./browser-summary";
import { visitorPractice } from "./visitor-practice";

const scan: ScanReport = {
  id: "00000000-0000-4000-8000-000000000001",
  domain: "example.org",
  demo: false,
  completedAt: "2026-11-25T12:00:00.000Z",
  partial: false,
  findings: [],
  evidence: [],
};
const row: Evidence = {
  id: "fields-a",
  scanId: scan.id,
  kind: "observed_technical",
  consentScenario: "default",
  retrievedAt: scan.completedAt,
  excerpt: "DO_NOT_PUBLISH_RAW_DATA",
  url: "https://example.org/private?token=DO_NOT_PUBLISH_RAW_DATA",
};
const fields: BrowserRequestFields = {
  type: "browser_request_fields",
  targetDomain: "example.org",
  relation: "same_site",
  scheme: "https",
  method: "POST",
  phase: "before_choice",
  fieldCategories: ["page_url", "site_domain", "event_name"],
  sources: ["json"],
  signature: "plausible_event",
  attempts: 2,
  responses: 1,
};

it("ties the lead to the measured identifier event and distinguishes a response from an attempt", () => {
  const visit: Evidence = {
    ...row,
    id: "browser-consent-accepted",
    consentScenario: "accepted",
    observation: {
      type: "browser_consent_counts",
      freshContext: true,
      finalPageKnown: true,
      requests: 6,
      cookies: 4,
      externalDomains: ["permutive.app"],
      afterChoice: {
        acceptedAll: true,
        requests: 3,
        externalDomains: ["permutive.app"],
      },
    },
  };
  const request: Evidence = {
    ...visit,
    id: "browser-network-accepted-1",
    observation: {
      ...fields,
      targetDomain: "permutive.app",
      phase: "after_choice",
      relation: "cross_site",
      signature: "permutive_event",
      fieldCategories: ["identifier", "event_name"],
    },
  };
  const report: ScanReport = {
    ...scan,
    consentCoverage: {
      default: "untested",
      accepted: "measured",
      rejected: "control_unavailable",
    },
    evidence: [visit, request],
  };
  const lead = visitorPractice(report, "accepted");
  expect(lead?.summary).toMatch(
    /permutive\.app received an event name together with an identifier/,
  );
  expect(lead?.significance).toMatch(/grouped together/);
  expect(lead?.sources).toHaveLength(1);
  expect(lead?.sources[0].quote).toContain("HTTP responses observed: 1");
  if (
    request.observation?.type !== "browser_request_fields" ||
    visit.observation?.type !== "browser_consent_counts"
  )
    throw Error("invalid test fixture");
  request.observation.responses = 0;
  expect(visitorPractice(report, "accepted")?.significance).toBe(
    "Delivery was not confirmed.",
  );
  request.observation.signature = undefined;
  request.observation.fieldCategories = ["identifier"];
  request.observation.responses = 1;
  expect(visitorPractice(report, "accepted")?.summary).toContain(
    "a request with an identifier field",
  );
  expect(visitorPractice(report, "accepted")?.significance).toContain(
    "whether it matches a cookie",
  );
  delete visit.observation.afterChoice!.acceptedAll;
  expect(visitorPractice(report, "accepted")).toBeUndefined();
});

it("publishes bounded request categories, scoped destinations and evidence without original values", () => {
  const report: ScanReport = {
    ...scan,
    evidence: [
      { ...row, observation: fields },
      {
        ...row,
        id: "email-field",
        consentScenario: "accepted",
        observation: {
          ...fields,
          signature: undefined,
          targetDomain: "other.example",
          relation: "cross_site",
          phase: "after_choice",
          fieldCategories: ["email"],
        },
      },
      {
        ...row,
        id: "email-value",
        consentScenario: "rejected",
        observation: {
          ...fields,
          signature: undefined,
          targetDomain: "another.example",
          relation: "cross_site",
          fieldCategories: ["email_value"],
        },
      },
      { ...row, id: "foreign", scanId: "foreign-scan", observation: fields },
    ],
  };
  const findings = publicRequestFindings(report);
  expect(findings).toHaveLength(3);
  expect(findings.find((x) => x.evidenceId === row.id)?.text).toMatch(
    /Plausible-compatible.*same site.*page URL/,
  );
  expect(findings.find((x) => x.evidenceId === "email-field")?.text).toMatch(
    /fields for email address.*after accepting/,
  );
  expect(findings.find((x) => x.evidenceId === "email-value")?.text).toMatch(
    /an email-shaped value.*before rejecting/,
  );
  const publicRows = publicReportEvidence(report, []);
  expect(publicRows.map((x) => x.id)).toEqual([
    "fields-a",
    "email-field",
    "email-value",
  ]);
  expect(publicRows[0].excerpt).toMatch(
    /matching requests attempted: 2.*responses observed: 1/i,
  );
  expect(JSON.stringify(publicRows)).not.toMatch(
    /DO_NOT_PUBLISH|\/private|an independent recipient/,
  );
  expect(
    inspectionSummary({ examined: 18, matched: 2, limitReached: true }),
  ).toMatch(/18 HTTP requests; 2 matched.*limit/);
  expect(summarizeDefaultVisit({ outside: 1 })).toBe(
    "During the tested homepage visit, the browser tried to reach 1 outside domain.",
  );
});

it("links site and provider disclosures independently and requires explicit analytics wording", () => {
  const policy: Evidence = {
    ...row,
    id: "policy",
    kind: "declared_first_party",
    consentScenario: undefined,
    excerpt:
      "This website uses a self-hosted Plausible Analytics instance at analytics.example.org to understand aggregate traffic. Plausible does not set cookies or persistent browser identifiers.",
    observation: { type: "policy_section", heading: "Site analytics" },
  };
  const provider: Evidence = {
    ...row,
    id: "provider",
    kind: "third_party_reference",
    consentScenario: undefined,
    excerpt: "We use a separate hosting provider to store booking data.",
    observation: {
      type: "provider_policy",
      providerHost: "calendar.example",
      heading: "Hosting",
      referringEvidenceId: policy.id,
    },
  };
  const report = { ...scan, evidence: [policy, provider] };
  expect(publicProviderDisclosures(report)).toMatchObject([
    {
      evidenceId: "provider",
      referringEvidenceId: "policy",
      excerpt: provider.excerpt,
    },
  ]);
  expect(publicProviderDisclosures({ ...scan, evidence: [provider] })).toEqual(
    [],
  );
  expect(selfHostedAnalyticsDisclosure(report)).toMatchObject({
    evidenceId: "policy",
    quote: policy.excerpt,
  });
  expect(
    selfHostedAnalyticsDisclosure({
      ...scan,
      evidence: [
        { ...policy, excerpt: "For example, Plausible can be self-hosted." },
      ],
    }),
  ).toBeUndefined();
});
