import {
  browserRequestFields,
  policySummarySentence,
  type Evidence,
  type ScanReport,
} from "@datadeal/contracts";
import {
  publicProviderDisclosures,
  publicRequestFindings,
  requestEvidenceExcerpt,
  selfHostedAnalyticsDisclosure,
} from "./request-findings";
import { isPolicyDocument } from "./report-documents";
import { inspectionSummary } from "./browser-summary";
import { googleAnalyticsVisit } from "./google-analytics-visit";
import { storageEvidence } from "./storage-evidence";
import {
  citedPracticeExcerpts,
  contentPageExcerpt,
  publicContentPageSample,
} from "./content-pages";

/** Keep the complete advanced observations and make the cited facts readable in the source reader. */
export function withPracticeEvidenceExcerpts(
  report: ScanReport,
  factIds: Iterable<string>,
): ScanReport {
  const excerpts = citedPracticeExcerpts(report, factIds);
  const analytics = googleAnalyticsVisit(report);
  return {
    ...report,
    evidence: report.evidence.map((source) => {
      const facts =
        source.scanId === report.id ? excerpts.get(source.id) : undefined;
      const detail =
        analytics?.source === source.id &&
        source.scanId === report.id &&
        analytics.quote;
      return facts || detail
        ? {
            ...source,
            excerpt: [detail, ...(facts ?? []), source.excerpt]
              .filter(Boolean)
              .join("\n\n"),
          }
        : source;
    }),
  };
}

export function publicReportEvidence(
  report: ScanReport,
  cited: Iterable<string>,
  citedFactIds: Iterable<string> = [],
): Evidence[] {
  const facts = citedPracticeExcerpts(report, citedFactIds);
  const googleAnalytics = googleAnalyticsVisit(report);
  const evidence = report.evidence.filter(
    (source) => source.scanId === report.id,
  );
  const selected = new Set(cited);
  const contentVisits = new Set<string>();
  for (const page of publicContentPageSample(report)?.pages ?? [])
    for (const { measurement } of page.visits)
      if (measurement) contentVisits.add(measurement.id);
  const analytics = selfHostedAnalyticsDisclosure(report);
  if (analytics) selected.add(analytics.evidenceId);
  for (const finding of publicRequestFindings(report))
    selected.add(finding.evidenceId);
  for (const row of publicProviderDisclosures(report)) {
    selected.add(row.evidenceId);
    selected.add(row.referringEvidenceId);
  }
  const documents = new Map<string, Evidence>();
  const fallback = new Map<string, Evidence>();
  const documentKinds = new Map(
    evidence.flatMap((source) =>
      source.kind === "declared_first_party" &&
      source.url &&
      source.documentKind
        ? [[source.url, source.documentKind] as const]
        : [],
    ),
  );
  for (const source of evidence) {
    if (source.observation?.type === "processing_document") {
      selected.add(source.id);
      continue;
    }
    if (source.kind !== "declared_first_party") continue;
    const section =
      source.observation?.type === "policy_section"
        ? source.observation
        : undefined;
    const documentKind =
      source.documentKind ??
      (source.url ? documentKinds.get(source.url) : undefined);
    if (source.url && isPolicyDocument({ ...source, documentKind })) {
      if (source.documentLayout?.length) selected.add(source.id);
      const current = documents.get(source.url);
      if (
        !current ||
        (section && current.observation?.type !== "policy_section")
      )
        documents.set(source.url, source);
    }
    if (!section || !section.topic || !policySummarySentence(source, report.id))
      continue;
    if (
      !fallback.has(section.topic) ||
      source.id === report.preferredPolicyEvidenceId
    )
      fallback.set(section.topic, source);
  }
  for (const source of fallback.values()) selected.add(source.id);
  for (const source of documents.values()) selected.add(source.id);

  return evidence.flatMap((source) => {
    const observation = source.observation;
    const visit =
      observation?.type === "browser_consent_counts" ? observation : undefined;
    if (observation?.type === "browser_content_page") {
      if (!selected.has(source.id) || !contentVisits.has(source.id)) return [];
    } else if (
      !(visit && source.consentScenario === "default") &&
      !selected.has(source.id)
    )
      return [];
    const visitUrl =
      observation?.type === "browser_content_page" && source.url
        ? new URL(source.url)
        : undefined;
    return [
      {
        id: source.id,
        scanId: source.scanId,
        kind: source.kind,
        documentKind:
          source.documentKind ??
          (source.kind === "declared_first_party" && source.url
            ? documentKinds.get(source.url)
            : undefined),
        language: source.language,
        ...(source.documentLayout?.length && {
          documentLayout: source.documentLayout,
        }),
        url:
          observation?.type === "browser_request_fields" && source.url
            ? new URL(source.url).origin
            : visitUrl
              ? visitUrl.origin + visitUrl.pathname
              : source.url,
        retrievedAt: source.retrievedAt,
        consentScenario: source.consentScenario,
        excerpt: visit
          ? `This visit attempted ${visit.requests} requests and ended with ${visit.cookies} cookies.` +
            (visit.externalDomains.length === 0
              ? " No requests to outside domains were observed."
              : ` The scanner recorded attempts to ${visit.externalDomains.length} outside domains.`) +
            (visit.storage
              ? ` The page origin held ${visit.storage.localEntries} local storage and ${visit.storage.sessionEntries} session storage entries.`
              : " Storage was not measured.") +
            (source.url
              ? ` The visit ${visit.finalPageKnown ? "ended" : "started"} at ${source.url}.`
              : "") +
            " " +
            [
              googleAnalytics?.source === source.id && googleAnalytics.quote,
              inspectionSummary(visit.requestInspection),
              storageEvidence(source),
              ...(facts.get(source.id) ?? []),
            ]
              .filter(Boolean)
              .join(" ")
          : observation?.type === "browser_request_fields" &&
              source.consentScenario
            ? [
                ...(facts.get(source.id) ?? [
                  requestEvidenceExcerpt(observation, source.consentScenario),
                ]),
              ].join("\n\n")
            : (contentPageExcerpt(source, facts.get(source.id)) ??
              source.excerpt),
        observation:
          observation?.type === "processing_document"
            ? observation
            : observation?.type === "policy_section"
              ? {
                  type: observation.type,
                  topic: observation.topic,
                  heading: observation.heading,
                }
              : observation?.type === "browser_request_fields"
                ? browserRequestFields.parse(observation)
                : observation?.type === "provider_policy"
                  ? {
                      type: observation.type,
                      providerHost: observation.providerHost,
                      heading: observation.heading,
                      referringEvidenceId: observation.referringEvidenceId,
                    }
                  : undefined,
      },
    ];
  });
}
