import {
  evaluate,
  evaluateHeadline,
  verifiedAcceptAllRating,
  verifiedRejectRating,
} from "@datadeal/scoring";
import { domainLookup, policySummarySentence } from "@datadeal/contracts";
import { lookup } from "./reports";
import { publicPolicyHighlights } from "./policy-highlights";
import { practiceTakeaways } from "./practice-takeaways";
import { visitorPractice } from "./visitor-practice";
import { visitorSummary } from "./visitor-summary";
import { isPolicyDocument } from "./report-documents";
import { isPublicWarning } from "./public-warnings";
import { defaultVisitEvidence, summarizeDefaultVisit } from "./browser-summary";
import { publicContentPageSample } from "./content-pages";
import { publicContentPageDifference } from "./content-page-difference";
import { acceptedExposureSummary } from "./accepted-exposure";
import {
  compareConsentDestinations,
  consentChoiceTakeaway,
} from "./consent-comparison";
import {
  publicProviderDisclosures,
  publicRequestFindings,
  selfHostedAnalyticsDisclosure,
} from "./request-findings";

export async function publishedReportPayload(host: string) {
  const result = await lookup(host);
  const defaultVisit = defaultVisitEvidence(result.report);
  const observation = defaultVisit?.observation;
  const requestFindings = publicRequestFindings(result.report);
  const analytics = selfHostedAnalyticsDisclosure(result.report);
  const providerDisclosures = publicProviderDisclosures(result.report);
  const browserSummary =
    observation?.type === "browser_consent_counts"
      ? summarizeDefaultVisit({
          outside: observation.externalDomains.length,
          noCookies: observation.cookies === 0,
          noStorage:
            observation.storage?.localEntries === 0 &&
            observation.storage.sessionEntries === 0,
        })
      : undefined;
  const defaultBrowserObserved = browserSummary !== undefined;
  const hasPolicy =
    result.report?.evidence.some(
      (row) =>
        row.scanId === result.report?.id &&
        row.kind === "declared_first_party" &&
        isPolicyDocument(row),
    ) ||
    result.score?.adjustments.some(({ rule }) => rule === "policy_available");
  const policyOnly =
    result.report &&
    result.score?.score === null &&
    hasPolicy &&
    !defaultBrowserObserved;
  const snapshot = result.report;
  const accepted = snapshot && verifiedAcceptAllRating(snapshot);
  const rejected = snapshot && verifiedRejectRating(snapshot);
  const defaultRating = snapshot ? evaluate(snapshot) : null;
  const headline = snapshot && evaluateHeadline(snapshot);
  const consent = compareConsentDestinations(snapshot);
  const byScenario = { default: defaultRating, accepted, rejected };
  const takeaways = practiceTakeaways(
    snapshot,
    headline?.scenario ?? "default",
    byScenario,
    false,
  );
  const featured = takeaways[0];
  const impact = visitorPractice(snapshot, headline?.scenario ?? "default");
  const contextualWarnings = takeaways.filter(
    (item) =>
      item.mismatch ||
      byScenario[item.scenario]?.practiceAssessment?.ratings.some(
        (row) =>
          row.factId === item.factId && row.score != null && row.score < 40,
      ),
  );
  const warningRows = [result.score, defaultRating, accepted, rejected].flatMap(
    (rating) => rating?.adjustments.filter(isPublicWarning) ?? [],
  );
  const warnings = [
    ...new Map(
      warningRows.map((row) => [[row.rule, ...row.evidenceIds].join("/"), row]),
    ).values(),
  ];
  const evidenceIds = new Set(
    snapshot?.evidence
      .filter((item) => item.scanId === snapshot.id && item.excerpt)
      .map((item) => item.id),
  );
  const warningSources = warnings.map(
    (warning) => warning.evidenceIds.find((id) => evidenceIds.has(id)) ?? null,
  );
  const highlights = snapshot ? publicPolicyHighlights(snapshot) : [];
  if (snapshot && !highlights.length) {
    const topics = new Set<string>();
    const excerpts = snapshot.evidence
      .slice()
      .sort(
        (left, right) =>
          Number(right.id === snapshot.preferredPolicyEvidenceId) -
          Number(left.id === snapshot.preferredPolicyEvidenceId),
      );
    for (const source of excerpts) {
      const quote = policySummarySentence(source, snapshot.id);
      const topic =
        source.observation?.type === "policy_section"
          ? source.observation.topic
          : undefined;
      if (
        !quote ||
        (topic !== "collection" && topic !== "sharing") ||
        topics.has(topic)
      )
        continue;
      const text = `The policy says “${quote}”`;
      if (text.length > 230) continue;
      highlights.push({ source: source.id, topic, text });
      topics.add(topic);
      if (highlights.length === 2) break;
    }
  }
  const summary = highlights.map(({ text }) => text);
  const report =
    result.report && headline
      ? {
          demo: result.report.demo,
          scanId: result.report.demo ? null : result.report.id,
          partial: result.report.partial,
          completedAt: result.report.completedAt,
          score: headline.rating.score,
          grade: headline.rating.grade,
          headlineScenario:
            headline.rating.score != null ? headline.scenario : undefined,
          ...(headline.rating.noChoiceEvidence && {
            noChoiceVisit: true as const,
          }),
          verdict: headline.rating.verdict,
          policyOnly: Boolean(policyOnly),
          visitorSummary: visitorSummary(snapshot).claims.map((c) => ({
            text: c.text,
            evidenceIds: c.sources.map((s) => s.source),
            evidenceLabels: c.sources.map((s) => s.label),
          })),
          browserSummary,
          browserEvidenceId: browserSummary ? defaultVisit?.id : undefined,
          practiceTakeaway: impact
            ? {
                summary: impact.summary,
                significance: impact.policy?.text ?? impact.significance,
                evidenceIds: [
                  ...impact.evidenceIds,
                  ...(impact.policy?.sources.map((s) => s.source) ?? []),
                ],
              }
            : featured && {
                summary: featured.summary,
                significance: featured.significance,
                evidenceIds: featured.citations.map((c) => c.id).slice(0, 16),
              },
          consentTakeaway:
            acceptedExposureSummary(
              defaultRating ?? null,
              accepted,
              new Map(snapshot?.evidence.map((row) => [row.id, row])),
              snapshot?.id,
            ) ?? consentChoiceTakeaway(snapshot, consent),
          contentPageDifference:
            defaultVisit && observation?.type === "browser_consent_counts"
              ? publicContentPageDifference(publicContentPageSample(snapshot), {
                  id: defaultVisit.id,
                  outside: observation.externalDomains.length,
                })
              : undefined,
          requestFindings: requestFindings.length ? requestFindings : undefined,
          analyticsDisclosure: analytics
            ? { text: analytics.text, evidenceId: analytics.evidenceId }
            : undefined,
          providerDisclosures: providerDisclosures.length
            ? providerDisclosures
            : undefined,
          policySummary: summary?.length ? summary.slice(0, 2) : undefined,
          additionalPolicySummary: summary?.[2],
          policyEvidenceId: highlights[0]?.source,
          policyEvidenceIds: summary.length
            ? highlights.slice(0, 3).map(({ source }) => source)
            : undefined,
          methodologyVersion: headline.rating.methodologyVersion,
          confidence: headline.rating.confidence,
          warnings: [
            ...warnings.map((item) => item.title),
            ...contextualWarnings.map((item) => item.mismatch ?? item.summary),
          ],
          warningEvidenceIds:
            warningSources.some(Boolean) || contextualWarnings.length
              ? [
                  ...warningSources,
                  ...contextualWarnings.map((item) => item.citations[0].id),
                ]
              : undefined,
        }
      : null;
  const state = domainLookup.shape.state.safeParse(
    result.history[0]?.state ?? null,
  );
  return {
    domain: result.host,
    state: state.success ? state.data : null,
    report,
  };
}
