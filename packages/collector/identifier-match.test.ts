import { expect, it } from "vitest";
import type { Request } from "playwright";
import { buildPracticeEvidenceBundle } from "@datadeal/contracts/practice-evidence";
import {
  evidence,
  type Evidence,
  type BrowserRequestFields,
} from "@datadeal/contracts";
import { requestFieldCollector } from "./request-fields";
import { isolatedIdentifierMatcher } from "./identifier-match";

const origin = new URL("https://www.example.com");
const id = "c96b5871-47d3-4613-95b5-8059df2026ee";
const value = "fb.1.1720000000000.123456789";
function pixel(
  value: string,
  topOrigin: string | undefined,
  endpoint = "https://www.facebook.com/tr/",
) {
  return {
    url: () =>
      endpoint + "?id=123456&ev=PageView&fbp=" + encodeURIComponent(value),
    headers: () => ({}),
    method: () => "GET",
    frame: () => {
      if (!topOrigin) throw new Error();
      return { url: () => topOrigin, parentFrame: () => null };
    },
  } as unknown as Request;
}
function sources(group: BrowserRequestFields, name = "_fbp"): Evidence[] {
  const base = {
    scanId: id,
    retrievedAt: "2026-11-25T12:00:00.000Z",
    kind: "observed_technical",
    consentScenario: "rejected",
    url: origin.href,
    excerpt: "Passive browser evidence.",
  };
  const snapshot = {
    cookies: {
      total: 1,
      inspected: 1,
      recognized: [
        {
          name,
          scope: "same_site",
          persistent: true,
          secure: true,
          httpOnly: false,
          sameSite: "Lax",
          expiry: "within_year",
        },
      ],
    },
  };
  return [
    evidence.parse({
      ...base,
      id: "browser-consent-rejected",
      observation: {
        type: "browser_consent_counts",
        freshContext: true,
        finalPageKnown: true,
        requests: 1,
        cookies: 1,
        externalDomains: ["facebook.com"],
        afterChoice: { requests: 1, externalDomains: ["facebook.com"] },
        storageSummary: { beforeChoice: snapshot, end: snapshot },
      },
    }),
    evidence.parse({
      ...base,
      id: "browser-network-rejected-1",
      observation: group,
    }),
  ];
}

it("compares only an answered event to final storage without claiming a prior storage read", () => {
  const matcher = isolatedIdentifierMatcher();
  const collector = requestFieldCollector(origin, matcher);
  const unanswered = pixel(value, origin.href);
  const other = pixel(value.replace("123456789", "987654321"), origin.href);
  collector.request(unanswered, "after_choice");
  collector.request(other, "after_choice");
  collector.response(other);
  matcher.sample("fbp_cookie", value, true);
  expect(collector.results()[0].matchedEndStorage).toBeUndefined();
  collector.response(unanswered);
  const [group] = collector.results();
  expect(group.matchedEndStorage).toBe("fbp_cookie");
  expect(group.matchedStorage).toBeUndefined();
  const evidence = sources(group);
  const obs = evidence[0].observation;
  if (obs?.type !== "browser_consent_counts" || !obs.storageSummary)
    throw Error("missing capture");
  obs.requests = obs.afterChoice!.requests = 2;
  delete obs.storageSummary.beforeChoice;
  obs.capture = {
    navigationStartedAt: "2026-11-25T11:59:56Z",
    endSnapshotAt: "2026-11-25T12:00:00Z",
    settleMs: 3000,
    identifierComparisonEnabled: true,
  };
  const facts = () => buildPracticeEvidenceBundle({ id, evidence }).practices;
  expect(
    facts().find((f) => f.linkage === "exact_end_match")?.storage?.snapshot,
  ).toBe("end");
  expect(facts().some((f) => f.linkage === "exact_ephemeral_match")).toBe(
    false,
  );
  obs.capture.identifierComparisonEnabled = false;
  expect(facts().some((f) => f.linkage === "exact_end_match")).toBe(false);
  expect(JSON.stringify([group, facts()])).not.toMatch(
    /1720000000000|123456789|987654321|PageView|fbp=/,
  );
  matcher.clear();
});
it("links a previous isolated sample only to the matching request and its own response", () => {
  const matcher = isolatedIdentifierMatcher();
  matcher.sample("fbp_cookie", value);
  const collector = requestFieldCollector(origin, matcher);
  const attempted = pixel(value, origin.href);
  const different = pixel(value.replace("123456789", "987654321"), origin.href);
  collector.request(attempted, "after_choice");
  collector.request(different, "after_choice");
  collector.response(different);
  const [matched, other] = collector.results();
  expect(matched).toMatchObject({
    matchedStorage: "fbp_cookie",
    signature: "meta_pixel_event",
    responses: 0,
  });
  expect(other.matchedStorage).toBeUndefined();
  expect(other.responses).toBe(1);
  collector.response(attempted);
  const rows = sources(matched);
  const bundle = buildPracticeEvidenceBundle({ id, evidence: rows });
  const fact = bundle.practices.find(
    (row) => row.linkage === "exact_ephemeral_match",
  );
  expect(fact).toMatchObject({
    page: "homepage",
    scenario: "rejected",
    trigger: "after_reject",
    storage: {
      family: "_fbp",
      snapshot: "before_choice",
      lifetime: "persistent",
      expiry: "within_year",
    },
    request: { targetDomain: "facebook.com", responses: 1 },
  });
  expect(fact?.evidenceIds).toEqual(rows.map((row) => row.id));
  expect(
    buildPracticeEvidenceBundle({ id, evidence: [...rows].reverse() }),
  ).toEqual(bundle);
  expect(
    buildPracticeEvidenceBundle({
      id,
      evidence: sources(matched, "Chatwoot conversation"),
    }).practices.every((row) => row.linkage === "unlinked"),
  ).toBe(true);
  expect(JSON.stringify([bundle, collector.results()])).not.toMatch(
    /1720000000000|123456789|987654321|PageView|fbp=/,
  );
  matcher.clear();
  expect(matcher.match("fbp_cookie", value)).toBe(false);
});

it("keeps lookalike endpoints, missing origins, different scans and opaque survivors unlinked", () => {
  const matcher = isolatedIdentifierMatcher();
  matcher.sample("fbp_cookie", value);
  const collector = requestFieldCollector(origin, matcher);
  for (const request of [
    pixel(value, undefined),
    pixel(value, "https://other.example"),
    pixel(value, origin.href, "https://www.facebook.com.invalid/tr/"),
  ])
    collector.request(request, "after_choice");
  expect(collector.results().every((group) => !group.matchedStorage)).toBe(
    true,
  );
  const rows = sources(collector.results()[0]);
  const copied = { ...rows[1], scanId: "12345678-1234-4abc-8abc-123456789012" };
  expect(
    buildPracticeEvidenceBundle({
      id,
      evidence: [rows[0], copied],
    }).practices.every((row) => !row.request),
  ).toBe(true);
  const missing = { ...rows[0], url: undefined };
  expect(
    buildPracticeEvidenceBundle({ id, evidence: [missing, rows[1]] }).practices,
  ).toEqual([]);
  const persistent = buildPracticeEvidenceBundle({
    id,
    evidence: rows,
  }).practices.find((row) => row.storage?.snapshot === "end");
  expect(persistent?.trigger).toBe("unknown");
  matcher.clear();
});

it("recognizes only allowlisted Permutive UUID continuity at an exact events endpoint", () => {
  const matcher = isolatedIdentifierMatcher();
  const uuid = "8c4d2507-9f6c-4d21-bc9a-0b056db7d8cc";
  matcher.sample("permutive_local", uuid);
  const collector = requestFieldCollector(origin, matcher);
  const event = {
    url: () => "https://api.permutive.app/v2.0/events",
    method: () => "POST",
    headers: () => ({ "content-type": "application/json" }),
    postDataBuffer: () =>
      Buffer.from(
        JSON.stringify({ name: "Pageview", user_id: uuid, properties: {} }),
      ),
    frame: () => ({ url: () => origin.href, parentFrame: () => null }),
  } as unknown as Request;
  collector.request(event, "after_choice");
  expect(collector.results()[0]).toMatchObject({
    matchedStorage: "permutive_local",
    signature: "permutive_event",
  });
  expect(JSON.stringify(collector.results())).not.toContain(uuid);
  expect(isolatedIdentifierMatcher().match("permutive_local", uuid)).toBe(
    false,
  );
  matcher.clear();
});
