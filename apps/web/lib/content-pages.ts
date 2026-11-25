import {
  maxContentPages,
  type ConsentOutcome,
  type Evidence,
  type ScanReport,
} from "@datadeal/contracts";
import {
  measuredContentPage,
  measuredContentVisits,
} from "@datadeal/contracts/content-page";
import {
  buildPracticeEvidenceBundle,
  type PracticeEvidence,
} from "@datadeal/contracts/practice-evidence";
import { contentPageScoringFields } from "@datadeal/scoring";
import { requestEvidenceExcerpt } from "./request-findings";
import { storageEvidence } from "./storage-evidence";

const scenarios = ["default", "rejected", "accepted"] as const;
export const pageScenarioLabels = {
  default: "Default visit",
  rejected: "Reject visit",
  accepted: "Accept visit",
};

export function domainCount(count: number) {
  return (
    (count === 20 ? "20+" : count) +
    (count === 1 ? " outside domain" : " outside domains")
  );
}

export function contentPageEvidenceTitle(source: Evidence) {
  if (
    source.kind !== "observed_technical" ||
    !source.consentScenario ||
    !source.url
  )
    return;
  const indexed = /^browser-page-([1-9]\d*)-(default|rejected|accepted)$/.exec(
    source.id,
  );
  if (
    source.observation?.type !== "browser_content_page" &&
    (!indexed ||
      Number(indexed[1]) > maxContentPages ||
      indexed[2] !== source.consentScenario)
  )
    return;
  return (
    pageScenarioLabels[source.consentScenario] +
    " · " +
    new URL(source.url).pathname
  );
}

export function contentPageExcerpt(
  source: Evidence,
  practiceFacts?: ReadonlySet<string>,
) {
  const visit = source.observation;
  if (visit?.type !== "browser_content_page") return;
  if (practiceFacts?.size) return [...practiceFacts].join("\n\n");
  const outside = visit.externalDomains;
  const names = outside.slice(0, 3);
  const named = names.length ? " These included " + names.join(", ") + "." : "";
  const responses = visit.responseDomains
    ? " HTTP responses were observed from " +
      domainCount(visit.responseDomains.length) +
      "."
    : "";
  const choice = visit.afterChoice
    ? " After the consent choice, it attempted " +
      visit.afterChoice.requests +
      " requests in total and tried to reach " +
      domainCount(visit.afterChoice.externalDomains.length) +
      "."
    : "";
  const scenario = source.consentScenario;
  const identifierEvidence = scenario
    ? contentPageScoringFields(source)
        .map((group) => " " + requestEvidenceExcerpt(group, scenario))
        .join("")
    : "";
  return (
    "During this visit the browser attempted " +
    visit.requests +
    " requests, including attempts to " +
    domainCount(outside.length) +
    "." +
    named +
    responses +
    choice +
    " The visit ended with " +
    visit.cookies +
    (visit.cookies === 1 ? " cookie." : " cookies.") +
    identifierEvidence +
    (visit.storageSummary ? " " + storageEvidence(source) : "")
  );
}

/** Only a confirmed capture can supply a measurement for a practice citation. */
export function measuredPracticeFacts(report: ScanReport) {
  const sampled = new Set(
    Array.from(measuredContentVisits(report), (run) => run.source.id),
  );
  return buildPracticeEvidenceBundle(report).practices.filter((fact) =>
    fact.page === "sampled_page"
      ? sampled.has(fact.evidenceIds[0]!)
      : report.consentCoverage?.[fact.scenario] === "measured",
  );
}

export function practiceEvidenceText(fact: PracticeEvidence, sourceId: string) {
  if (!fact.evidenceIds.includes(sourceId)) return;
  const { request, storage } = fact;
  const parts: string[] = [];
  const visitSource = fact.evidenceIds[0] === sourceId;
  const requestSource = request && fact.evidenceIds.at(-1) === sourceId;
  if (request && requestSource) {
    parts.push(
      requestEvidenceExcerpt(
        { type: "browser_request_fields", ...request },
        fact.scenario,
      ),
    );
    if (fact.linkage !== "unlinked" && storage) {
      parts.push(
        `A request field matched the value of ${storage.family} sampled in ${storage.mechanism === "cookie" ? "cookies" : storage.mechanism.replace("_", " ")} ${fact.linkage === "exact_end_match" ? "at the end of this visit. The order of the write and the request is unknown" : "earlier in this visit"}. The identifier value was not retained.`,
      );
    }
  }
  if (storage && visitSource) {
    const timing =
      storage.snapshot === "before_choice"
        ? "Immediately before the consent choice"
        : "At the end of the visit";
    const mechanism =
      storage.mechanism === "cookie"
        ? "cookies"
        : storage.mechanism.replace("_", " ");
    parts.push(
      `${timing}, the browser contained ${storage.family} in ${mechanism}.`,
    );
  }
  if (fact.observed === "empty_visit" && visitSource)
    parts.push(
      "The default visit recorded no outside requests and ended with zero cookies and no local or session storage entries.",
    );
  return parts.length ? parts.join(" ") : undefined;
}

export function citedPracticeExcerpts(
  report: ScanReport,
  factIds: Iterable<string>,
) {
  const selected = new Set(factIds);
  const excerpts = new Map<string, Set<string>>();
  if (selected.size) {
    for (const fact of measuredPracticeFacts(report)) {
      if (!selected.has(fact.factId)) continue;
      for (const id of fact.evidenceIds) {
        const text = practiceEvidenceText(fact, id);
        if (!text) continue;
        if (!excerpts.has(id)) excerpts.set(id, new Set());
        excerpts.get(id)!.add(text);
      }
    }
  }
  return excerpts;
}

export function publicContentPageSample(report?: ScanReport) {
  const sample = report?.pageSample;
  if (!report || !sample) return;
  const pages = sample.pages.map((page, index) => {
    const selected = new URL(page.url);
    const visits = scenarios.map((scenario) => {
      const run = measuredContentPage(report, index, scenario);
      const outcome: ConsentOutcome = page.coverage[scenario];
      const measurement = run
        ? {
            id: run.source.id,
            finalPath: run.landed.pathname,
            outside: run.visit.externalDomains.length,
            examples: run.visit.externalDomains.slice(0, 3),
            requests: run.visit.requests,
            afterChoiceOutside: run.visit.afterChoice?.externalDomains.length,
          }
        : undefined;
      return { scenario, outcome, measurement };
    });
    return { path: selected.pathname, source: page.source, visits };
  });
  return {
    discovered: sample.discovered,
    discoveryLimited: sample.discoveryLimited,
    limit: sample.limit,
    pages,
  };
}
export type PublicContentPageSample = NonNullable<
  ReturnType<typeof publicContentPageSample>
>;
