import type {
  BrowserRequestFields,
  BrowserStorageSnapshot,
  Evidence,
  ScanReport,
  Finding,
  PublishedScoring,
  DataPractice,
} from "@datadeal/contracts";
import { contextualRating, practiceRubric } from "./contextual";
import { noChoiceEvidence } from "./no-choice";
export { practiceRubric, contextualRulesRevision } from "./contextual";
import {
  acceptAllHomepage,
  isReportOrigin,
  measuredContentPage,
} from "@datadeal/contracts/content-page";

import { grades, gradeForScore, methodologyVersion } from "./grades";
import { inventoryRating } from "./inventory";
export {
  inventoryRating,
  combineCosts,
  inventoryCosts,
  inventoryRulesRevision,
  consentPenalty,
  breadth,
  outsideEuFactor,
  outsideEuHosting,
  missingPolicyCost,
} from "./inventory";
export { grades, gradeForScore, methodologyVersion };
export { reportSignals, type ReportSignals } from "./signals";
export const rulesRevision = "browser-evidence-3";

export const baseScore = 75;
export const weights: Readonly<Record<Finding["rule"], number>> = {
  policy_available: 5,
  no_default_browser_storage: 5,
  no_accept_all_browser_storage: 5,
  optional_control: 10,
  independent_ads: -20,
  external_advertising_field: -10,
  recognized_tracking_storage: -6,
  external_identifier_context: -8,
  external_email_field: -12,
  declared_advertising_sharing: -15,
  declared_ad_personalization: -5,
  sensitive_processing: -18,
  transfer_risk: -15,
  necessary_processor: 0,
  declared_processor: 0,
  missing_information: 0,
};

export function evaluate(report: ScanReport): PublishedScoring {
  return (
    report.scoringCorrection?.result ?? report.scoring ?? calculateScore(report)
  );
}

function measuredHomepage(
  report: ScanReport,
  scenario: DataPractice["scenario"],
) {
  if (report.consentCoverage && report.consentCoverage[scenario] !== "measured")
    return;
  return report.evidence.find((source) => {
    const visit = source.observation;
    return (
      source.scanId === report.id &&
      source.kind === "observed_technical" &&
      source.consentScenario === scenario &&
      visit?.type === "browser_consent_counts" &&
      visit.requests > 0 &&
      visit.finalPageKnown !== false &&
      (!source.url ||
        isReportOrigin(new URL(source.url).origin, report.domain)) &&
      (scenario === "default"
        ? !visit.afterChoice
        : !!visit.afterChoice &&
          visit.afterChoice.requests <= visit.requests &&
          (scenario === "accepted"
            ? visit.afterChoice.acceptedAll === true
            : visit.afterChoice.acceptedAll !== true))
    );
  });
}

/**
 * Inventory ratings are pure arithmetic over the stored classifications, so
 * they are recomputed on read: a rule change reaches every report at once
 * and history compares scans under the same rules.
 */
const liveInventory = (report: ScanReport) =>
  !!report.storageInventory?.classifications.length;

/**
 * A report is partial when the default visit or the privacy policy is
 * missing. Without a policy the inventory still rates what the browser saw
 * (and charges for the missing policy); a missing visit still blocks it.
 */
function ratable(report: ScanReport) {
  if (!report.partial) return true;
  return (
    liveInventory(report) &&
    report.consentCoverage?.default === "measured" &&
    !report.findings.some(({ rule }) => rule === "policy_available")
  );
}

export function verifiedAcceptAllRating(report: ScanReport) {
  if (ratable(report) && acceptAllHomepage(report))
    return (
      report.scoringCorrection?.accepted ??
      (liveInventory(report) ? calculateAcceptAllScore(report) : undefined) ??
      report.acceptAllScoring
    );
}

/** An archived number alone cannot establish a change in a site's practices. */
export function acceptAllScoreChange(
  previous: ScanReport,
  current: ScanReport,
) {
  if (
    previous.id === current.id ||
    previous.demo ||
    current.demo ||
    previous.domain !== current.domain
  )
    return;
  const before = verifiedAcceptAllRating(previous);
  const after = verifiedAcceptAllRating(current);
  if (
    before?.score == null ||
    after?.score == null ||
    before.score === after.score ||
    !before.rulesRevision ||
    before.rulesRevision !== after.rulesRevision ||
    before.methodologyVersion !== after.methodologyVersion ||
    before.baseScore !== after.baseScore
  )
    return;
  return { before: before.score, after: after.score };
}

export function verifiedRejectRating(report: ScanReport) {
  if (!ratable(report) || report.consentCoverage?.rejected !== "measured")
    return;
  if (measuredHomepage(report, "rejected")?.url)
    return (
      report.scoringCorrection?.rejected ??
      (liveInventory(report) ? calculateRejectScore(report) : undefined) ??
      report.rejectedScoring
    );
}

export function calculateRejectScore(report: ScanReport) {
  if (
    report.consentCoverage?.rejected === "measured" &&
    measuredHomepage(report, "rejected")?.url
  ) {
    const v2 = inventoryRating(report, "rejected");
    if (v2) return v2;
  }
  if (
    report.dataPractices === undefined ||
    report.consentCoverage?.rejected !== "measured"
  )
    return;
  const visit = measuredHomepage(report, "rejected");
  if (visit?.url) return contextualRating(report, "rejected", visit);
}

function unratedAcceptAllVerdict(
  report: ScanReport,
  accepted?: PublishedScoring,
) {
  const optIn = acceptAllHomepage(report);
  if (optIn) {
    if (accepted?.practiceAssessment?.ratings.some((row) => row.score !== null))
      return accepted.verdict;
    const practices =
      report.dataPractices?.filter((p) => p.scenario === "accepted") ?? [];
    const unrated = new Set(
      accepted?.practiceAssessment?.ratings
        .filter((r) => r.score === null)
        .map((r) => r.factId),
    );
    if (
      report.practiceCoverage?.truncated === false &&
      practices.length > 0 &&
      unrated.size === practices.length &&
      accepted?.practiceAssessment?.ratings.length === practices.length &&
      practices.every(
        (p) =>
          p.operation === "stored" &&
          p.purpose === "unknown" &&
          unrated.has(p.factId),
      )
    ) {
      const cookies = optIn.visit.storageSummary?.end.cookies;
      if (
        cookies &&
        cookies.total > 0 &&
        cookies.total === optIn.visit.cookies &&
        cookies.inspected === cookies.total &&
        !cookies.recognized.length &&
        cookies.unclassified?.reduce((sum, group) => sum + group.count, 0) ===
          cookies.total
      )
        return `After acceptance, the homepage held ${cookies.total} unclassified ${cookies.total === 1 ? "cookie" : "cookies"}. The capture retained expiry and scope information but could not identify their purpose.`;
      return "Accept all was confirmed. How the site used the stored items remains unclear.";
    }
    return "Accept all was measured, but the observed activity could not be rated.";
  }
  switch (report.consentCoverage?.accepted) {
    case "control_unavailable":
      if (report.consentCoverage.default === "measured") {
        const baseline = report.scoringCorrection?.result ?? report.scoring;
        const lowest = baseline?.practiceAssessment?.ratings.find(
          (row) =>
            row.score != null && row.score === baseline.score && row.score < 75,
        );
        if (lowest)
          return `Before any choice: ${lowest.reason} No Accept all option was detected.`;
        const visit = measuredHomepage(report, "default")?.observation;
        if (
          visit?.type === "browser_consent_counts" &&
          visit.finalPageKnown &&
          visit.freshContext
        ) {
          if (visit.externalDomains.length)
            return "The homepage attempted requests to outside domains before any choice. No Accept all option was detected.";
          if (
            visit.storageSummary?.end.cookies.total === 0 &&
            visit.cookies === 0 &&
            visit.storage?.localEntries === 0 &&
            visit.storage.sessionEntries === 0
          )
            return "The tested homepage made no outside requests and ended with no cookies or web storage. The scan could not establish whether optional processing applies elsewhere.";
        }
      }
      return "No Accept all option was found on the tested page.";
    case "inconclusive":
      if (
        report.consentCoverage.default === "inconclusive" &&
        !report.evidence.some(
          (e) =>
            e.scanId === report.id &&
            e.kind === "observed_technical" &&
            e.observation?.type === "browser_consent_counts",
        )
      )
        return "The browser did not complete a homepage visit, so this scan could not assess its data use.";
      return "The scan could not confirm the Accept all choice.";
    case "measured":
      return "The scan could not confirm the Accept all choice.";
    default:
      return "This scan has no confirmed Accept all visit.";
  }
}

/**
 * When "Accept all" could not be measured, rate the visit the scanner did
 * record instead of leaving the site unrated. Without any consent tool that
 * visit is what everyone gets; with one, the untested part pulls the score
 * toward the middle.
 */
function beforeChoiceHeadline(
  report: ScanReport,
): PublishedScoring | undefined {
  if (
    !liveInventory(report) ||
    !ratable(report) ||
    report.consentCoverage?.default !== "measured" ||
    report.consentCoverage?.accepted === "measured"
  )
    return;
  const consentTool = report.storageInventory!.classifications.some(
    ({ purpose }) => purpose === "consent",
  );
  const rating = inventoryRating(report, "default", {
    acceptUntested: consentTool,
  });
  if (rating?.score == null) return;
  return {
    ...rating,
    headlineBasis: consentTool ? "accept_untested" : "no_choice_offered",
  };
}

/** A verified no-choice visitor scope is distinct from a measured opt-in. */
export function evaluateHeadline(report: ScanReport): {
  rating: PublishedScoring;
  scenario: "accepted" | "default";
} {
  const accepted = verifiedAcceptAllRating(report);
  if (accepted?.score != null)
    return { rating: accepted, scenario: "accepted" };
  const saved = report.scoringCorrection?.result ?? report.scoring;
  if (
    saved?.rulesRevision?.startsWith("contextual-practices-") &&
    Number(saved.rulesRevision.slice("contextual-practices-".length)) >= 5 &&
    saved.score !== null &&
    saved.noChoiceEvidence &&
    !report.partial &&
    report.consentCoverage?.accepted === "control_unavailable"
  )
    return { rating: saved, scenario: "default" };
  const beforeChoice = beforeChoiceHeadline(report);
  if (beforeChoice) return { rating: beforeChoice, scenario: "default" };
  return {
    scenario: "accepted",
    rating: {
      methodologyVersion:
        accepted?.methodologyVersion ??
        report.scoring?.methodologyVersion ??
        methodologyVersion,
      rulesRevision: (accepted ?? report.scoring)?.rulesRevision,
      score: null,
      grade: "Unrated",
      verdict: unratedAcceptAllVerdict(report, accepted),
      confidence: "Low",
      adjustments: [],
      ...(accepted?.practiceAssessment && {
        practiceAssessment: accepted.practiceAssessment,
      }),
    },
  };
}
export function consentedAdvertisingDisclosure(report: ScanReport) {
  return report.evidence.find(
    ({ scanId, kind, observation, excerpt }) =>
      scanId === report.id &&
      kind === "declared_first_party" &&
      observation?.type === "policy_section" &&
      observation.topic === "sharing" &&
      /\bweitergabe von nutzerkennungen zu werbezwecken\b/iu.test(
        observation.heading,
      ) &&
      /\beinwilligung[^!?]{1,160}\berteilt haben\b/iu.test(excerpt) &&
      /\bdienste[^.!?]{1,80}\bdritter, die[^!?]{1,160}\bverantwortlich sind\b/iu.test(
        excerpt,
      ),
  );
}

export function adPersonalizationDisclosure(report: ScanReport) {
  return report.evidence.find(
    ({ scanId, kind, observation, excerpt }) =>
      scanId === report.id &&
      kind === "declared_first_party" &&
      observation?.type === "policy_section" &&
      observation.topic === "purpose" &&
      /\bdepending on your settings, we (?:may (?:also )?)?show you personali[sz]ed ads based on your interests(?:,| or )/iu.test(
        excerpt,
      ),
  );
}

export function calculateScore(report: ScanReport): PublishedScoring {
  const v2 = inventoryRating(report, "default");
  if (v2) return v2;
  if (report.dataPractices !== undefined) {
    const homepage = measuredHomepage(report, "default");
    const rating = contextualRating(report, "default", homepage);
    const support = noChoiceEvidence(report, rating, homepage);
    if (support && rating.practiceAssessment) {
      const score = practiceRubric.quietVisit.default;
      return {
        ...rating,
        score,
        grade: gradeForScore(score),
        confidence: "Low",
        verdict: "No optional tracking was evident on the tested pages.",
        noChoiceEvidence: support,
        practiceAssessment: {
          coverage:
            "This rating covers the signed-out pages tested. No consent controls or outside requests appeared, and the pages ended with empty cookie and web storage inventories. The visitor privacy disclosure supports this reading. Account use and server-side activity were outside the test.",
          ratings: rating.practiceAssessment.ratings.map((row) => ({
            ...row,
            evidenceIds: [...new Set([...row.evidenceIds, support.policyId])],
          })),
        },
      };
    }
    return rating;
  }
  return scoreVisit(report, "default");
}

function answeredOutsideRequest(
  fields: BrowserRequestFields,
  hostname: string,
) {
  // The collector stores the registrable destination, including private suffixes.
  return (
    fields.relation === "cross_site" &&
    fields.scheme === "https" &&
    fields.targetDomain !== hostname &&
    !hostname.endsWith("." + fields.targetDomain) &&
    !fields.targetDomain.endsWith("." + hostname) &&
    fields.responses > 0 &&
    fields.responses <= fields.attempts &&
    fields.sources.length > 0
  );
}

function contentPageRequests(source: Evidence) {
  const visit = source.observation;
  const scenario = source.consentScenario;
  if (
    source.kind !== "observed_technical" ||
    !source.url ||
    visit?.type !== "browser_content_page" ||
    (scenario !== "default" && scenario !== "accepted")
  )
    return [];
  if (
    scenario === "default"
      ? visit.afterChoice !== undefined
      : visit.afterChoice?.acceptedAll !== true
  )
    return [];
  const requestCount = visit.afterChoice?.requests ?? visit.requests;
  if (requestCount > visit.requests) return [];
  const hostname = new URL(source.url).hostname;
  return visit.network.filter(
    (group) =>
      group.phase ===
        (scenario === "default" ? "before_choice" : "after_choice") &&
      group.attempts <= requestCount &&
      answeredOutsideRequest(group, hostname),
  );
}

export function contentPageScoringFields(source: Evidence) {
  const seen = new Set<string>();
  return contentPageRequests(source).filter((group) => {
    const rule = requestExposure(group);
    if (!rule || seen.has(rule)) return false;
    seen.add(rule);
    return true;
  });
}

// Each answered request shape can substantiate just one exposure. A generic
// identifier becomes relevant only when the same request carries visit context.
function requestExposure(group: BrowserRequestFields) {
  const fields = group.fieldCategories;
  if (fields.includes("email_address_value")) return "external_email_field";
  if (fields.includes("advertising_id")) return "external_advertising_field";
  if (
    fields.includes("identifier") &&
    (fields.includes("page_url") ||
      fields.includes("referrer_url") ||
      fields.includes("event_name"))
  )
    return "external_identifier_context";
}

const trackingCookieNames = new Set([
  "_ga",
  "_ga_*",
  "_gid",
  "_gcl_au",
  "_fbp",
  "_fbc",
]);

function trackingStorageSignals(source: Evidence) {
  const visit = source.observation;
  if (
    visit?.type !== "browser_consent_counts" &&
    visit?.type !== "browser_content_page"
  )
    return [];
  const summary = visit.storageSummary;
  if (!summary || visit.finalPageKnown !== true || !source.url) return [];
  const isAccepted = source.consentScenario === "accepted";
  if (
    isAccepted
      ? !visit.afterChoice?.acceptedAll || !summary.beforeChoice
      : visit.afterChoice || source.consentScenario !== "default"
  )
    return [];
  const { end, beforeChoice } = summary;
  function persistentFamilies(snapshot: BrowserStorageSnapshot) {
    return snapshot.cookies.recognized
      .filter(
        (cookie) =>
          cookie.persistent &&
          (trackingCookieNames.has(cookie.name) ||
            (cookie.name === "Permutive visitor ID" &&
              cookie.scope === "same_site")),
      )
      .map((cookie) => cookie.name);
  }
  const signals = new Set<string>();
  if (
    end.cookies.total === visit.cookies &&
    end.cookies.inspected <= end.cookies.total &&
    end.cookies.recognized.length <= end.cookies.inspected &&
    (!isAccepted ||
      (beforeChoice &&
        beforeChoice.cookies.inspected === beforeChoice.cookies.total))
  ) {
    const previous = beforeChoice ? persistentFamilies(beforeChoice) : [];
    for (const family of persistentFamilies(end)) {
      if (!isAccepted || !previous.includes(family))
        signals.add(family + " cookie");
    }
  }
  const local = end.web?.local;
  const previous = beforeChoice?.web?.local;
  if (
    local &&
    local.total === visit.storage?.localEntries &&
    local.inspected > 0 &&
    local.inspected <= local.total &&
    (!isAccepted || (previous && previous.inspected === previous.total))
  ) {
    for (const category of local.categories) {
      if (
        (category === "analytics" ||
          category === "advertising" ||
          category === "permutive_visitor_id") &&
        (!isAccepted || !previous?.categories.includes(category))
      )
        signals.add(
          category === "permutive_visitor_id"
            ? "a Permutive visitor ID key in local storage"
            : category + " local-storage key",
        );
    }
  }
  return [...signals];
}

export function calculateAcceptAllScore(
  report: ScanReport,
): PublishedScoring | undefined {
  if (
    report.consentCoverage?.accepted !== "measured" ||
    !measuredHomepage(report, "accepted")
  )
    return undefined;
  const v2 = inventoryRating(report, "accepted");
  if (v2) return v2;
  if (report.dataPractices !== undefined)
    return contextualRating(
      report,
      "accepted",
      measuredHomepage(report, "accepted"),
    );
  return scoreVisit(report, "accepted");
}

function scoreVisit(
  report: ScanReport,
  scenario: "default" | "accepted",
): PublishedScoring {
  const isDefault = scenario === "default";
  const visitName = isDefault
    ? "default visit"
    : "visit with all optional consent accepted";
  const sources = new Map(
    report.evidence.filter((e) => e.scanId === report.id).map((e) => [e.id, e]),
  );
  const scoredRules = new Set<Finding["rule"]>();
  const findings = report.findings.filter(
    ({ rule, evidenceIds }) =>
      !evidenceIds.some(
        (id) => sources.get(id)?.observation?.type === "processing_document",
      ) &&
      rule !== "no_default_browser_storage" &&
      rule !== "no_accept_all_browser_storage" &&
      rule !== "external_advertising_field" &&
      rule !== "external_identifier_context" &&
      rule !== "external_email_field" &&
      rule !== "recognized_tracking_storage" &&
      (isDefault ||
        (rule !== "optional_control" &&
          evidenceIds.every((id) => {
            const source = sources.get(id);
            return (
              !source?.consentScenario || source.consentScenario === scenario
            );
          }))) &&
      rule !== "declared_advertising_sharing" &&
      rule !== "declared_ad_personalization" &&
      rule !== "declared_processor",
  );
  const sharingDisclosures = [
    ...(report.policyBrief?.filter(({ topic }) => topic === "sharing") ?? []),
    ...(report.policyClaims?.filter(
      ({ category, confidence }) =>
        category === "recipient" && confidence !== "low",
    ) ?? []),
  ].flatMap(({ source, quote }) => {
    const cited = sources.get(source);
    return quote &&
      cited?.kind === "declared_first_party" &&
      cited.observation?.type === "policy_section" &&
      cited.observation.topic === "sharing" &&
      cited.excerpt.includes(quote)
      ? [{ quote, source: cited }]
      : [];
  });
  const processorDisclosure = sharingDisclosures.find(({ quote }) =>
    /\b(?:process it for us|process (?:your )?(?:personal )?(?:data|information) on our behalf)[^.!?]{0,100}\b(?:based on|under|in accordance with) our instructions\b/iu.test(
      quote,
    ),
  )?.source;
  if (processorDisclosure) {
    findings.push({
      rule: "declared_processor",
      title: "Policy describes processing on the site's behalf",
      explanation:
        "The policy describes recipients processing information on the site's instructions.",
      confidence: "moderate",
      severity: "informational",
      evidenceIds: [processorDisclosure.id],
    });
  }
  const sharingSections = [...sources.values()].filter(
    ({ kind, observation }) =>
      kind === "declared_first_party" &&
      observation?.type === "policy_section" &&
      observation.topic === "sharing",
  );
  // Match the policy's own affirmative statement, including its condition.
  // Independently generated quotations can start in the middle of a recipient list.
  const whenAdsShown = sharingSections.find(
    ({ excerpt }) =>
      /(?:^|[.!?]\s+)(?:weitere einzelheiten dazu,\s*)?an wen wir informationen weitergeben:\s*(?:partner[,\s]+)?werbetreibende(?: und (?:[\p{L} -]{1,40}-)?publisher)?\s*\(wenn wir dir werbeanzeigen zeigen\)/iu.test(
        excerpt.trim(),
      ) ||
      /(?:^|[.!?]\s+)(?:here['’]s more detail about )?who we share information with:\s*(?:partners\s*)?advertisers and audience network publishers\s*\(if we show you ads\)/iu.test(
        excerpt.trim(),
      ),
  );
  const adDisclosure = sharingSections.find(({ excerpt }) =>
    /(?:^|[.!?]\s+)(?:we share (?:your )?(?:personal )?(?:data|information) with (?:advertisers|ad networks)|an wen wir informationen weitergeben:\s*(?:partner[,\s]+)?werbetreibende(?: und publisher)?)\s*(?:\.|$)/iu.test(
      excerpt.trim(),
    ),
  );
  const consentedAdDisclosure = consentedAdvertisingDisclosure(report);
  // A consent-dependent policy statement is evidence about accepting the
  // option. Keep its citation visible in the default calculation at zero.
  const englishConsentDisclosure = sharingSections.find(({ excerpt }) =>
    /(?:^|[.!?]\s+)(?:(?:only )?(?:if you consent to (?:tracking|advertising cookies)|with your (?:prior |explicit )?consent), we share (?:your )?(?:personal )?(?:data|information) with (?:advertisers|ad networks)|we share (?:your )?(?:personal )?(?:data|information) with (?:advertisers|ad networks) only (?:with your (?:prior |explicit )?consent|if you consent to (?:tracking|advertising cookies)))\s*(?:\.|$)/iu.test(
      excerpt.trim(),
    ),
  );
  const conditionalSource = consentedAdDisclosure ?? englishConsentDisclosure;
  let beforeChoiceDisclosure: Finding | undefined;
  if (conditionalSource) {
    const condition = consentedAdDisclosure
      ? "If you consent to tracking, the policy describes using advertising identifiers with third parties responsible for their own processing."
      : "The policy describes sharing information with advertisers if you give consent.";
    const finding: Finding = {
      rule: "declared_advertising_sharing",
      title: "Policy lists advertising recipients after consent",
      explanation:
        condition +
        (isDefault
          ? " The before-choice calculation gives this conditional disclosure zero points."
          : ""),
      confidence: "moderate",
      severity: "caution",
      evidenceIds: [conditionalSource.id],
    };
    if (isDefault) beforeChoiceDisclosure = finding;
    findings.push(finding);
  }
  const adDisclosureSource = whenAdsShown ?? adDisclosure;
  if (adDisclosureSource) {
    findings.push({
      rule: "declared_advertising_sharing",
      title: "Privacy policy lists advertising recipients",
      explanation: whenAdsShown
        ? "The policy lists advertisers as recipients when ads are shown to you."
        : "The policy describes sharing information with advertisers or advertising networks.",
      confidence: "moderate",
      severity: "caution",
      evidenceIds: [adDisclosureSource.id],
    });
  }
  const ratedPhase = isDefault ? "before_choice" : "after_choice";
  const standardVisit = measuredHomepage(report, scenario);
  const observation = standardVisit?.observation;
  const sampledVisits = (report.pageSample?.pages ?? []).flatMap((_, index) => {
    const run = measuredContentPage(report, index, scenario);
    return run ? [run.source] : [];
  });
  const homepageGroups = [...sources.values()].flatMap((source) => {
    const o = source.observation;
    if (
      source.kind === "observed_technical" &&
      source.consentScenario === scenario &&
      (!report.consentCoverage ||
        report.consentCoverage[scenario] === "measured") &&
      (!source.url ||
        isReportOrigin(new URL(source.url).origin, report.domain)) &&
      o?.type === "browser_request_fields" &&
      o.phase === ratedPhase &&
      answeredOutsideRequest(o, report.domain) &&
      (observation?.type !== "browser_consent_counts" ||
        o.attempts <=
          (observation.afterChoice?.requests ?? observation.requests))
    )
      return [{ source, group: o }];
    return [];
  });
  const sampledGroups = sampledVisits.flatMap((source) =>
    contentPageRequests(source).map((group) => ({ source, group })),
  );
  const exposures = [
    ["external_email_field", "an email-shaped value in an email field"],
    ["external_advertising_field", "a populated advertising identifier field"],
    [
      "external_identifier_context",
      "an identifier alongside a page, referrer or event field",
    ],
  ] as const;
  for (const [rule, description] of exposures) {
    const matches = (row: { group: BrowserRequestFields }) =>
      requestExposure(row.group) === rule;
    const homepage = homepageGroups.filter(
      (row) =>
        matches(row) &&
        (rule === "external_advertising_field" ||
          (standardVisit?.url && row.source.url)),
    );
    const sampled = sampledGroups.filter(matches);
    if (!homepage.length && !sampled.length) continue;
    const sampledIds = [...new Set(sampled.map(({ source }) => source.id))];
    const scope = [
      ...(homepage.length ? ["the homepage"] : []),
      ...(sampledIds.length
        ? [sampledIds.length === 1 ? "a sampled page" : "sampled pages"]
        : []),
    ].join(" and ");
    const timing = isDefault
      ? "before any consent choice"
      : "after accepting all optional consent";
    findings.push({
      rule,
      title: `An outside domain answered a request with ${description}`,
      explanation:
        `On ${scope}, the browser sent ${description} to an outside domain ${timing} and received an HTTPS response.` +
        (rule === "external_email_field"
          ? " The address owner and the recipient’s use are unknown."
          : ""),
      confidence: "moderate",
      severity: "caution",
      evidenceIds: [...homepage.map(({ source }) => source.id), ...sampledIds],
    });
  }
  const personalization = adPersonalizationDisclosure(report);
  if (personalization) {
    findings.push({
      rule: "declared_ad_personalization",
      title: "Policy describes ad personalization",
      explanation:
        "Depending on your settings, the policy describes using your interests to personalize ads.",
      confidence: "moderate",
      severity: "caution",
      evidenceIds: [personalization.id],
    });
  }
  const storageSources = [
    ...(standardVisit ? [standardVisit] : []),
    ...sampledVisits,
  ].flatMap((source) => {
    const signals = trackingStorageSignals(source);
    return signals.length ? [{ source, signals }] : [];
  });
  if (storageSources.length) {
    const signals = [
      ...new Set(storageSources.flatMap((row) => row.signals)),
    ].join(", ");
    findings.push({
      rule: "recognized_tracking_storage",
      title:
        "Persistent storage matched an analytics or advertising convention",
      explanation: isDefault
        ? `Persistent storage observed before a consent choice included ${signals}.`
        : `The scan found ${signals} at the end of an accept-all visit. The same visit’s pre-choice storage inspection showed no matching family.`,
      confidence: "moderate",
      severity: "caution",
      evidenceIds: storageSources.map((row) => row.source.id),
    });
  }
  const googleAdPolicy = [...sources.values()].find(
    ({ kind, observation, excerpt }) =>
      kind === "declared_first_party" &&
      observation?.type === "policy_section" &&
      observation.topic === "sharing" &&
      /(?:^|[.!?]\s+)we (?:share|disclose|provide) (?:your )?(?:personal )?(?:information|data) (?:with|to) (?:third-party advertising providers (?:such as|including) )?(?:Google Ad Manager|DoubleClick)\b/iu.test(
        excerpt.trimStart(),
      ),
  );
  if (
    standardVisit &&
    observation?.type === "browser_consent_counts" &&
    observation.externalDomains.includes("doubleclick.net") &&
    observation.responseDomains?.includes("doubleclick.net") &&
    (isDefault ||
      homepageGroups.some(
        ({ group }) => group.targetDomain === "doubleclick.net",
      )) &&
    googleAdPolicy &&
    !findings.some(
      ({ rule, confidence, evidenceIds }) =>
        rule === "independent_ads" &&
        confidence !== "low" &&
        evidenceIds.some((id) => sources.get(id)?.consentScenario === scenario),
    )
  ) {
    // The measured connection takes precedence over the disclosure-only factor.
    findings.unshift({
      rule: "independent_ads",
      title: `Google advertising responded on the ${visitName}`,
      explanation: `The browser received a response from doubleclick.net during the ${visitName}. The site's policy lists Google Ad Manager or DoubleClick as an advertising recipient. These two observations do not identify the request contents.`,
      confidence: "moderate",
      severity: "caution",
      evidenceIds: [standardVisit.id, googleAdPolicy.id],
    });
  }
  if (
    standardVisit &&
    observation?.type === "browser_consent_counts" &&
    observation.cookies === 0 &&
    !storageSources.length &&
    observation.storage?.localEntries === 0 &&
    observation.storage.sessionEntries === 0
  ) {
    findings.push({
      rule: isDefault
        ? "no_default_browser_storage"
        : "no_accept_all_browser_storage",
      title: isDefault
        ? "No cookies or storage entries at the end of the default homepage visit"
        : "No cookies or storage entries at the end of the accept-all homepage visit",
      explanation: `At the end of the ${visitName} to the homepage, the browser had no cookies and the page origin had no local or session storage entries. This factor covers only that homepage visit.`,
      confidence: "moderate",
      severity: "positive",
      evidenceIds: [standardVisit.id],
    });
  }
  const adjustments = findings.flatMap((finding) => {
    const cited = finding.evidenceIds.map((id) => sources.get(id));
    if (cited.some((source) => !source)) return [];
    const supported = cited.some(
      (source) =>
        source &&
        (source.kind === "observed_technical" ||
          source.kind === "declared_first_party") &&
        // The browser count records a click and a short observation window.
        // It does not verify that rejection changed optional processing.
        (finding.rule !== "optional_control" ||
          source.observation?.type !== "browser_consent_counts") &&
        // Only evidence from the rated scenario can establish observed advertising.
        (finding.rule !== "independent_ads" ||
          (source.kind === "observed_technical" &&
            source.consentScenario === scenario)),
    );
    const eligible =
      supported &&
      finding !== beforeChoiceDisclosure &&
      finding.confidence !== "low" &&
      (finding.rule === "optional_control" ||
        cited.every(
          (source) =>
            !source?.consentScenario || source.consentScenario === scenario,
        )) &&
      (finding.rule !== "declared_advertising_sharing" ||
        !scoredRules.has("independent_ads")) &&
      (finding.rule !== "external_advertising_field" ||
        (!scoredRules.has("independent_ads") &&
          !scoredRules.has("declared_advertising_sharing"))) &&
      (finding.rule !== "declared_ad_personalization" ||
        (!scoredRules.has("independent_ads") &&
          !scoredRules.has("declared_advertising_sharing") &&
          !scoredRules.has("external_advertising_field"))) &&
      !scoredRules.has(finding.rule);
    const adjustment = eligible ? weights[finding.rule] : 0;
    if (adjustment !== 0) scoredRules.add(finding.rule);
    return [{ ...finding, adjustment }];
  });

  const substantiveRule = [...scoredRules].some(
    (rule) =>
      rule !== "policy_available" &&
      rule !== "no_default_browser_storage" &&
      rule !== "no_accept_all_browser_storage",
  );
  const policyTopics = new Set(
    report.policyBrief?.flatMap(({ topic, source, quote }) => {
      const cited = sources.get(source);
      return quote &&
        cited?.kind === "declared_first_party" &&
        cited.observation?.type === "policy_section" &&
        cited.observation.topic === topic &&
        cited.excerpt.includes(quote)
        ? [topic]
        : [];
    }),
  );
  const policyAndBrowserCoverage =
    Boolean(standardVisit && processorDisclosure) &&
    policyTopics.has("purpose") &&
    policyTopics.has("sharing") &&
    scoredRules.has("policy_available");
  const hasCoverage =
    !report.partial &&
    (policyAndBrowserCoverage ||
      (scoredRules.size >= 2 &&
        (report.demo ||
          substantiveRule ||
          (policyTopics.has("purpose") && policyTopics.has("sharing")))));
  const total = [...scoredRules].reduce(
    (sum, rule) => sum + weights[rule],
    baseScore,
  );
  const score = hasCoverage ? Math.max(0, Math.min(100, total)) : null;
  const grade: (typeof grades)[number][1] | "Unrated" =
    score === null ? "Unrated" : gradeForScore(score);
  const verdict =
    score === null
      ? "Insufficient evidence for a confident recommendation."
      : score >= 75
        ? "Review what the site asks for before sharing personal information."
        : "Consider limiting what you share and rejecting optional consent.";
  return {
    methodologyVersion,
    rulesRevision,
    baseScore,
    adjustments,
    score,
    grade,
    verdict,
    confidence: hasCoverage ? "Moderate" : "Low",
  };
}
