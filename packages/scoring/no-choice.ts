import type {
  ConsentCoverage,
  Evidence,
  PublishedScoring,
  ScanReport,
} from "@datadeal/contracts";
import {
  isReportOrigin,
  measuredContentPage,
} from "@datadeal/contracts/content-page";
import { practiceRubric } from "./contextual";

function lookedForBothChoices(coverage?: ConsentCoverage) {
  return (
    coverage?.default === "measured" &&
    coverage.accepted === "control_unavailable" &&
    coverage.rejected === "control_unavailable"
  );
}

function quietPage(source?: Evidence) {
  const visit = source?.observation;
  if (
    visit?.type !== "browser_consent_counts" &&
    visit?.type !== "browser_content_page"
  )
    return false;
  const end = visit.storageSummary?.end;
  return (
    visit.freshContext &&
    visit.finalPageKnown &&
    !visit.afterChoice &&
    visit.requests > 0 &&
    visit.requestInspection?.examined === visit.requests &&
    !visit.requestInspection.limitReached &&
    visit.requestInspection.matched === 0 &&
    !visit.externalDomains.length &&
    !visit.responseDomains?.length &&
    !visit.cookies &&
    end?.cookies.total === 0 &&
    end.cookies.inspected === 0 &&
    visit.storage?.localEntries === 0 &&
    visit.storage.sessionEntries === 0 &&
    end.web?.local.total === 0 &&
    end.web.session.total === 0
  );
}

// Require the policy to speak about visitors to this particular site. A
// software vendor's claim about its customers' sites has a different scope.
function visitorDisclosure(report: ScanReport) {
  const host = report.domain.replace(/^www\./, "").replaceAll(".", "\\.");
  const site = `(?:(?:www\\.)?${host}|(?:our|this) (?:website|site))`;
  const scope = `(?:for (?:visitors to ${site}|(?:www\\.)?${host} visitors)|when you (?:visit|browse) ${site})`;
  const negative = "(?:do not|don['’]t|never)";
  const cookies = `${negative} (?:use|set|store) (?:any )?cookies`;
  const personal = `${negative} collect (?:any )?personal (?:data|information)(?: (?:from|about) (?:our )?(?:website )?visitors)?`;
  // Accept either order and adjacent sentences. Matching complete clauses keeps
  // qualifications such as "unless you accept" outside the accepted grammar.
  const join = "(?:,? and (?:we )?|[.!]\\s+we )";
  const statement = new RegExp(
    `(?:^|[.!?:\\n]\\s*)(${scope},? we (?:${cookies}${join}${personal}|${personal}${join}${cookies})[.!])`,
    "i",
  );
  for (const row of report.evidence) {
    const url = row.url && URL.parse(row.url);
    if (
      row.scanId !== report.id ||
      row.kind !== "declared_first_party" ||
      !url ||
      !isReportOrigin(url.origin, report.domain) ||
      !/privacy|datenschutz/i.test(url.pathname)
    )
      continue;
    const quote = statement.exec(row.excerpt)?.[1];
    if (quote) return { policyId: row.id, quote };
  }
}

export function noChoiceEvidence(
  report: ScanReport,
  rating: PublishedScoring,
  homepage?: Evidence,
) {
  const pages = report.pageSample?.pages;
  if (
    report.partial ||
    report.demo ||
    !homepage ||
    !pages?.length ||
    !lookedForBothChoices(report.consentCoverage) ||
    report.practiceCoverage?.truncated !== false ||
    report.evidence.some(
      (e) =>
        e.scanId === report.id &&
        e.observation?.type === "response_cookie_attributes" &&
        e.observation.count > 0,
    )
  )
    return;
  const visitIds = [homepage.id];
  const urls = new Set([homepage.url]);
  if (!quietPage(homepage)) return;
  for (const [index, page] of pages.entries()) {
    const run = measuredContentPage(report, index, "default");
    if (
      !lookedForBothChoices(page.coverage) ||
      !run ||
      !quietPage(run.source) ||
      run.landed.pathname !== new URL(page.url).pathname ||
      urls.has(run.source.url)
    )
      return;
    visitIds.push(run.source.id);
    urls.add(run.source.url);
  }
  const ratings = rating.practiceAssessment?.ratings;
  if (
    ratings?.length !== visitIds.length ||
    !visitIds.every((id) =>
      ratings.some(
        (r) =>
          r.score === practiceRubric.quietVisit.default &&
          r.evidenceIds.includes(id),
      ),
    ) ||
    !visitIds.every((id) =>
      report.dataPractices?.some(
        (p) =>
          p.operation === "observed_visit" &&
          p.scenario === "default" &&
          p.interpretation === "analyst_reviewed" &&
          p.evidence.behavior.includes(id),
      ),
    )
  )
    return;
  const policy = visitorDisclosure(report);
  return policy && { ...policy, visitIds };
}
