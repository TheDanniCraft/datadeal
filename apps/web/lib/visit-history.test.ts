import { expect, it } from "vitest";
import type { Evidence, ScanReport } from "@datadeal/contracts";
import { compareVisitDestinations } from "./visit-history";

type Visit = Extract<
  NonNullable<Evidence["observation"]>,
  { type: "browser_consent_counts" }
>;
function snapshot(later: boolean, domains: string[]) {
  const day = later ? "2026-11-25" : "2026-11-24";
  const id = later
    ? "a8646a7d-a671-4cd0-9cb2-83e94e36768b"
    : "1a680bb2-0b5c-40d4-a20d-2828c2ac5939";
  const observation: Visit = {
    type: "browser_consent_counts",
    freshContext: true,
    finalPageKnown: true,
    capture: {
      navigationStartedAt: day + "T10:00:00Z",
      endSnapshotAt: day + "T10:00:10Z",
      settleMs: 600,
    },
    requests: domains.length + 2,
    cookies: 0,
    externalDomains: ["before.example", ...domains].slice(0, 20),
    responseDomains: ["before.example"],
    afterChoice: {
      acceptedAll: true,
      requests: domains.length,
      externalDomains: domains,
    },
  };
  const source: Evidence = {
    id: "browser-consent-accepted",
    kind: "observed_technical",
    consentScenario: "accepted",
    retrievedAt: day + "T10:00:11Z",
    url: "https://example.com/en/",
    scanId: id,
    excerpt: "Visit measurement",
    observation,
  };
  const report: ScanReport = {
    id,
    domain: "example.com",
    completedAt: day + "T10:02:00Z",
    partial: false,
    demo: false,
    evidence: [source],
    findings: [],
    consentCoverage: {
      default: "measured",
      rejected: "untested",
      accepted: "measured",
    },
  };
  return { source, observation, report };
}

it("compares post-choice attempts using two actual accept-all evidence rows", () => {
  const before = snapshot(false, ["shared.example", "old.example"]).report;
  const after = snapshot(true, ["new.example", "shared.example"]).report;
  expect(compareVisitDestinations(before, after)).toEqual({
    earlierOnly: ["old.example"],
    laterOnly: ["new.example"],
    pageUrl: "https://example.com/en/",
    previous: {
      scanId: before.id,
      evidenceId: before.evidence[0].id,
      retrievedAt: before.evidence[0].retrievedAt,
      href: `/report/example.com?scan=${before.id}#evidence-browser-consent-accepted`,
    },
    current: {
      scanId: after.id,
      evidenceId: after.evidence[0].id,
      retrievedAt: after.evidence[0].retrievedAt,
      href: `/report/example.com?scan=${after.id}#evidence-browser-consent-accepted`,
    },
  });
  expect(compareVisitDestinations(after, before)).toBeUndefined();
  expect(compareVisitDestinations(after, after)).toBeUndefined();
});

it("keeps comparable zero and unchanged inventories distinct from missing data", () => {
  for (const hosts of [[], ["one.example"]]) {
    expect(
      compareVisitDestinations(
        snapshot(false, hosts).report,
        snapshot(true, hosts).report,
      ),
    ).toMatchObject({
      earlierOnly: [],
      laterOnly: [],
    });
  }
});

type Snapshot = ReturnType<typeof snapshot>;
const invalid: [string, (item: Snapshot) => void][] = [
  [
    "other report domain",
    ({ report }) => {
      report.domain = "elsewhere.example";
    },
  ],
  [
    "other final pathname",
    ({ source }) => {
      source.url += "article";
    },
  ],
  [
    "other final origin",
    ({ source }) => {
      source.url = "https://www.example.com/en/";
    },
  ],
  [
    "uncertain landing",
    ({ observation }) => {
      delete observation.finalPageKnown;
    },
  ],
  [
    "missing isolation",
    ({ observation }) => {
      delete observation.freshContext;
    },
  ],
  [
    "unknown duration",
    ({ observation }) => {
      delete observation.capture;
    },
  ],
  [
    "different duration",
    ({ observation }) => {
      observation.capture!.settleMs++;
    },
  ],
  [
    "overlapping runs",
    ({ observation }) => {
      observation.capture!.navigationStartedAt = "2026-11-24T10:00:05Z";
    },
  ],
  [
    "default visit",
    ({ source }) => {
      source.consentScenario = "default";
    },
  ],
  [
    "merely optional accept",
    ({ observation }) => {
      delete observation.afterChoice!.acceptedAll;
    },
  ],
  [
    "missing post-choice segment",
    ({ observation }) => {
      delete observation.afterChoice;
    },
  ],
  [
    "option unavailable",
    ({ report }) => {
      report.consentCoverage!.accepted = "control_unavailable";
    },
  ],
  [
    "duplicate measurements",
    ({ source, report }) => {
      report.evidence.push(source);
    },
  ],
  [
    "different scan evidence",
    ({ source }) => {
      source.scanId = snapshot(false, []).report.id;
    },
  ],
  [
    "sample report",
    ({ report }) => {
      report.demo = true;
    },
  ],
  [
    "inconsistent request count",
    ({ observation }) => {
      observation.afterChoice!.requests = 0;
    },
  ],
  [
    "inconsistent domain inventory",
    ({ observation }) => {
      observation.externalDomains = [];
    },
  ],
  [
    "duplicate domains",
    ({ observation }) => {
      observation.afterChoice!.externalDomains.push("new.example");
    },
  ],
];
it.each(invalid)("skips %s", (_, invalidate) => {
  const current = snapshot(true, ["new.example"]);
  invalidate(current);
  expect(
    compareVisitDestinations(snapshot(false, []).report, current.report),
  ).toBeUndefined();
});

it("does not infer absence from an inventory at the 20-domain capture limit", () => {
  const domains = Array.from({ length: 20 }, (_, i) => `d${i}.example`);
  for (const [older, newer] of [
    [domains, []],
    [[], domains],
  ])
    expect(
      compareVisitDestinations(
        snapshot(false, older).report,
        snapshot(true, newer).report,
      ),
    ).toBeUndefined();
  const current = snapshot(true, ["last.example"]);
  // The whole-visit inventory fills independently of the post-choice one.
  current.observation.externalDomains = domains;
  current.observation.requests = 25;
  expect(
    compareVisitDestinations(snapshot(false, []).report, current.report)
      ?.laterOnly,
  ).toEqual(["last.example"]);
});
