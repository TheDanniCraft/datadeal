import { expect, it } from "vitest";
import type { Evidence, ScanReport } from "@datadeal/contracts";
import { visitorSummary } from "./visitor-summary";
import {
  publicReportEvidence,
  withPracticeEvidenceExcerpts,
} from "./public-report-evidence";
import { metaSecurityHeading } from "@datadeal/contracts/meta-cookies";

const id = "090a47ec-8ef2-43d2-8230-2040bb967118";
const date = "2026-11-25T12:00:00Z";
const visit: Evidence = {
  id: "browser-consent-default",
  scanId: id,
  kind: "observed_technical",
  retrievedAt: date,
  consentScenario: "default",
  url: "https://example.org/",
  excerpt: "Signed-out homepage visit.",
  observation: {
    type: "browser_consent_counts",
    freshContext: true,
    finalPageKnown: true,
    requests: 3,
    externalDomains: [],
    cookies: 0,
    storage: { localEntries: 0, sessionEntries: 0 },
  },
};
const accepted: Evidence = {
  ...visit,
  id: "browser-consent-accepted",
  consentScenario: "accepted",
  observation: {
    type: "browser_consent_counts",
    freshContext: true,
    finalPageKnown: true,
    requests: 5,
    externalDomains: [],
    cookies: 1,
    afterChoice: { acceptedAll: true, requests: 1, externalDomains: [] },
    storage: { localEntries: 1, sessionEntries: 0 },
  },
};
const report: ScanReport = {
  id,
  domain: "example.org",
  completedAt: date,
  demo: false,
  partial: false,
  findings: [],
  consentCoverage: {
    default: "measured",
    accepted: "measured",
    rejected: "untested",
  },
  evidence: [visit, accepted],
};

function analyticsVisit(base: Evidence) {
  const source = structuredClone(base);
  const observation = source.observation;
  if (observation?.type !== "browser_consent_counts")
    throw Error("Expected visit fixture");
  observation.externalDomains = ["google-analytics.com"];
  observation.responseDomains = ["google-analytics.com"];
  observation.cookies = 1;
  observation.storageSummary = {
    end: {
      cookies: {
        total: 1,
        inspected: 1,
        recognized: [
          {
            name: "_ga",
            site: "example.org",
            scope: "same_site",
            persistent: true,
            valueShape: "analytics_client_format",
            secure: true,
            httpOnly: false,
            sameSite: "Lax",
          },
        ],
      },
    },
  };
  return source;
}

it.each([visit, accepted])(
  "cites the response and cookie together from the same measured $consentScenario visit",
  (base) => {
    const source = analyticsVisit(base);
    const current = { ...report, evidence: [source] };
    const [claim] = visitorSummary(current).claims;
    expect(claim.text).toContain(
      base === visit
        ? "without making a cookie choice"
        : "visit where we accepted all",
    );
    expect(claim.text).toContain("can distinguish a returning browser");
    expect(claim.sources).toHaveLength(1);
    const citation = claim.sources[0];
    expect(citation.quote).toContain(
      "google-analytics.com returned an HTTP response",
    );
    expect(citation.quote).toContain("example.org had a persistent _ga cookie");
    for (const rows of [
      publicReportEvidence(current, [source.id]),
      withPracticeEvidenceExcerpts(current, []).evidence,
    ]) {
      expect(rows.find((e) => e.id === citation.source)?.excerpt).toContain(
        citation.quote,
      );
    }
  },
);

it("keeps analytics out of the takeaway when only one clue is supported or the visit belongs elsewhere", () => {
  const source = analyticsVisit(visit);
  const obs = source.observation;
  if (obs?.type !== "browser_consent_counts" || !obs.storageSummary)
    throw Error("Expected storage fixture");
  const end = obs.storageSummary.end.cookies;
  for (const invalid of [
    { ...source, scanId: "old-scan" },
    { ...source, url: "https://elsewhere.example/" },
    { ...source, observation: { ...obs, responseDomains: [] } },
    {
      ...source,
      observation: {
        ...obs,
        responseDomains: ["google-analytics.com.example.org"],
      },
    },
    { ...source, observation: { ...obs, freshContext: undefined } },
    { ...source, observation: { ...obs, finalPageKnown: false } },
    { ...source, observation: { ...obs, storageSummary: undefined } },
    ...[
      { valueShape: undefined },
      { persistent: false },
      { scope: "outside_site" as const },
      { site: "another.example" },
      { name: "_ga_*" as const },
    ].map((change) => ({
      ...source,
      observation: {
        ...obs,
        storageSummary: {
          end: {
            cookies: {
              ...end,
              recognized: [{ ...end.recognized[0]!, ...change }],
            },
          },
        },
      },
    })),
  ]) {
    expect(visitorSummary({ ...report, evidence: [invalid] }).claims).toEqual(
      [],
    );
  }
  expect(
    visitorSummary({
      ...report,
      consentCoverage: undefined,
      evidence: [source],
    }).claims,
  ).toEqual([]);
  expect(
    visitorSummary({
      ...report,
      evidence: [source, { ...source, id: "second-run" }],
    }).claims,
  ).toEqual([]);
  // The accepted visit, when available, owns the summary even if a default visit saw analytics.
  expect(
    visitorSummary({ ...report, evidence: [source, accepted] }).claims[0]?.text,
  ).not.toMatch(/Google Analytics/);
});

it("explains Facebook security cookies only when this visit and this scan's named policy passage support the claim", () => {
  const measured = structuredClone(accepted);
  measured.url = "https://www.facebook.com/";
  const row = measured.observation;
  if (row?.type !== "browser_consent_counts") throw Error("Expected visit");
  const datr = {
    name: "datr" as const,
    site: "facebook.com",
    scope: "same_site" as const,
    secure: true,
    httpOnly: true,
    sameSite: "Lax" as const,
    persistent: true,
  };
  row.cookies = 2;
  row.storageSummary = {
    end: {
      cookies: {
        total: 2,
        inspected: 2,
        recognized: [datr, { ...datr, name: "sb" }],
      },
    },
  };
  const policy: Evidence = {
    id: "meta-cookie-security",
    scanId: id,
    retrievedAt: date,
    kind: "declared_first_party",
    url: "https://www.facebook.com/privacy/policies/cookies?subpage=subpage-1.2",
    excerpt:
      'This includes, for example, our "sb" and "dbln" cookies, which enable us to identify your browser securely, as well as "datr." "Datr" is a unique identifier for your browser that, among other things, helps us protect you from fraud.',
    observation: {
      type: "policy_section",
      topic: "purpose",
      heading: metaSecurityHeading,
    },
  };
  const summary = (...sources: Evidence[]) =>
    visitorSummary({
      ...report,
      domain: "facebook.com",
      evidence: [{ ...visit, url: measured.url }, measured, ...sources],
    }).claims;
  const claim = summary(policy)[0]!;
  expect(claim.text).toMatch(
    /held datr and sb.*unique browser identifier.*prevent fraud.*sb.*recognize your browser securely/,
  );
  expect(claim.sources.map((s) => s.source)).toEqual([measured.id, policy.id]);
  expect(claim.sources[1]?.quote).toBe(policy.excerpt);
  for (const sources of [
    [],
    [{ ...policy, scanId: "previous" }],
    [
      {
        ...policy,
        url: "https://facebook.com.example.org/privacy/policies/cookies?subpage=subpage-1.2",
      },
    ],
    [{ ...policy, excerpt: "Our security policy concerns fraud." }],
  ]) {
    expect(
      summary(...sources)
        .map((c) => c.text)
        .join(" "),
    ).not.toMatch(/prevent fraud|recognize your browser securely/);
  }
});

it("uses the accept-all inventory and links its own visit when the initial homepage was empty", () => {
  const { claims } = visitorSummary(report);
  expect(claims).toHaveLength(1);
  expect(claims[0].text).toContain("one cookie and one item in local storage");
  expect(claims[0].sources.map((s) => s.source)).toEqual([accepted.id]);
  expect(claims[0].text).not.toMatch(
    /functional|advertis|no cookies|starting score/i,
  );
});

it("never substitutes a clean default visit or a partial optional choice for accept-all", () => {
  const incomplete = structuredClone(accepted);
  if (
    incomplete.observation?.type !== "browser_consent_counts" ||
    !incomplete.observation.afterChoice
  )
    throw Error("invalid fixture");
  incomplete.observation.afterChoice.acceptedAll = false;
  for (const evidence of [
    [visit],
    [visit, incomplete],
    [accepted, { ...accepted, id: "duplicate-accepted-run" }],
    [visit, { ...accepted, scanId: "another-scan" }],
  ])
    expect(visitorSummary({ ...report, evidence }).claims).toEqual([]);
});

it("explains a measured preference pair only with matching first-party documentation", () => {
  const measured = structuredClone(accepted);
  const o = measured.observation;
  if (o?.type !== "browser_consent_counts")
    throw Error("Expected homepage fixture");
  const empty = { total: 0, inspected: 0, categories: [] };
  o.storageSummary = {
    beforeChoice: {
      cookies: { total: 0, inspected: 0, recognized: [] },
      web: { local: empty, session: empty },
    },
    end: {
      cookies: {
        total: 1,
        inspected: 1,
        recognized: [
          {
            name: "c15t",
            scope: "same_site",
            site: "example.org",
            persistent: true,
            secure: true,
            httpOnly: false,
            sameSite: "Lax",
          },
        ],
      },
      web: {
        local: { total: 1, inspected: 1, categories: ["c15t_key"] },
        session: empty,
      },
    },
  };
  const policy: Evidence = {
    id: "privacy-preferences",
    scanId: id,
    kind: "declared_first_party",
    retrievedAt: date,
    url: "https://example.org/cookies",
    observation: {
      type: "policy_section",
      topic: "purpose",
      heading: "Privacy preferences",
      disclosedPreference: "c15t_choice",
    },
    excerpt:
      "Provider Example / c15t Storage First-party cookie and local storage Purpose Apply and remember your privacy choices.",
  };
  const claim = visitorSummary({ ...report, evidence: [measured, policy] })
    .claims[0];
  expect(claim.text).toContain("remember your privacy choices");
  expect(claim.sources.map((s) => s.source)).toEqual([measured.id, policy.id]);
  for (const evidence of [
    [measured],
    [measured, { ...policy, url: "https://another.org/cookies" }],
  ]) {
    expect(
      visitorSummary({ ...report, evidence }).claims[0].text,
    ).not.toContain("remember your privacy choices");
  }
});

it("pairs individual Google cookie explanations with the accepted visit and the exact conditional policy passage", () => {
  const measured = structuredClone(accepted);
  measured.url = "https://www.google.com/";
  if (measured.observation?.type !== "browser_consent_counts")
    throw Error("Expected visit");
  const nid = {
    name: "NID" as const,
    site: "google.com",
    scope: "same_site" as const,
    secure: true,
    httpOnly: true,
    sameSite: "Lax" as const,
    persistent: true,
  };
  measured.observation.cookies = 2;
  measured.observation.storageSummary = {
    end: {
      cookies: {
        total: 2,
        inspected: 2,
        recognized: [nid, { ...nid, name: "SOCS" }],
      },
    },
  };
  const source = (key: string, heading: string, text: string): Evidence => ({
    scanId: id,
    id: key,
    kind: "declared_first_party",
    retrievedAt: date,
    url: "https://policies.google.com/technologies/cookies?hl=en",
    excerpt: text,
    observation: { type: "policy_section", topic: "purpose", heading },
  });
  const ads = source(
    "google-ads",
    "Advertising",
    "The ‘NID’ cookie can be used to show ads in Google services for signed-out users.",
  );
  const choices = source(
    "google-choices",
    "Functionality",
    "Google uses the ‘SOCS’ cookie to store a user’s state regarding their cookies choices.",
  );
  const summary = (...sources: Evidence[]) =>
    visitorSummary({
      ...report,
      domain: "google.com",
      evidence: [{ ...visit, url: measured.url }, measured, ...sources],
    }).claims;
  const claims = summary(ads, choices);
  expect(claims[0].text).toMatch(
    /held Google’s NID cookie.*can be used to show ads to signed-out visitors/,
  );
  expect(claims[1].text).toMatch(
    /held Google’s SOCS cookie.*remembers your cookie choices/,
  );
  expect(claims.map((c) => c.sources.map((s) => s.source))).toEqual([
    [measured.id, ads.id],
    [measured.id, choices.id],
  ]);
  expect(claims[0].sources[1].quote).toBe(ads.excerpt);
  const security = source(
    "google-security",
    "Security",
    "The ‘AEC’ cookies are used to detect spam, fraud, and abuse.",
  );
  measured.observation.cookies = 3;
  const endCookies = measured.observation.storageSummary.end.cookies;
  endCookies.total = 3;
  endCookies.inspected = 3;
  endCookies.recognized.push({ ...nid, name: "AEC" });
  measured.observation.externalDomains = ["csp.withgoogle.com", "gstatic.com"];
  measured.observation.responseDomains = ["gstatic.com"];
  const explained = summary(ads, choices, security);
  expect(explained[1].text).toMatch(
    /SOCS remembers your cookie choices and AEC helps detect spam/,
  );
  expect(explained[1].sources.map((s) => s.source)).toEqual([
    measured.id,
    choices.id,
    security.id,
  ]);
  expect(explained[2].text).toMatch(
    /contacted gstatic.com before you accepted/,
  );
  expect(explained[2].text).not.toMatch(/csp.withgoogle.com|sent cookies/);
  expect(explained[2].sources.map((s) => s.source)).toEqual([measured.id]);
  measured.observation.afterChoice!.externalDomains = ["gstatic.com"];
  expect(
    summary(ads, choices, security).some((c) =>
      c.text.includes("before you accepted"),
    ),
  ).toBe(false);
  for (const other of [
    [{ ...ads, scanId: "older-scan" }],
    [{ ...ads, excerpt: "NID is not used for advertising on this service." }],
    [
      {
        ...ads,
        url: "https://policies.google.com.example.org/technologies/cookies",
      },
    ],
    [],
  ]) {
    expect(
      summary(...other)
        .map((c) => c.text)
        .join(" "),
    ).not.toMatch(/can be used to show ads/);
  }
  measured.observation.storageSummary.end.cookies.recognized[0]!.site =
    "example.org";
  expect(
    summary(ads, choices)
      .map((c) => c.text)
      .join(" "),
  ).not.toMatch(/held Google’s NID/);
});
