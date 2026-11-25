import type { DataPractice, ScanReport } from "@datadeal/contracts";
import type { PracticeEvidence } from "@datadeal/contracts/practice-evidence";
import { vendorDisclosures } from "@datadeal/contracts/vendor-listing";
import { measuredPracticeFacts, practiceEvidenceText } from "./content-pages";

function visitorImpact(fact: PracticeEvidence) {
  const r = fact.request;
  if (!r) return;
  const fields = r.fieldCategories;
  const external = r.relation === "cross_site";
  if (external && fields.includes("email_address_value"))
    return {
      priority: 5,
      data: "an email-shaped value in an email field",
      meaning: "An email address can identify a person directly.",
    };
  if (external && fact.linkage !== "unlinked")
    return {
      priority: 6,
      data:
        fact.linkage === "exact_end_match"
          ? "an identifier also found in this browser’s storage at the end of the visit"
          : "the same identifier held in this browser’s storage",
      meaning: "That identifier can tie activity to the same browser.",
    };
  if (
    external &&
    (r.signature === "permutive_event" || r.signature === "meta_pixel_event") &&
    fields.includes("event_name") &&
    (fields.includes("identifier") || fields.includes("advertising_id"))
  )
    return {
      priority: 4,
      data: "an event name together with an identifier",
      meaning: "Events carrying that ID can be grouped together.",
    };
  if (r.signature === "plausible_event" && fields.includes("page_url"))
    return {
      priority: 3,
      data: "a page URL in a Plausible-compatible analytics request",
      meaning: external
        ? "This exposes which page was visited to another site."
        : "The analytics request stayed within this site’s domain.",
    };
  if (
    external &&
    (fields.includes("identifier") || fields.includes("advertising_id"))
  )
    return {
      priority: 2,
      data: "a request with an identifier field",
      meaning:
        "The capture does not establish how long the identifier lasts or whether it matches a cookie.",
    };
}

export function visitorPractice(
  report: ScanReport | undefined,
  scenario: DataPractice["scenario"],
) {
  if (!report) return;
  const sources = new Map(report.evidence.map((s) => [s.id, s]));
  const practices = new Map(report.dataPractices?.map((p) => [p.factId, p]));
  const rows = measuredPracticeFacts(report)
    .filter(
      (fact) =>
        fact.scenario === scenario &&
        fact.trigger ===
          (
            {
              accepted: "after_accept",
              rejected: "after_reject",
              default: "before_choice",
            } as const
          )[scenario],
    )
    .flatMap((fact) => {
      const impact = visitorImpact(fact);
      if (!impact || !fact.request || fact.trigger === "unknown") return [];
      const practice = practices.get(fact.factId);
      const disclosure =
        practice?.purpose === "advertising" &&
        practice.necessity === "optional" &&
        practice.interpretation === "analyst_reviewed" &&
        practice.confidence !== "low" &&
        vendorDisclosures(fact, sources).find(
          ({ entry, context }) =>
            /consent|einwillig|zustimm/i.test(context.excerpt) &&
            practice.evidence.context.includes(entry.id) &&
            practice.evidence.context.includes(context.id),
        );
      return [{ fact, request: fact.request, impact, disclosure }];
    })
    .sort(
      (a, b) =>
        Number(b.request.responses > 0) - Number(a.request.responses > 0) ||
        b.impact.priority - a.impact.priority ||
        Number(Boolean(b.disclosure)) - Number(Boolean(a.disclosure)) ||
        Number(b.fact.scenario === scenario) -
          Number(a.fact.scenario === scenario) ||
        Number(b.fact.page === "homepage") - Number(a.fact.page === "homepage"),
    );
  const lead = rows[0];
  if (!lead) return;
  const { fact, request, impact } = lead;
  const timing = {
    before_choice: "Before a consent choice",
    after_accept: "After accepting optional cookies",
    after_reject: "After rejecting optional cookies",
    unknown: "During the visit",
  }[fact.trigger];
  const recipient = request.targetDomain;
  const pair = lead.disclosure;
  const advertisedPurpose = pair && {
    text: `The privacy policy lists the provider behind ${recipient} among its advertising partners when you give consent.`,
    sources: [
      {
        source: pair.context.id,
        label: "When the site uses these advertising services",
        quote: pair.context.excerpt,
      },
      {
        source: pair.entry.id,
        label: "Named provider in the policy",
        quote: pair.entry.excerpt,
      },
    ],
  };
  const where =
    fact.page === "sampled_page" ? " on a sampled page" : " on the homepage";
  const summary =
    request.responses > 0
      ? `${timing}${where}, ${recipient} received ${impact.data}.`
      : `${timing}${where}, the browser tried to send ${impact.data} to ${recipient}.`;
  // A request group proves its own fields. A storage match also needs the visit snapshot.
  const ids =
    fact.linkage !== "unlinked"
      ? [...fact.evidenceIds].reverse()
      : fact.evidenceIds.slice(-1);
  return {
    factId: fact.factId,
    summary,
    significance:
      request.responses > 0 ? impact.meaning : "Delivery was not confirmed.",
    evidenceIds: ids,
    policy: advertisedPurpose || undefined,
    sources: ids.map((source) => ({
      source,
      label:
        source === ids[0]
          ? "Measured request evidence"
          : "Browser storage evidence",
      quote: practiceEvidenceText(fact, source),
    })),
  };
}
