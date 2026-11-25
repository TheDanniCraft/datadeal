import type { BrowserRequestFields, Evidence, ScanReport } from "./index";
import type { BrowserStorageSnapshot } from "./browser-storage";

export type PracticeStorage = {
  mechanism: "cookie" | "local_storage" | "session_storage";
  family:
    | BrowserStorageSnapshot["cookies"]["recognized"][number]["name"]
    | "Analytics key"
    | "Advertising key"
    | "Consent preference"
    | "Session marker"
    | "Unclassified cookie"
    | "Unclassified storage key";
  snapshot: "before_choice" | "end";
  scope: "same_site" | "outside_site" | "unknown";
  site?: string;
  lifetime: "session" | "persistent" | "unknown";
  count?: number;
  expiry?: "within_day" | "within_month" | "within_year" | "over_year";
  presentAt?: ("before_choice" | "end")[];
};

export type PracticeRequest = Pick<
  BrowserRequestFields,
  | "targetDomain"
  | "scheme"
  | "method"
  | "sources"
  | "relation"
  | "phase"
  | "signature"
  | "fieldCategories"
  | "attempts"
  | "responses"
  | "initiator"
>;

export type PracticeEvidence = {
  factId: string;
  evidenceIds: string[];
  page: "homepage" | "sampled_page";
  pagePath?: string;
  retrievedAt: string;
  capture?: Visit["capture"];
  scenario: NonNullable<Evidence["consentScenario"]>;
  trigger: "before_choice" | "after_reject" | "after_accept" | "unknown";
  observed: "storage" | "request" | "storage_and_request" | "empty_visit";
  storage?: PracticeStorage;
  request?: PracticeRequest;
  linkage: "unlinked" | "exact_ephemeral_match" | "exact_end_match";
  limitations: Array<
    | "purpose_unverified"
    | "request_attempt_only"
    | "storage_origin_unknown"
    | "creation_time_unknown"
    | "retention_unknown"
  >;
};

export type PracticeEvidenceBundle = {
  version: 1;
  practices: PracticeEvidence[];
  truncated: boolean;
};

type Snapshot = PracticeStorage["snapshot"];
type Visit = Extract<
  NonNullable<Evidence["observation"]>,
  { type: "browser_content_page" | "browser_consent_counts" }
>;
type Fact = Omit<PracticeEvidence, "factId">;
const webFamilies = {
  analytics: "Analytics key",
  advertising: "Advertising key",
  permutive_visitor_id: "Permutive visitor ID",
  consent: "Consent preference",
  c15t_key: "c15t",
  session: "Session marker",
  security: "Unclassified storage key",
  unclassified: "Unclassified storage key",
} as const;

function storageFacts(
  snapshot: BrowserStorageSnapshot,
  timing: Snapshot,
): PracticeStorage[] {
  const facts: PracticeStorage[] = snapshot.cookies.recognized.map(
    (cookie) => ({
      mechanism: "cookie",
      family: cookie.name,
      scope: cookie.scope,
      snapshot: timing,
      ...(cookie.site && { site: cookie.site }),
      lifetime: cookie.persistent ? "persistent" : "session",
      ...(cookie.expiry && { expiry: cookie.expiry }),
    }),
  );
  if (snapshot.cookies.unclassified) {
    for (const group of snapshot.cookies.unclassified) {
      facts.push({
        mechanism: "cookie",
        family: "Unclassified cookie",
        snapshot: timing,
        scope: group.scope,
        ...(group.site && { site: group.site }),
        lifetime: group.persistent ? "persistent" : "session",
        ...(group.expiry && { expiry: group.expiry }),
        count: group.count,
      });
    }
  } else if (snapshot.cookies.inspected > snapshot.cookies.recognized.length) {
    facts.push({
      mechanism: "cookie",
      family: "Unclassified cookie",
      snapshot: timing,
      scope: "unknown",
      lifetime: "unknown",
      count: snapshot.cookies.inspected - snapshot.cookies.recognized.length,
    });
  }
  if (snapshot.web) {
    for (const mechanism of ["local", "session"] as const) {
      for (const category of snapshot.web[mechanism].categories) {
        facts.push({
          mechanism:
            mechanism === "local" ? "local_storage" : "session_storage",
          family: webFamilies[category],
          snapshot: timing,
          scope: "same_site",
          lifetime: mechanism === "local" ? "persistent" : "session",
        });
      }
    }
  }
  return facts;
}

function afterTrigger(
  visit: Visit,
  scenario: Fact["scenario"],
): Fact["trigger"] {
  if (!visit.afterChoice) return "unknown";
  return scenario === "rejected" && visit.afterChoice.acceptedAll !== true
    ? "after_reject"
    : scenario === "accepted" && visit.afterChoice.acceptedAll === true
      ? "after_accept"
      : "unknown";
}

function newAfterChoice(
  item: PracticeStorage,
  before: BrowserStorageSnapshot | undefined,
  earlier: PracticeStorage[],
) {
  if (!before || item.family.startsWith("Unclassified")) return false;
  const store =
    item.mechanism === "cookie"
      ? before.cookies
      : before.web?.[item.mechanism === "local_storage" ? "local" : "session"];
  return (
    store &&
    store.inspected === store.total &&
    !earlier.some(
      (other) =>
        other.family === item.family && other.mechanism === item.mechanism,
    )
  );
}

function sourceOrigin(source: Evidence) {
  const url = source.url && URL.parse(source.url);
  return url && /^https?:$/.test(url.protocol) ? url.origin : undefined;
}

// A path can carry names, tokens and project IDs even without a query. Keep
// only explicitly public route labels in the normalized practice context.
function safePagePath(url: string) {
  const path = new URL(url).pathname;
  const known =
    /^(?:about|account|articles?|blog|booking|chat|contact|docs|help|home|kontakt|news|pricing|privacy|products?|services?|shop|signup|support|terms|work|de|en)$/i;
  return path
    .split("/")
    .slice(0, 8)
    .map((part) => (!part || known.test(part) ? part : ":page"))
    .join("/");
}

// Fixed-width citation for a canonical, value-free fact. Sorting the input
// evidence or selecting a subset leaves the citation unchanged. Reject a
// collision instead of associating a citation with two different facts.
function factId(scanId: string, fact: Fact) {
  const { request, storage } = fact;
  // JSONB may reorder object keys between capture and publication.
  const text = JSON.stringify([
    scanId,
    fact.evidenceIds,
    fact.observed,
    fact.scenario,
    fact.trigger,
    fact.linkage,
    storage && [
      storage.mechanism,
      storage.family,
      storage.scope,
      storage.site,
      storage.snapshot,
      storage.expiry,
      storage.lifetime,
    ],
    request && [
      request.targetDomain,
      request.scheme,
      request.method,
      request.sources,
      request.relation,
      request.phase,
      request.signature,
      request.initiator,
      request.fieldCategories,
    ],
  ]);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++)
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n,
    );
  return "practice-" + hash.toString(16).padStart(16, "0");
}

export function buildPracticeEvidenceBundle(
  report: Pick<ScanReport, "id" | "evidence">,
): PracticeEvidenceBundle {
  const sources = report.evidence.filter(
    (entry) =>
      entry.scanId === report.id && entry.kind === "observed_technical",
  );
  const counts = new Map<string, number>();
  for (const { id } of sources) counts.set(id, (counts.get(id) ?? 0) + 1);
  const unique = sources.filter((source) => counts.get(source.id) === 1);
  const facts = new Map<string, Fact>();
  const collisions = new Set<string>();
  function add(fact: Fact) {
    const key = factId(report.id, fact);
    const previous = facts.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(fact))
      collisions.add(key);
    else facts.set(key, fact);
  }
  for (const source of unique) {
    const visit = source.observation,
      scenario = source.consentScenario;
    if (
      !scenario ||
      (visit?.type !== "browser_consent_counts" &&
        visit?.type !== "browser_content_page")
    )
      continue;
    const page =
      visit.type === "browser_consent_counts" ? "homepage" : "sampled_page";
    const origin = sourceOrigin(source);
    const expectedId =
      page === "homepage"
        ? new RegExp("^browser-consent-" + scenario + "$")
        : new RegExp("^browser-page-[1-9]\\d*-" + scenario + "$");
    if (!origin || !expectedId.test(source.id) || visit.finalPageKnown !== true)
      continue;
    const base = {
      page,
      scenario,
      retrievedAt: source.retrievedAt,
      pagePath: safePagePath(source.url!),
      ...(visit.capture && { capture: visit.capture }),
    } as const;
    const before = visit.storageSummary?.beforeChoice;
    const earlier = before ? storageFacts(before, "before_choice") : [];
    const end =
      visit.storageSummary && storageFacts(visit.storageSummary.end, "end");
    const snapshots = [...earlier, ...(end ?? [])];
    for (const storage of snapshots) {
      // Presence refers to a recorded family in a mechanism and scope.
      // Different samples do not prove continuity of one identifier.
      storage.presentAt = [
        ...new Set(
          snapshots
            .filter(
              (row) =>
                row.family === storage.family &&
                row.mechanism === storage.mechanism &&
                row.scope === storage.scope &&
                row.site === storage.site &&
                (storage.family !== "Unclassified cookie" ||
                  (row.lifetime === storage.lifetime &&
                    row.expiry === storage.expiry)),
            )
            .map((row) => row.snapshot),
        ),
      ];
      const trigger =
        scenario === "default" || storage.snapshot === "before_choice"
          ? "before_choice"
          : newAfterChoice(storage, before, earlier)
            ? afterTrigger(visit, scenario)
            : "unknown";
      const limitations: Fact["limitations"] = [
        "purpose_unverified",
        "creation_time_unknown",
      ];
      if (storage.scope === "unknown")
        limitations.push("storage_origin_unknown");
      if (!storage.expiry) limitations.push("retention_unknown");
      add({
        ...base,
        observed: "storage",
        storage,
        trigger,
        evidenceIds: [source.id],
        linkage: "unlinked",
        limitations,
      });
    }
    if (
      scenario === "default" &&
      visit.cookies === 0 &&
      visit.storage?.localEntries === 0 &&
      visit.storage.sessionEntries === 0 &&
      visit.externalDomains.length === 0
    ) {
      add({
        ...base,
        observed: "empty_visit",
        trigger: "before_choice",
        evidenceIds: [source.id],
        linkage: "unlinked",
        limitations: ["purpose_unverified"],
      });
    }
    const requests =
      visit.type === "browser_content_page"
        ? visit.network.map((group) => ({ group, id: source.id }))
        : unique.flatMap((other) =>
            other.consentScenario === scenario &&
            sourceOrigin(other) === origin &&
            new RegExp("^browser-network-" + scenario + "-[1-9]\\d*$").test(
              other.id,
            ) &&
            other.observation?.type === "browser_request_fields"
              ? [{ group: other.observation, id: other.id }]
              : [],
          );
    for (const { group, id } of requests) {
      const {
        targetDomain,
        relation,
        phase,
        signature,
        fieldCategories,
        attempts,
        responses,
        initiator,
      } = group;
      const parentDomain = new URL(origin).hostname;
      const inParentSite =
        parentDomain === targetDomain ||
        parentDomain.endsWith("." + targetDomain);
      const sameScheme = new URL(origin).protocol === group.scheme + ":";
      const after = visit.afterChoice;
      const phaseAttempts =
        phase === "after_choice"
          ? (after?.requests ?? 0)
          : visit.requests - (after?.requests ?? 0);
      const outside =
        phase === "after_choice"
          ? after?.externalDomains
          : visit.externalDomains;
      if (
        responses > attempts ||
        attempts > phaseAttempts ||
        (after && after.requests > visit.requests) ||
        (relation === "cross_site"
          ? inParentSite && sameScheme
          : !inParentSite || !sameScheme) ||
        (!inParentSite &&
          outside &&
          outside.length < 20 &&
          !outside.includes(targetDomain)) ||
        (!inParentSite &&
          responses > 0 &&
          visit.responseDomains &&
          visit.externalDomains.length < 20 &&
          !visit.responseDomains.includes(targetDomain))
      )
        continue;
      const request: PracticeRequest = {
        targetDomain,
        scheme: group.scheme,
        method: group.method,
        sources: [...group.sources].sort(),
        relation,
        phase,
        ...(signature && { signature }),
        fieldCategories: [...fieldCategories].sort(),
        attempts,
        responses,
        ...(initiator && { initiator }),
      };
      const trigger =
        phase === "before_choice"
          ? "before_choice"
          : afterTrigger(visit, scenario);
      const endMatch =
        !group.matchedStorage &&
        Boolean(group.matchedEndStorage) &&
        responses > 0 &&
        visit.capture?.identifierComparisonEnabled === true;
      const marker =
        group.matchedStorage ??
        (endMatch ? group.matchedEndStorage : undefined);
      const exactEndpoint =
        marker === "fbp_cookie"
          ? signature === "meta_pixel_event" &&
            targetDomain === "facebook.com" &&
            fieldCategories.includes("advertising_id")
          : signature === "permutive_event" &&
            targetDomain === "permutive.app" &&
            fieldCategories.includes("identifier");
      const candidates =
        marker &&
        visit.freshContext &&
        exactEndpoint &&
        initiator === "tested_top_level" &&
        group.scheme === "https"
          ? (endMatch ? (end ?? []) : earlier).filter(
              (item) =>
                item.scope === "same_site" &&
                item.family ===
                  (marker === "fbp_cookie" ? "_fbp" : "Permutive visitor ID") &&
                item.mechanism ===
                  (marker === "permutive_local" ? "local_storage" : "cookie"),
            )
          : [];
      const storage = candidates.length === 1 ? candidates[0] : undefined;
      const limitations: Fact["limitations"] = ["purpose_unverified"];
      if (!responses) limitations.push("request_attempt_only");
      if (storage) limitations.push("creation_time_unknown");
      add({
        ...base,
        observed: storage ? "storage_and_request" : "request",
        trigger,
        ...(storage && { storage }),
        request,
        evidenceIds: id === source.id ? [id] : [source.id, id],
        linkage: storage
          ? endMatch
            ? "exact_end_match"
            : "exact_ephemeral_match"
          : "unlinked",
        limitations,
      });
    }
  }
  const priority = (fact: Fact) =>
    (fact.linkage !== "unlinked" ? 32 : 0) +
    (fact.request?.signature ? 16 : 0) +
    (fact.request?.fieldCategories.includes("email_address_value") ? 16 : 0) +
    (fact.page === "homepage" ? 8 : 0) +
    (fact.request ||
    (fact.storage && !fact.storage.family.startsWith("Unclassified"))
      ? 4
      : 0) +
    (fact.trigger === "after_reject" ? 2 : 0);
  const entries = [...facts.entries()]
    .filter(([key]) => !collisions.has(key))
    .sort(([a, x], [b, y]) => priority(y) - priority(x) || a.localeCompare(b));
  return {
    version: 1,
    practices: entries
      .slice(0, 192)
      .map(([factId, fact]) => ({ factId, ...fact })),
    truncated: collisions.size > 0 || entries.length > 192,
  };
}
