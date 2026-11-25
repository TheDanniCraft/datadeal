import { z } from "zod";
import { googleCookieDeclarations } from "@datadeal/contracts/google-cookies";
import { documentedCookie } from "@datadeal/contracts/documented-cookie";
import { vendorDisclosures } from "@datadeal/contracts/vendor-listing";
import { c15tChoiceDisclosure } from "@datadeal/contracts/c15t-choice";
import { metaCookieDisclosure } from "@datadeal/contracts/meta-cookies";
import {
  dataPractice,
  isGoogleCookieFamily,
  isGoogleCookiePolicy,
  practiceConfidence,
  practiceNecessity,
  practicePurpose,
  practiceRole,
  type DataPractice,
  type Evidence,
  type ScanReport,
} from "@datadeal/contracts";
import {
  buildPracticeEvidenceBundle,
  type PracticeEvidence,
} from "@datadeal/contracts/practice-evidence";

const quotedContext = z.strictObject({
  source: z.string().min(1).max(160),
  text: z.string().trim().min(12).max(600),
});
// The model interprets a specific observation. Browser mechanics, identity
// linkage and recipient are copied from that observation by the publisher.
export const practiceJudgment = z.strictObject({
  factId: z.string().min(1).max(260),
  purpose: practicePurpose,
  role: practiceRole,
  necessity: practiceNecessity,
  confidence: practiceConfidence,
  context: quotedContext.nullable(),
  possibleConsentConflict: z.boolean(),
});
type Judgment = z.infer<typeof practiceJudgment>;

export function practiceBundle(evidence: readonly Evidence[]) {
  return buildPracticeEvidenceBundle({
    id: evidence[0]?.scanId ?? "",
    evidence: [...evidence],
  });
}

const purposeWords = {
  advertising: /advertis|\bads\b|werb|vermarkt/i,
  analytics: /analy|messung|reichweite|measurement|statisti/i,
  support:
    /support|inquir|contact|kontakt|conversation|kommunikation|anfrage|chat/i,
  security: /secur|sicher|fraud|betrug|abuse|missbrauch/i,
  consent: /consent|einwillig|zustimm|privacy choice/i,
  other: /./,
  unknown: /./,
};
const documentedFamilies: Record<
  string,
  { purpose: DataPractice["purpose"]; term: RegExp }
> = {
  "Chatwoot conversation": { purpose: "support", term: /chatwoot/i },
  "Permutive visitor ID": { purpose: "unknown", term: /permutive/i },
  OptanonConsent: { purpose: "consent", term: /onetrust|optanon/i },
  "euconsent-v2": { purpose: "consent", term: /consent|tcf|einwillig/i },
  __cf_bm: { purpose: "security", term: /cloudflare/i },
  _fbp: { purpose: "advertising", term: /facebook|\bmeta\b/i },
  _fbc: { purpose: "advertising", term: /facebook|\bmeta\b/i },
  _ga: { purpose: "analytics", term: /google analytics/i },
  "_ga_*": { purpose: "analytics", term: /google analytics/i },
  _gid: { purpose: "analytics", term: /google analytics/i },
};

function policyContext(
  fact: PracticeEvidence,
  judgment: Judgment,
  sources: Map<string, Evidence>,
) {
  const quote = judgment.context;
  const source = quote && sources.get(quote.source);
  if (
    !quote ||
    source?.kind !== "declared_first_party" ||
    source.observation?.type !== "policy_section" ||
    !source.excerpt.slice(0, 4000).includes(quote.text)
  )
    return;
  if (fact.storage && isGoogleCookieFamily(fact.storage.family)) {
    const named = quote.text
      .split(/[^\p{L}\p{N}_-]+/u)
      .includes(fact.storage.family);
    if (
      fact.storage.site === "google.com" &&
      isGoogleCookiePolicy(source.url) &&
      named
    )
      return { quote, proof: quote.text, sources: [quote.source] };
    return;
  }
  const pair = vendorDisclosures(fact, sources).find(
    ({ entry, context }) =>
      entry.id === quote.source || context.id === quote.source,
  );
  if (pair)
    return {
      quote,
      proof: pair.context.excerpt,
      sources: [pair.context.id, pair.entry.id],
    };
  if (source.observation.vendorListing) return;
  const family = fact.storage && documentedFamilies[fact.storage.family];
  const host = fact.request?.targetDomain;
  const knownService =
    family?.term.test(quote.text) ||
    (fact.request?.signature === "meta_pixel_event" &&
      /facebook|\bmeta\b/i.test(quote.text)) ||
    (fact.request?.signature === "permutive_event" &&
      /permutive/i.test(quote.text)) ||
    (fact.request?.signature === "plausible_event" &&
      /plausible/i.test(quote.text));
  const label = host?.split(".")[0];
  const namesHost =
    host &&
    (quote.text.toLowerCase().includes(host) ||
      (label &&
        label.length >= 4 &&
        quote.text
          .toLowerCase()
          .split(/[^\p{L}\p{N}-]+/u)
          .includes(label)));
  if (knownService || namesHost)
    return { quote, proof: quote.text, sources: [quote.source] };
}

function summarize(
  fact: PracticeEvidence,
  candidate: Judgment | undefined,
  sources: Map<string, Evidence>,
): DataPractice {
  const { request, storage } = fact;
  const preference = c15tChoiceDisclosure(fact, sources);
  const analystContext = candidate && policyContext(fact, candidate, sources);
  const documentedUse = documentedCookie(fact, sources);
  const metaDisclosure = metaCookieDisclosure(fact, sources);
  const disclosure =
    documentedUse ??
    metaDisclosure ??
    googleCookieDeclarations(fact, sources)[0];
  const context = preference
    ? {
        quote: { source: preference.id, text: preference.excerpt },
        proof: preference.excerpt,
        sources: [preference.id],
      }
    : (!documentedUse && analystContext) ||
      (disclosure && {
        quote: { source: disclosure.source.id, text: disclosure.text },
        proof: disclosure.text,
        sources: [disclosure.source.id],
      });
  const proof = context?.proof ?? "";
  const googleCookie = storage && isGoogleCookieFamily(storage.family);
  const documented = storage && documentedFamilies[storage.family];
  const qualifiedContext = Boolean(
    context &&
    !googleCookie &&
    !metaDisclosure &&
    !/\b(?:not|never|neither|without|no longer|nicht|nie|keine?[nrs]?)\b/i.test(
      proof,
    ),
  );
  const supportedPurpose =
    candidate &&
    qualifiedContext &&
    purposeWords[candidate.purpose].test(proof);
  const purpose = preference
    ? "consent"
    : supportedPurpose
      ? candidate.purpose
      : request?.signature === "meta_pixel_event"
        ? "advertising"
        : request?.signature === "plausible_event"
          ? "analytics"
          : (documented?.purpose ?? "unknown");
  // Only an explicit role attributable to this practice can establish
  // independent processing, a processor, or the site operator as controller.
  let role: DataPractice["role"] = "unknown";
  if (candidate && qualifiedContext) {
    if (
      candidate.role === "independent" &&
      /independent|own purposes|eigen(?:en?|er) (?:zweck|verantwort)|(?:separat|eigenständig).{0,15}verantwort|selbst.{0,15}verantwort/i.test(
        proof,
      )
    )
      role = "independent";
    if (
      role === "unknown" &&
      (candidate.role === "service_controller" ||
        candidate.role === "independent") &&
      context!.sources.length === 2 &&
      /(?:Art\.?\s*4\s*(?:Nr\.?\s*7|\(7\)).{0,90}jeweiligen Dienst.{0,75}verantwortlich|controllers? (?:for|of) (?:processing (?:by|through) )?their (?:respective|own) services?)/i.test(
        proof,
      )
    )
      role = "service_controller";
    if (
      candidate.role === "processor" &&
      /on (?:our|its) (?:behalf|instructions)|process(?:or|es on behalf)|auftragsverarbeit|in unserem auftrag/i.test(
        proof,
      )
    )
      role = "processor";
    if (
      candidate.role === "site_operator" &&
      /self.host|selbst.{0,6}(?:betreib|gehost)|eigenen server|our own servers/i.test(
        proof,
      ) &&
      request?.relation !== "cross_site"
    )
      role = "site_operator";
  }
  if (preference) role = "site_operator";
  const necessity = preference
    ? "proportionate"
    : candidate?.necessity === "proportionate" &&
        supportedPurpose &&
        ["support", "security", "consent"].includes(purpose)
      ? "proportionate"
      : candidate?.necessity === "optional" &&
          supportedPurpose &&
          /optional|consent|einwillig|zustimm|choose|choice|wahl/i.test(proof)
        ? "optional"
        : "unclear";
  const responded = Boolean(request && request.responses > 0);
  const linked = fact.linkage !== "unlinked" && responded && Boolean(storage);
  const operation = linked
    ? "stored_and_transmitted"
    : request
      ? responded
        ? "transmitted"
        : "attempted"
      : storage
        ? "stored"
        : "observed_visit";
  const dataClass =
    storage?.family === "Chatwoot conversation"
      ? "conversation_id"
      : purpose === "consent" && storage
        ? "preference"
        : request?.fieldCategories.includes("email_address_value")
          ? "contact_details"
          : (linked && storage?.lifetime === "persistent") ||
              (storage?.lifetime === "persistent" &&
                (storage.family === "Permutive visitor ID" ||
                  ["_fbp", "_fbc", "_ga", "_ga_*", "_gid"].includes(
                    storage.family,
                  )))
            ? "persistent_browser_id"
            : request?.fieldCategories.includes("identifier") ||
                request?.fieldCategories.includes("advertising_id")
              ? "opaque_id"
              : request?.fieldCategories.some((v) =>
                    ["page_url", "event_name", "referrer_url"].includes(v),
                  )
                ? "page_activity"
                : request?.fieldCategories.some((v) =>
                      ["screen_size", "language"].includes(v),
                    )
                  ? "device_information"
                  : "other";
  const phase = {
    before_choice: "Before a consent choice",
    after_reject: "After rejecting optional consent",
    after_accept: "After accepting optional consent",
    unknown: "During the browser visit",
  }[fact.trigger];
  const onPage = fact.page === "homepage" ? "the homepage" : "a sampled page";
  const control = fact.trigger;
  const dataWords = {
    preference: "a preference",
    conversation_id: "a conversation identifier",
    persistent_browser_id: "a persistent browser identifier",
    account_id: "an account identifier",
    contact_details: "an email-shaped value in an email field",
    page_activity: "page or event information",
    device_information: "device information",
    opaque_id: "an identifier",
    other: "request metadata",
  }[dataClass];
  const cookieGroup =
    storage?.family === "Unclassified cookie" && storage.count
      ? `${phase}, the browser held ${storage.count} ${storage.lifetime === "persistent" ? "persistent " : storage.lifetime === "session" ? "session " : ""}${storage.count === 1 ? "cookie" : "cookies"}${storage.site ? " scoped to " + storage.site : ""} on ${onPage}.`
      : undefined;
  const summary = linked
    ? fact.linkage === "exact_end_match"
      ? `${phase}, ${request!.targetDomain} received an identifier also present in this browser’s storage at the end of the visit.`
      : `${phase}, the same identifier was found in browser storage and in a request answered by ${request!.targetDomain}.`
    : request
      ? responded
        ? `${phase}, ${request.targetDomain} received a request${dataClass === "other" ? "" : " containing " + dataWords} from the visit to ${onPage}.`
        : `${phase}, the browser tried to send ${dataWords} to ${request.targetDomain} while visiting ${onPage}. Delivery was not confirmed.`
      : storage
        ? (cookieGroup ??
          `${phase}, the browser held ${storage.family.startsWith("Unclassified") ? "an unclassified item" : "an item matching " + storage.family} in ${{ cookie: "its cookies", local_storage: "local storage", session_storage: "session storage" }[storage.mechanism]} on ${onPage}.`)
        : `${phase}, the browser ended its visit to ${onPage} without outside requests, cookies or web storage in the recorded checks.`;
  const declaredSection =
    context && sources.get(context.quote.source)?.observation;
  const significance = documentedUse
    ? documentedUse.description
    : metaDisclosure
      ? `Meta describes ${metaDisclosure.family} as a browser security cookie. This visit establishes its presence in storage.`
      : googleCookie && declaredSection?.type === "policy_section"
        ? `Google discusses ${storage.family} under “${declaredSection.heading.slice(0, 100)}” in its cookie policy. Its use on this visit remains unknown.`
        : purpose === "support" && storage
          ? "A conversation identifier can keep a support thread together across visits."
          : linked &&
              purpose === "advertising" &&
              fact.linkage === "exact_end_match"
            ? "The observed event and this browser item use the same identifier. The order of the storage write and the request is unknown."
            : linked && purpose === "advertising"
              ? "The advertising endpoint received an identifier already present in this browser, so it can associate the request with that identifier."
              : responded &&
                  request?.fieldCategories.includes("event_name") &&
                  (request.signature === "permutive_event" ||
                    request.signature === "meta_pixel_event") &&
                  (request.fieldCategories.includes("identifier") ||
                    request.fieldCategories.includes("advertising_id"))
                ? "Events sent with the same identifier can be associated with one another."
                : role === "independent"
                  ? "The cited policy describes a recipient making its own processing decisions."
                  : purpose === "analytics"
                    ? "The evidence is consistent with measuring activity on the site."
                    : purpose === "consent"
                      ? "This storage pattern is consistent with remembering a privacy choice."
                      : purpose === "security"
                        ? "This storage pattern is associated with an access or security check."
                        : dataClass === "contact_details"
                          ? "An email-shaped value can identify a person. The measurement does not establish whose address it was."
                          : fact.observed === "empty_visit"
                            ? "This describes the measured page in this scenario."
                            : storage?.lifetime === "persistent"
                              ? "This browser item can remain available on a later visit."
                              : request && responded
                                ? "The response confirms a connection to the destination."
                                : "The observation alone establishes limited information about how the site uses the data.";
  const unknowns: string[] = [];
  if (storage)
    unknowns.push(
      "The exact time and script that wrote this item are unknown.",
    );
  if (request && !linked && dataClass === "opaque_id")
    unknowns.push(
      "The measurement does not connect the request identifier to a particular stored value.",
    );
  if (request && (!request.initiator || request.initiator === "unknown"))
    unknowns.push("The initiating frame or script was not identified.");
  if (documentedUse)
    unknowns.push(
      "The capture did not link the stored cookie to a specific request or establish how it was used on this visit.",
    );
  else if (purpose === "unknown" && fact.observed !== "empty_visit")
    unknowns.push("The purpose remains unknown.");
  const mismatch =
    candidate?.possibleConsentConflict &&
    qualifiedContext &&
    fact.trigger === "after_reject" &&
    responded &&
    purpose === "advertising" &&
    /only (?:after|if|with)|erst (?:nach|wenn)|nur (?:nach|mit|wenn)/i.test(
      proof,
    )
      ? "The cited policy conditions this activity on consent. The browser recorded the related request after rejection."
      : null;
  const usedJudgment = preference
    ? Boolean(
        candidate?.purpose === "consent" &&
        candidate.role === "site_operator" &&
        candidate.necessity === "proportionate" &&
        candidate.context?.source === preference.id &&
        preference.excerpt.includes(candidate.context.text),
      )
    : Boolean(candidate && (!candidate.context || analystContext));
  return dataPractice.parse({
    factId: fact.factId,
    scenario: fact.scenario,
    dataClass,
    operation,
    recipient: request?.targetDomain ?? null,
    role,
    purpose,
    ...(documentedUse && {
      declaredPurpose:
        documentedUse.use === "browser_recognition"
          ? "security"
          : documentedUse.use === "signed_out_ads"
            ? "advertising"
            : documentedUse.use,
    }),
    necessity,
    persistence: storage?.lifetime ?? "unknown",
    scope:
      request?.relation ??
      (storage?.scope === "outside_site"
        ? "cross_site"
        : (storage?.scope ?? "unknown")),
    control,
    trigger: phase,
    confidence: preference
      ? "moderate"
      : googleCookie
        ? "low"
        : usedJudgment &&
            (context ||
              fact.observed === "empty_visit" ||
              linked ||
              (responded && request?.signature))
          ? candidate!.confidence
          : "low",
    interpretation: usedJudgment
      ? "analyst_reviewed"
      : preference || context
        ? "source_matched"
        : "observed_only",
    linkedIdentifier: linked,
    summary,
    significance,
    unknowns,
    mismatch,
    evidence: {
      behavior: fact.evidenceIds,
      context: context?.sources ?? [],
      link: linked ? fact.evidenceIds : [],
    },
    ...(context && { contextQuote: context.quote }),
  });
}

export function publishDataPractices(
  report: Pick<ScanReport, "id" | "evidence">,
  candidates: Judgment[] = [],
) {
  const bundle = buildPracticeEvidenceBundle(report);
  const sources = new Map(
    report.evidence.filter((s) => s.scanId === report.id).map((s) => [s.id, s]),
  );
  const judgments = new Map(candidates.map((x) => [x.factId, x]));
  const ranked = [...bundle.practices].sort(
    (a, b) => priority(b) - priority(a),
  );
  const dataPractices = ranked
    .slice(0, 96)
    .map((f) => summarize(f, judgments.get(f.factId), sources));
  return {
    dataPractices,
    practiceCoverage: {
      facts: bundle.practices.length,
      retained: dataPractices.length,
      analystReviewed: dataPractices.filter(
        (x) => x.interpretation === "analyst_reviewed",
      ).length,
      truncated: bundle.truncated || ranked.length > dataPractices.length,
    },
  };
}
function priority(f: PracticeEvidence) {
  return (
    (f.linkage !== "unlinked" ? 100 : 0) +
    (f.request?.responses && f.request.relation === "cross_site" ? 20 : 0) +
    (f.storage?.family === "Chatwoot conversation" ? 12 : 0) +
    (f.request?.signature ? 10 : 0) +
    (f.request?.responses &&
    f.request?.fieldCategories.includes("event_name") &&
    (f.request.fieldCategories.includes("identifier") ||
      f.request.fieldCategories.includes("advertising_id"))
      ? 12
      : 0) +
    (f.observed === "empty_visit" ? 6 : 0)
  );
}
export function practicesForAnalysis(evidence: readonly Evidence[]) {
  const bundle = practiceBundle(evidence);
  const ranked = [...bundle.practices].sort(
    (a, b) => priority(b) - priority(a),
  );
  return (["default", "rejected", "accepted"] as const).flatMap((s) => {
    const distinct: PracticeEvidence[] = [],
      repeated: PracticeEvidence[] = [];
    const seen = new Set<string>();
    for (const fact of ranked.filter((f) => f.scenario === s)) {
      const r = fact.request,
        cookie = fact.storage;
      // Examine different data practices before spending the remaining budget
      // on repetitions of the same signal across sampled pages.
      const shape = JSON.stringify([
        fact.observed,
        fact.trigger,
        fact.linkage,
        r && [
          r.targetDomain,
          r.phase,
          r.signature,
          r.initiator,
          r.relation,
          r.scheme,
          r.method,
          r.fieldCategories,
          r.responses > 0,
        ],
        cookie && [
          cookie.family,
          cookie.mechanism,
          cookie.scope,
          cookie.site,
          cookie.lifetime,
          cookie.expiry,
          cookie.snapshot,
        ],
      ]);
      (seen.has(shape) ? repeated : distinct).push(fact);
      seen.add(shape);
    }
    return [...distinct, ...repeated].slice(0, 10);
  });
}
