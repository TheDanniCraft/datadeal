import type { ConsentTakeaway, ScanReport } from "@datadeal/contracts";
import { isReportOrigin } from "@datadeal/contracts/content-page";

const names = new Intl.ListFormat("en", { type: "conjunction" });

function postChoiceVisit(
  report: ScanReport | undefined,
  scenario: "accepted" | "rejected",
) {
  if (report?.consentCoverage?.[scenario] !== "measured") return;
  const matches = report.evidence.filter(
    (row) =>
      row.scanId === report.id &&
      row.kind === "observed_technical" &&
      row.consentScenario === scenario &&
      row.observation?.type === "browser_consent_counts",
  );
  if (matches.length !== 1) return;
  const [row] = matches;
  const data = row.observation;
  if (
    !row.url ||
    !isReportOrigin(new URL(row.url).origin, report.domain) ||
    data?.type !== "browser_consent_counts" ||
    data.finalPageKnown !== true ||
    !data.requests ||
    !data.afterChoice ||
    data.afterChoice.requests > data.requests ||
    data.afterChoice.externalDomains.length > data.afterChoice.requests
  )
    return;
  return {
    source: row.id,
    url: row.url,
    hosts: data.afterChoice.externalDomains,
    action:
      scenario === "rejected"
        ? "rejecting optional consent"
        : data.afterChoice.acceptedAll
          ? "accepting all"
          : "accepting optional consent",
    storage: data.storageSummary,
    cookies: data.cookies,
    freshContext: data.freshContext === true,
    acceptedAll: data.afterChoice.acceptedAll === true,
  };
}

// Comparable signed-out runs can answer what changed even when the scanner
// has no evidence for the purpose of the items it counted.
function unclassifiedChoiceStorage(report: ScanReport) {
  const rejected = postChoiceVisit(report, "rejected");
  const accepted = postChoiceVisit(report, "accepted");
  if (
    !rejected?.freshContext ||
    !accepted?.freshContext ||
    rejected.acceptedAll ||
    !accepted.acceptedAll ||
    rejected.url !== accepted.url
  )
    return;
  const counts = (run: typeof rejected) => {
    const before = run.storage?.beforeChoice,
      end = run.storage?.end;
    if (
      !end?.web ||
      !before?.web ||
      before.cookies.total ||
      before.web.local.total ||
      before.web.session.total ||
      end.cookies.total !== run.cookies ||
      end.cookies.total !== end.cookies.inspected ||
      end.cookies.recognized.length ||
      [end.web.local, end.web.session].some(
        (s) =>
          s.inspected !== s.total ||
          s.categories.some((c) => c !== "unclassified"),
      )
    )
      return;
    const cookies = end.cookies.total;
    const web = end.web.local.total + end.web.session.total;
    return {
      cookies,
      web,
      text:
        names.format(
          [
            cookies ? `${cookies} ${cookies === 1 ? "cookie" : "cookies"}` : "",
            web
              ? `${web} browser storage ${web === 1 ? "entry" : "entries"}`
              : "",
          ].filter(Boolean),
        ) || "no cookies or browser storage",
    };
  };
  const reject = counts(rejected),
    accept = counts(accepted);
  if (
    !reject ||
    !accept ||
    !(reject.cookies || reject.web || accept.cookies || accept.web)
  )
    return;
  const summary =
    reject.cookies === accept.cookies && reject.web === accept.web
      ? `The homepage left ${reject.text} in the browser after either accepting or rejecting optional cookies.`
      : `The homepage left ${reject.text} after rejection and ${accept.text} after acceptance.`;
  return { summary, accepted: accept.text, rejected: reject.text };
}

export function consentChoiceTakeaway(
  report: ScanReport | undefined,
  comparison: ReturnType<typeof compareConsentDestinations>,
): ConsentTakeaway | undefined {
  const accepted = postChoiceVisit(report, "accepted");
  const before = accepted?.storage?.beforeChoice;
  const end = accepted?.storage?.end;
  if (accepted && before && end) {
    const added = [];
    const cookies = end.cookies.total - before.cookies.total;
    if (cookies > 0) {
      const unknown = [before.cookies, end.cookies].every(
        (jar) => jar.inspected === jar.total && !jar.recognized.length,
      );
      added.push(
        `${cookies} more ${unknown ? "unclassified " : ""}${cookies === 1 ? "cookie" : "cookies"}`,
      );
    }
    if (before.web && end.web) {
      for (const store of ["session", "local"] as const) {
        const count = end.web[store].total - before.web[store].total;
        if (count > 0)
          added.push(
            `${count} more ${store} storage ${count === 1 ? "entry" : "entries"}`,
          );
      }
    }
    if (added.length)
      return {
        text: `After ${accepted.action}, the browser held ${names.format(added)} than just before the choice.`,
        evidenceId: accepted.source,
      };
  }
  // Older visits can lack a pre-click storage snapshot. A comparison between
  // independent visits requires two measured runs ending on the same page.
  if (accepted && !before && report?.consentCoverage?.default === "measured") {
    const defaults = report.evidence.filter(
      (row) =>
        row.scanId === report.id &&
        row.kind === "observed_technical" &&
        row.consentScenario === "default" &&
        row.observation?.type === "browser_consent_counts",
    );
    const homepage = defaults.length === 1 ? defaults[0] : undefined;
    const visit = homepage?.observation;
    if (
      homepage?.url === accepted.url &&
      visit?.type === "browser_consent_counts" &&
      visit.finalPageKnown === true &&
      visit.requests > 0 &&
      visit.cookies !== accepted.cookies
    ) {
      return {
        text: `After ${accepted.action}, the browser ${accepted.hosts[0] ? `tried to reach ${accepted.hosts[0]} and ` : ""}ended the visit with ${accepted.cookies} ${accepted.cookies === 1 ? "cookie" : "cookies"}, compared with ${visit.cookies} on the visit without a choice.`,
        evidenceId: accepted.source,
        beforeChoiceEvidenceId: homepage.id,
      };
    }
  }
  if (comparison) return comparison.takeaway;
  for (const scenario of ["accepted", "rejected"] as const) {
    const visit = postChoiceVisit(report, scenario);
    const host = visit?.hosts[0];
    if (host && visit) {
      return {
        text: `After ${visit.action}, the browser tried to reach ${host}.`,
        evidenceId: visit.source,
      };
    }
  }
}

export function compareConsentDestinations(report?: ScanReport) {
  const accepted = postChoiceVisit(report, "accepted");
  const rejected = postChoiceVisit(report, "rejected");
  if (!accepted || !rejected || accepted.url !== rejected.url) return;

  const capped = accepted.hosts.length >= 20 || rejected.hosts.length >= 20;
  const onlyAccepted = accepted.hosts.filter(
    (host) => !rejected.hosts.includes(host),
  );
  const onlyRejected = rejected.hosts.filter(
    (host) => !accepted.hosts.includes(host),
  );
  function examples(hosts: string[]) {
    const listed = names.format(hosts.slice(0, 3));
    return hosts.length <= 3 ? listed : `${listed} (+${hosts.length - 3} more)`;
  }
  function evidence(choice: string, hosts: string[], unique: string[]) {
    const count = hosts.length === 20 ? "at least 20" : hosts.length;
    const label = hosts.length === 1 ? "domain" : "domains";
    const ordered = [...new Set([...unique, ...hosts])];
    return (
      `After ${choice}, the browser attempted requests to ${count} outside ${label}` +
      (ordered.length
        ? `, including ${names.format(ordered.slice(0, 3))}.`
        : ".")
    );
  }
  const acceptedText = evidence("accepting", accepted.hosts, onlyAccepted);
  const rejectedText = evidence("rejecting", rejected.hosts, onlyRejected);
  // Keep one citable observation free. Finding a host in one visit cannot
  // establish its purpose, or its absence from a capped capture in another.
  const takeaway = onlyAccepted.length
    ? {
        text: `After ${accepted.action}, the browser tried to reach ${onlyAccepted[0]}.`,
        evidenceId: accepted.source,
      }
    : onlyRejected.length
      ? {
          text: `After rejecting optional consent, the browser tried to reach ${onlyRejected[0]}.`,
          evidenceId: rejected.source,
        }
      : undefined;
  let text: string;
  if (capped) {
    text = `${acceptedText} ${rejectedText} The scanner records up to 20 outside domains per choice.`;
  } else if (onlyAccepted.length || onlyRejected.length) {
    text = [
      onlyAccepted.length &&
        `The browser tried to reach ${examples(onlyAccepted)} only on the accept visit.`,
      onlyRejected.length &&
        `The browser tried to reach ${examples(onlyRejected)} only on the reject visit.`,
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    text = accepted.hosts.length
      ? `The browser tried to reach the same outside ${accepted.hosts.length === 1 ? "domain" : "domains"} after either choice: ${examples(accepted.hosts)}.`
      : "The browser made no requests to outside domains after either choice.";
  }
  const storage = report && unclassifiedChoiceStorage(report);
  return {
    text: storage ? text + " " + storage.summary : text,
    takeaway,
    sources: [
      {
        id: accepted.source,
        label: "Accept visit",
        excerpt:
          acceptedText +
          (storage ? " The browser ended with " + storage.accepted + "." : ""),
      },
      {
        id: rejected.source,
        label: "Reject visit",
        excerpt:
          rejectedText +
          (storage ? " The browser ended with " + storage.rejected + "." : ""),
      },
    ],
  };
}
