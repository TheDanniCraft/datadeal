import type {
  DataPractice,
  Evidence,
  PublishedScoring,
  ScanReport,
} from "@datadeal/contracts";
import { measuredContentPage } from "@datadeal/contracts/content-page";
import { vendorDisclosures } from "@datadeal/contracts/vendor-listing";
import { c15tChoiceDisclosure } from "@datadeal/contracts/c15t-choice";
import { documentedCookie } from "@datadeal/contracts/documented-cookie";
import {
  buildPracticeEvidenceBundle,
  type PracticeEvidence,
  type PracticeStorage,
} from "@datadeal/contracts/practice-evidence";
import { gradeForScore, methodologyVersion } from "./grades";

type Scenario = DataPractice["scenario"];
type PracticeRating = NonNullable<
  PublishedScoring["practiceAssessment"]
>["ratings"][number];
export const contextualRulesRevision = "contextual-practices-5";

// Each entry rates one substantiated practice in one phase. These are scores,
// not deltas. Multiple manifestations of the same practice never compound.
export const practiceRubric = {
  declaredAdCookie: {
    label:
      "The browser retained a first-party cookie whose documented uses include advertising for signed-out visitors",
    default: 65,
    rejected: 60,
    accepted: 70,
  },
  declaredRecognition: {
    label:
      "The browser retained a first-party browser identifier whose documented uses include security checks",
    default: 78,
    rejected: 78,
    accepted: 78,
  },
  declaredOperationalCookie: {
    label:
      "A first-party cookie had a documented consent or fraud-prevention purpose. Its presence alone does not establish broader exposure.",
    default: null,
    rejected: null,
    accepted: null,
  },
  linkedAdvertising: {
    label:
      "A persistent browser ID matched an ID sent to an independent advertising recipient",
    default: 35,
    rejected: 15,
    accepted: 50,
  },
  contactAdvertising: {
    label:
      "An independent advertising recipient received an email-shaped address",
    default: 30,
    rejected: 15,
    accepted: 45,
  },
  advertisingEvent: {
    label:
      "An independent advertising recipient received a populated advertising ID or an ID with browsing activity",
    default: 45,
    rejected: 30,
    accepted: 60,
  },
  optionalAnalytics: {
    label:
      "An optional analytics recipient received an identifier with browsing activity",
    default: 58,
    rejected: 45,
    accepted: 70,
  },
  controllerEvent: {
    label:
      "An outside endpoint received an ID with event data. The site's advertising disclosure names its provider as controller for its service.",
    default: 45,
    rejected: 30,
    accepted: 60,
  },
  controllerLinkedId: {
    label:
      "An outside endpoint received an identifier matched to persistent browser storage. The advertising policy names its provider as controller for its service.",
    default: 35,
    rejected: 15,
    accepted: 50,
  },
  persistentStorage: {
    label:
      "The site stored a recognized persistent identifier for optional analytics or advertising",
    default: 68,
    rejected: 55,
    accepted: 72,
  },
  observedLinkedId: {
    label:
      "An outside endpoint received an identifier matched to persistent browser storage. Its purpose or role remains unverified.",
    default: 55,
    rejected: 50,
    accepted: 62,
  },
  observedContact: {
    label:
      "An outside endpoint received an email-shaped value in an email field. Whose address it was and how it was used remain unknown.",
    default: 55,
    rejected: 50,
    accepted: 62,
  },
  observedIdEvent: {
    label:
      "An outside event endpoint answered a request with an identifier and event data. The recipient’s use remains unverified.",
    default: 65,
    rejected: 60,
    accepted: 70,
  },
  observedPersistentId: {
    label:
      "The browser held a recognized persistent identifier. Its purpose and subsequent use remain unverified.",
    default: 72,
    rejected: 70,
    accepted: 74,
  },
  proportionate: {
    label:
      "An identified storage item supported a requested feature, security or a consent preference",
    default: 85,
    rejected: 85,
    accepted: 85,
  },
  operationalTransfer: {
    label:
      "A documented service provider received data for an operational feature. The passive visit did not establish what visitor action required this exchange.",
    default: null,
    rejected: null,
    accepted: null,
  },
  quietVisit: {
    label:
      "The measured visit had no outside requests or cookies or web storage at the end",
    default: 80,
    rejected: null,
    accepted: null,
  },
} as const;
type Rule = keyof typeof practiceRubric;
const trackingStorage = new Set<PracticeStorage["family"]>([
  "_ga",
  "_ga_*",
  "_gid",
  "_gcl_au",
  "_fbp",
  "_fbc",
  "Permutive visitor ID",
]);
const triggers = {
  default: "before_choice",
  rejected: "after_reject",
  accepted: "after_accept",
} as const;

function verifiedContext(
  practice: DataPractice,
  fact: PracticeEvidence,
  sources: Map<string, Evidence>,
) {
  const quote = practice.contextQuote;
  const source = quote && sources.get(quote.source);
  if (
    practice.role === "service_controller" ||
    practice.evidence.context.length > 1 ||
    (source?.observation?.type === "policy_section" &&
      source.observation.vendorListing)
  ) {
    if (
      !vendorDisclosures(fact, sources).some(
        ({ entry, context }) =>
          (entry.id === quote?.source || context.id === quote?.source) &&
          practice.evidence.context.includes(entry.id) &&
          practice.evidence.context.includes(context.id),
      )
    )
      return false;
  }
  return Boolean(
    quote &&
    quote.text.trim().length >= 12 &&
    source?.kind === "declared_first_party" &&
    (source.observation?.type === "policy_section" ||
      source.observation?.type === "processing_document") &&
    source.excerpt.includes(quote.text) &&
    practice.evidence.context.includes(source.id),
  );
}

function practiceRule(
  practice: DataPractice,
  fact: PracticeEvidence,
  sources: Map<string, Evidence>,
): Rule | undefined {
  if (
    (practice.interpretation !== "analyst_reviewed" &&
      practice.interpretation !== "source_matched") ||
    practice.confidence === "low" ||
    practice.control !== triggers[practice.scenario] ||
    fact.trigger !== practice.control
  )
    return;
  if (
    fact.storage?.family === "c15t" ||
    practice.interpretation === "source_matched"
  ) {
    const source = c15tChoiceDisclosure(fact, sources);
    if (
      source &&
      practice.dataClass === "preference" &&
      practice.operation === "stored" &&
      practice.role === "site_operator" &&
      practice.purpose === "consent" &&
      practice.necessity === "proportionate" &&
      !practice.recipient &&
      !practice.linkedIdentifier &&
      practice.scope === "same_site" &&
      practice.evidence.context.length === 1 &&
      practice.evidence.context[0] === source.id &&
      practice.contextQuote?.source === source.id &&
      practice.contextQuote.text === source.excerpt
    )
      return "proportionate";
    return;
  }
  if (
    fact.observed === "empty_visit" &&
    practice.operation === "observed_visit"
  )
    return "quietVisit";
  if (!verifiedContext(practice, fact, sources)) return;
  const request = fact.request;
  if (request) {
    if (
      request.scheme !== "https" ||
      !request.responses ||
      request.responses > request.attempts ||
      (practice.operation !== "transmitted" &&
        practice.operation !== "stored_and_transmitted") ||
      practice.recipient !== request.targetDomain ||
      request.relation !== "cross_site" ||
      practice.scope !== "cross_site" ||
      // The source still displays the answered request when sender attribution is unknown.
      (request.initiator !== "tested_top_level" &&
        request.initiator !== "same_origin_frame")
    )
      return;
    if (
      practice.necessity === "proportionate" &&
      practice.role === "processor" &&
      (practice.purpose === "support" ||
        practice.purpose === "security" ||
        practice.purpose === "consent")
    )
      return "operationalTransfer";
    if (practice.necessity !== "optional") return;
    const fields = request.fieldCategories;
    const browsing =
      fields.includes("page_url") ||
      fields.includes("referrer_url") ||
      fields.includes("event_name");
    const identifier =
      fields.includes("identifier") || fields.includes("advertising_id");
    if (
      (practice.role === "independent" ||
        practice.role === "service_controller") &&
      practice.purpose === "advertising"
    ) {
      if (
        practice.role === "independent" &&
        practice.dataClass === "contact_details" &&
        fields.includes("email_address_value")
      )
        return "contactAdvertising";
      if (
        practice.linkedIdentifier &&
        practice.dataClass === "persistent_browser_id" &&
        practice.persistence === "persistent" &&
        fact.storage?.lifetime === "persistent" &&
        fact.linkage !== "unlinked" &&
        practice.operation === "stored_and_transmitted" &&
        fact.evidenceIds.every((id) => practice.evidence.link.includes(id))
      )
        return practice.role === "service_controller"
          ? "controllerLinkedId"
          : "linkedAdvertising";
      if (practice.role === "service_controller")
        return identifier && browsing ? "controllerEvent" : undefined;
      if (fields.includes("advertising_id") || (identifier && browsing))
        return "advertisingEvent";
    }
    if (
      practice.purpose === "analytics" &&
      practice.role !== "unknown" &&
      identifier &&
      browsing
    )
      return "optionalAnalytics";
    return;
  }
  const storage = fact.storage;
  if (
    !storage ||
    practice.operation !== "stored" ||
    storage.scope !== "same_site" ||
    (practice.scope !== "same_site" && practice.scope !== "same_origin")
  )
    return;
  if (
    trackingStorage.has(storage.family) &&
    storage.lifetime === "persistent" &&
    practice.dataClass === "persistent_browser_id" &&
    practice.persistence === "persistent" &&
    practice.necessity === "optional" &&
    (practice.purpose === "analytics" || practice.purpose === "advertising")
  )
    return "persistentStorage";
  if (
    practice.necessity !== "proportionate" ||
    (practice.role !== "site_operator" && practice.role !== "processor")
  )
    return;
  if (
    (storage.family === "Chatwoot conversation" &&
      practice.purpose === "support" &&
      practice.dataClass === "conversation_id") ||
    (["OptanonConsent", "euconsent-v2", "Consent preference"].includes(
      storage.family,
    ) &&
      practice.purpose === "consent" &&
      practice.dataClass === "preference") ||
    (storage.family === "__cf_bm" && practice.purpose === "security")
  )
    return "proportionate";
}

// Independent of AI interpretation: these limited scores describe only a
// measured data class and operation. The thresholds deliberately stop above
// those for an independently verified advertising practice in the same phase.
function observedRule(
  practice: DataPractice,
  fact: PracticeEvidence,
): Rule | undefined {
  if (
    practice.control !== triggers[practice.scenario] ||
    fact.trigger !== practice.control
  )
    return;
  const { request, storage } = fact;
  if (
    fact.observed === "empty_visit" &&
    practice.operation === "observed_visit"
  )
    return "quietVisit";
  if (!request) {
    if (
      practice.operation === "stored" &&
      storage?.scope === "same_site" &&
      storage.lifetime === "persistent" &&
      trackingStorage.has(storage.family)
    )
      return "observedPersistentId";
    return;
  }
  if (
    (practice.operation !== "transmitted" &&
      practice.operation !== "stored_and_transmitted") ||
    request.scheme !== "https" ||
    !request.responses ||
    request.relation !== "cross_site" ||
    practice.recipient !== request.targetDomain
  )
    return;
  if (request.fieldCategories.includes("email_address_value"))
    return "observedContact";
  if (
    fact.linkage !== "unlinked" &&
    storage?.lifetime === "persistent" &&
    practice.linkedIdentifier &&
    fact.evidenceIds.every((id) => practice.evidence.link.includes(id))
  )
    return "observedLinkedId";
  const fields = request.fieldCategories;
  if (
    (request.signature === "permutive_event" ||
      request.signature === "meta_pixel_event") &&
    fields.includes("event_name") &&
    (fields.includes("advertising_id") || fields.includes("identifier"))
  )
    return "observedIdEvent";
}

function policyCoverage(report: ScanReport, sources: Map<string, Evidence>) {
  const disclosures = [
    ...(report.policyBrief ?? []),
    ...(report.policyClaims ?? []).flatMap((claim) => {
      if (claim.confidence === "low") return [];
      if (claim.category === "purpose") return [{ ...claim, topic: "purpose" }];
      if (claim.category === "recipient")
        return [{ ...claim, topic: "sharing" }];
      return [];
    }),
  ];
  const topics = new Set(
    disclosures.flatMap(({ source, quote, topic }) => {
      const entry = sources.get(source);
      return quote &&
        entry?.kind === "declared_first_party" &&
        entry.observation?.type === "policy_section" &&
        entry.observation.topic === topic &&
        entry.excerpt.includes(quote)
        ? [topic]
        : [];
    }),
  );
  return topics.has("purpose") && topics.has("sharing");
}

function completeInventory(source: Evidence) {
  const visit = source.observation;
  if (
    visit?.type !== "browser_content_page" &&
    visit?.type !== "browser_consent_counts"
  )
    return false;
  const end = visit.storageSummary?.end;
  // Unknown providers/opaque transmissions and bounded collection cannot justify a favorable assessment.
  return Boolean(
    visit.freshContext &&
    visit.finalPageKnown &&
    visit.requests > 0 &&
    visit.externalDomains.length === 0 &&
    visit.requestInspection &&
    !visit.requestInspection.limitReached &&
    end?.web &&
    end.cookies.total === visit.cookies &&
    end.cookies.inspected === end.cookies.total &&
    end.web.local.inspected === end.web.local.total &&
    end.web.local.total === visit.storage?.localEntries &&
    end.web.session.inspected === end.web.session.total &&
    end.web.session.total === visit.storage?.sessionEntries,
  );
}

export function contextualRating(
  report: ScanReport,
  scenario: Scenario,
  homepage?: Evidence,
): PublishedScoring {
  const bundle = buildPracticeEvidenceBundle(report);
  const sources = new Map(
    report.evidence
      .filter((source) => source.scanId === report.id)
      .map((source) => [source.id, source]),
  );
  const visits = [
    homepage,
    ...(report.pageSample?.pages ?? []).map(
      (_, i) => measuredContentPage(report, i, scenario)?.source,
    ),
  ];
  const eligibleVisits = new Set(
    visits.flatMap((source) => {
      const observation = source?.observation;
      if (
        !source?.url ||
        (observation?.type !== "browser_content_page" &&
          observation?.type !== "browser_consent_counts") ||
        !observation.freshContext ||
        !observation.finalPageKnown ||
        (scenario === "accepted" &&
          observation.afterChoice?.acceptedAll !== true) ||
        (scenario === "rejected" &&
          (!observation.afterChoice ||
            observation.afterChoice.acceptedAll === true))
      )
        return [];
      return [source.id];
    }),
  );
  const facts = bundle.practices.filter(
    (fact) =>
      fact.scenario === scenario && eligibleVisits.has(fact.evidenceIds[0]!),
  );
  const proposed = (report.dataPractices ?? []).filter(
    (practice) => practice.scenario === scenario,
  );
  const assessments: PracticeRating[] = [];
  const assessed = new Set<string>();
  const contextualScores: number[] = [];
  const recognitionCookies = new Set<string>();
  for (const fact of facts) {
    const candidates = proposed.filter(
      (practice) => practice.factId === fact.factId,
    );
    const practice = candidates.length === 1 ? candidates[0] : undefined;
    if (!practice) continue;
    const validCitations =
      fact.evidenceIds.every((id) => practice.evidence.behavior.includes(id)) &&
      practice.evidence.behavior.every((id) => fact.evidenceIds.includes(id)) &&
      [...practice.evidence.link, ...practice.evidence.context].every((id) =>
        sources.has(id),
      );
    const contextual = validCitations
      ? practiceRule(practice, fact, sources)
      : undefined;
    const cookie =
      validCitations &&
      practice.operation === "stored" &&
      !practice.recipient &&
      !practice.linkedIdentifier &&
      fact.storage?.snapshot === "end"
        ? documentedCookie(fact, sources)
        : undefined;
    // End-of-visit presence is measured even if the same family was present
    // before the click. Only a documented persistent exposure can stand alone.
    const persistent = fact.storage?.lifetime === "persistent";
    const cookieRule =
      cookie?.use === "signed_out_ads" && persistent
        ? "declaredAdCookie"
        : cookie?.use === "browser_recognition" && persistent
          ? "declaredRecognition"
          : cookie?.use === "consent" || cookie?.use === "security"
            ? "declaredOperationalCookie"
            : undefined;
    const rule =
      cookieRule ??
      contextual ??
      (validCitations ? observedRule(practice, fact) : undefined);
    const score = rule ? practiceRubric[rule][scenario] : null;
    if (cookieRule === "declaredRecognition" && cookie)
      recognitionCookies.add(cookie.family);
    if (contextual && score !== null) contextualScores.push(score);
    if (score !== null) assessed.add(fact.factId);
    assessments.push({
      factId: fact.factId,
      score,
      reason:
        cookieRule && cookie
          ? `The end-of-visit snapshot contained ${cookie.family}${persistent ? " with a persistent expiry" : ""}. ${cookie.description} This measures its presence. Its transmission and actual use remain unverified.`
          : rule
            ? practiceRubric[rule].label
            : "The evidence does not establish all the data, recipient, purpose and timing needed for a numeric rating.",
      evidenceIds: [
        ...new Set([
          ...fact.evidenceIds,
          ...(cookieRule && cookie
            ? [cookie.source.id]
            : validCitations
              ? practice.evidence.context
              : []),
        ]),
      ].slice(0, 24),
    });
  }
  const eligible =
    !report.partial &&
    report.consentCoverage?.[scenario] === "measured" &&
    !!homepage?.url &&
    eligibleVisits.has(homepage.id);
  const complete =
    eligible &&
    !bundle.truncated &&
    report.practiceCoverage?.truncated === false &&
    report.practiceCoverage.analystReviewed > 0 &&
    (contextualScores.length > 0 || recognitionCookies.size > 0) &&
    policyCoverage(report, sources) &&
    visits.every((source) => source && completeInventory(source)) &&
    facts.length > 0 &&
    facts.every((fact) => assessed.has(fact.factId));
  const supported = assessments.flatMap((entry) =>
    entry.score === null ? [] : [entry.score],
  );
  const lowest = supported.length ? Math.min(...supported) : null;
  const score =
    eligible && lowest !== null && (lowest < 75 || complete) ? lowest : null;
  let coverage = !eligible
    ? "This scenario lacks a completed, confirmed visit in a fresh browser context."
    : score === null
      ? "The measured facts do not establish enough context to rate this scenario. Unclassified activity and untested actions remain open."
      : complete
        ? "The rating covers the inspected signed-out pages and cited policy passages. Account use and later activity were outside this visit."
        : "This rating reflects a substantiated practice on the measured pages. Other activity, purposes or recipients may remain unclassified.";
  if (scenario === "default" && score !== null) {
    coverage += " This score covers activity before a consent choice.";
    if (
      report.consentCoverage?.rejected !== "measured" &&
      report.consentCoverage?.accepted !== "measured"
    )
      coverage +=
        " Acceptance and rejection of optional consent were not measured.";
  }
  return {
    methodologyVersion,
    rulesRevision: contextualRulesRevision,
    adjustments: [],
    practiceAssessment: { coverage, ratings: assessments },
    score,
    grade: score === null ? "Unrated" : gradeForScore(score),
    confidence:
      score === null || score >= 75 || !contextualScores.includes(score)
        ? "Low"
        : "Moderate",
    verdict:
      score === null
        ? eligible && recognitionCookies.size
          ? `The site kept ${[...recognitionCookies].sort().join(" and ")} for browser recognition according to its security policy. Other activity on the tested pages remains unclassified.`
          : "More evidence is needed to rate this visit."
        : score >= 75
          ? "The assessed visit showed limited exposure."
          : score < 40
            ? "Limit the data you share with this site."
            : "Use with caution.",
  };
}
