"use client";

import Image from "next/image";
import { AdvancedPreview } from "./report-illustrations";
import { ReportIcon } from "./report-icon";
import { ReportCompare } from "./report-compare";
import {
  citationColors,
  documentTitle,
  ReportCitations,
} from "./evidence-dialog";
import { ReportAdvertisement } from "./report-advertisement";
import { RequestScan } from "./request-scan";
import { ConsentTable } from "./consent-table";
import { ScanProgress } from "./scan-progress";
import { ProviderDisclosure } from "../../data-flow/provider-lookup";
import { RewardedAdTest } from "./rewarded-ad-test";
import { useClientReady } from "../../use-client-ready";
import type { publicPolicyHighlights } from "../../../lib/policy-highlights";
import { publicReportEvidence } from "../../../lib/public-report-evidence";
import { isPublicWarning as critical } from "../../../lib/public-warnings";
import {
  type PublicContentPageSample,
  contentPageEvidenceTitle,
} from "../../../lib/content-pages";
import { isPolicyDocument } from "../../../lib/report-documents";
import { ContextFindings } from "./context-findings";
import { HistoryComparison, type ScanComparison } from "./history-comparison";
import type { PracticeTakeaway } from "../../../lib/practice-takeaways";
import { ReportContentPages } from "./report-content-pages";
import type { compareConsentDestinations } from "../../../lib/consent-comparison";
import {
  inspectionSummary,
  summarizeDefaultVisit,
} from "../../../lib/browser-summary";
import {
  publicProviderDisclosures,
  publicRequestFindings,
  selfHostedAnalyticsDisclosure,
} from "../../../lib/request-findings";
import { bundledSiteFavicon } from "../../../lib/site-favicon";
import { ratingGuidance } from "../../../lib/rating-guidance";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Accordion, Avatar, Button, Card, Chip, Spinner } from "@heroui/react";
import { Timeline } from "@heroui-pro/react/timeline";
import { LineChart } from "@heroui-pro/react/line-chart";
import { EmptyState } from "@heroui-pro/react/empty-state";
import {
  isActiveScan,
  states,
  type ConsentOutcome,
  scenarioLabel as ratingLabels,
  noChoiceVisitLabel,
  type DataPractice,
  type PolicyTopic,
  type ScanReport,
  type ScanStage,
} from "@datadeal/contracts";
import type { evaluate } from "@datadeal/scoring";
import { selfHostedPlausible } from "@datadeal/contracts/hosting-disclosure";
import { measuredContentVisits } from "@datadeal/contracts/content-page";

type Score = ReturnType<typeof evaluate>;
type ScoringRules = Pick<
  Score,
  "methodologyVersion" | "rulesRevision" | "baseScore"
>;

function sameScoringRules(left: ScoringRules, right: ScoringRules) {
  return (
    !!left.rulesRevision &&
    left.baseScore === right.baseScore &&
    left.methodologyVersion === right.methodologyVersion &&
    left.rulesRevision === right.rulesRevision
  );
}
type Adjustment = Score["adjustments"][number];
type ReportEvidence = ScanReport["evidence"][number];

type ObservationRow = {
  source: ReportEvidence;
  title: string;
  kind: "Observed" | "Policy" | "Provider policy";
  evidenceLabel: string;
  detail?: string;
  icon?: "contact" | "calendar" | "chart";
  provider?: string;
  quote?: string;
  referringEvidenceId?: string;
};

type SummarySource = { source: string; label: string; quote?: string };
type SummaryClaim = { text: ReactNode; sources?: SummarySource[] };

function SummaryText({ claims }: { claims: SummaryClaim[] }) {
  return (
    <p>
      {claims.map(({ text, sources }, index) => {
        const first = sources?.[0];
        const tone = index % citationColors.length;
        return (
          <span key={index}>
            {index > 0 && " "}
            {first ? (
              <a
                href={"#evidence-" + first.source}
                aria-haspopup="dialog"
                data-citation-tone={tone}
                data-citation-quote={first.quote}
                data-citation-group={
                  sources && sources.length > 1
                    ? JSON.stringify(sources)
                    : undefined
                }
                className={`summary-citation group rounded-sm text-foreground hover:bg-(--cite)/8 focus-visible:bg-(--cite)/8 ${citationColors[tone]}`}
              >
                <span className="underline decoration-(--cite) decoration-1 underline-offset-[0.19em] group-hover:decoration-2 group-focus-visible:decoration-2">
                  {text}
                </span>
                {"\u00a0"}
                <sup
                  aria-hidden="true"
                  className="whitespace-nowrap text-[.69em] font-semibold text-(--cite) [&_svg]:inline-block [&_svg]:size-[1em] [&_svg]:align-[-.08em]"
                >
                  <ReportIcon name="policy" /> {index + 1}
                </sup>
                <span className="sr-only">
                  {" "}
                  {first.label}
                  {sources && sources.length > 1
                    ? `, ${sources.length} supporting sources`
                    : ""}
                </span>
              </a>
            ) : (
              text
            )}
          </span>
        );
      })}
    </p>
  );
}

function ProviderPolicyLink({
  host,
  rows,
}: {
  host: string;
  rows: ObservationRow[];
}) {
  const references: SummarySource[] = rows.map(
    ({ source, evidenceLabel, quote }) => ({
      source: source.id,
      label: evidenceLabel,
      quote,
    }),
  );
  for (const id of new Set(rows.map((row) => row.referringEvidenceId))) {
    if (id) references.push({ source: id, label: "Referring site policy" });
  }
  return (
    <a
      href={"#evidence-" + rows[0]!.source.id}
      data-citation-group={JSON.stringify(references)}
      data-citation-quote={rows[0]!.quote}
      aria-haspopup="dialog"
      aria-label={"Read the provider policy for " + host}
      className="inline-link inline-flex min-h-11 w-fit items-center gap-1.5 wrap-anywhere rounded-md text-sm focus-visible:outline-2 focus-visible:outline-accent"
    >
      {host} provider policy <ReportIcon name="forward" />
    </a>
  );
}

function ReportObservations({ rows }: { rows: ObservationRow[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!rows.length) return null;
  const providers = new Map<string, ObservationRow[]>();
  const findings = rows.filter((row) => !row.provider);
  for (const row of rows) {
    if (row.provider) {
      const entries = providers.get(row.provider) ?? [];
      entries.push(row);
      providers.set(row.provider, entries);
    }
  }
  const providerLinks = Array.from(providers, ([host, entries]) => ({
    host,
    entries,
    // Only place a provider next to a use case if the scan links the sources.
    related: findings.find((finding) =>
      entries.some((entry) => entry.referringEvidenceId === finding.source.id),
    ),
  }));
  return (
    <section className="mt-9" aria-labelledby="report-observations-title">
      <h2
        className="mb-4 text-xl! font-semibold!"
        id="report-observations-title"
      >
        When you use this site
      </h2>
      <div id="report-visitor-findings" className="grid gap-2.5 sm:grid-cols-2">
        {(expanded ? findings : findings.slice(0, 4)).map((finding) => {
          const { source, title, kind, detail, evidenceLabel, quote, icon } =
            finding;
          return (
            <div
              key={source.id + title}
              className="flex min-w-0 flex-col rounded-2xl border border-separator/60 bg-surface"
            >
              <a
                href={"#evidence-" + source.id}
                data-citation-quote={quote}
                aria-haspopup="dialog"
                aria-label={title + " — " + evidenceLabel}
                className="group flex min-w-0 flex-1 flex-col gap-2 rounded-2xl p-4 text-foreground no-underline transition-colors hover:bg-default/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:p-5"
              >
                <span className="flex items-center gap-2 text-xs text-muted">
                  <ReportIcon
                    name={icon ?? (kind === "Observed" ? "glance" : "policy")}
                  />
                  {kind === "Observed" ? "Browser visit" : "Site policy"}
                  <span className="ms-auto text-muted group-hover:text-accent">
                    <ReportIcon name="open" />
                  </span>
                </span>
                <strong className="font-semibold text-base leading-snug">
                  {title}
                </strong>
                {detail && (
                  <span className="text-sm leading-relaxed">{detail}</span>
                )}
              </a>
              {providerLinks
                .filter(({ related }) => related === finding)
                .map(({ host, entries }) => (
                  <div key={host} className="-mt-2 px-4 pb-1 sm:px-5">
                    <ProviderPolicyLink host={host} rows={entries} />
                  </div>
                ))}
            </div>
          );
        })}
      </div>
      {findings.length > 4 && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 flex"
          aria-controls="report-visitor-findings"
          aria-expanded={expanded}
          onPress={() => setExpanded(!expanded)}
        >
          {expanded
            ? "Show fewer findings"
            : findings.length === 5
              ? "Show 1 more finding"
              : `Show ${findings.length - 4} more findings`}
        </Button>
      )}
      {providerLinks
        .filter(({ related }) => !related)
        .map(({ host, entries }) => (
          <div key={host}>
            <ProviderPolicyLink host={host} rows={entries} />
          </div>
        ))}
    </section>
  );
}

function PublicSources({
  evidence,
  privacyDocumentIds,
  title = "Sources",
}: {
  evidence: ReportEvidence[];
  privacyDocumentIds: string[];
  title?: string;
}) {
  const groups = new Map<string, ReportEvidence[]>();
  const other = [];
  for (const source of evidence) {
    if (!isPolicyDocument(source) || !source.url) {
      other.push(source);
      continue;
    }
    const group = groups.get(source.url) ?? [];
    group.push(source);
    groups.set(source.url, group);
  }
  return (
    <>
      {groups.size > 0 && (
        <Section title={title}>
          {[...groups.values()].map((sources) => {
            const first = sources[0];
            const name = documentTitle(
              sources,
              sources.some(({ id }) => privacyDocumentIds.includes(id)),
            );
            return (
              <div key={first.id}>
                <a
                  href={"#evidence-" + first.id}
                  data-document-reader=""
                  aria-haspopup="dialog"
                  className="group grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2.5 text-foreground hover:bg-default/60 focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <span className="grid size-10 place-items-center rounded-lg bg-default text-muted">
                    <ReportIcon name="policy" />
                  </span>
                  <span className="grid min-w-0 gap-0.5">
                    <strong className="font-medium group-hover:underline">
                      {name}
                    </strong>
                    <span className="truncate text-xs text-muted">
                      {first.url
                        ? new URL(first.url).hostname +
                          new URL(first.url).pathname
                        : "Saved document"}
                    </span>
                  </span>
                  <ReportIcon name="forward" />
                </a>
                {sources.map((source) => (
                  <div
                    key={source.id}
                    id={"evidence-" + source.id}
                    className="hidden space-y-2 rounded-lg bg-default p-4 target:block"
                  >
                    <p
                      lang={source.language}
                      className="text-sm leading-relaxed wrap-anywhere"
                    >
                      {source.excerpt}
                    </p>
                    {source.url && (
                      <a
                        className="inline-link text-sm"
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open original document
                      </a>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </Section>
      )}
      {other.map((source) => (
        <section
          key={source.id}
          id={"evidence-" + source.id}
          className="hidden rounded-lg bg-surface p-4 target:block"
        >
          <h3 className="font-medium">
            {contentPageEvidenceTitle(source) ??
              (source.consentScenario
                ? ratingLabels[source.consentScenario] + " · Browser evidence"
                : "Source excerpt")}
          </h3>
          <p className="text-sm leading-relaxed wrap-anywhere">
            {source.excerpt}
          </p>
          {source.url && (
            <a
              className="inline-link text-sm"
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              Open source
            </a>
          )}
        </section>
      ))}
    </>
  );
}

const policyTopicLabels: Record<PolicyTopic, string> = {
  collection: "Data collection",
  purpose: "How data is used",
  sharing: "Data sharing",
  retention: "Retention",
  legal_basis: "Legal basis",
  transfers: "International transfers",
  rights: "User rights",
};

const consentChoices = [
  ["default", "Default visit"],
  ["rejected", "Optional consent rejected"],
  ["accepted", "Optional consent accepted"],
] as const;

function consentGap(outcome?: ConsentOutcome) {
  switch (outcome) {
    case "control_unavailable":
      return "The scanner did not find a visible control for this choice.";
    case "inconclusive":
      return "The scanner tried this scenario but could not confirm its result.";
    case "untested":
      return "This scenario was not tested.";
    default:
      return "This scan has no confirmed result for this scenario.";
  }
}

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="report-drill mt-8">
      <h2 className="mb-3 text-xl! font-semibold!">{title}</h2>
      {children}
    </section>
  );
}

function RatingCalculation({
  score,
  scenarioLabel,
  headline,
  evidenceById,
  practices,
  correctedRating,
}: {
  score: Score;
  scenarioLabel: string;
  headline: boolean;
  evidenceById: ReadonlyMap<string, ReportEvidence>;
  practices: PracticeTakeaway[];
  correctedRating?: { previous: number | null; date: string; reason: string };
}) {
  const practiceById = new Map(practices.map((row) => [row.factId, row]));
  const findings = score.adjustments;
  const netAdjustment = findings.reduce(
    (sum, finding) => sum + finding.adjustment,
    0,
  );
  const [verdict, advice] = ratingGuidance[score.grade];
  return (
    <section
      id={headline ? "score-breakdown" : undefined}
      className="report-calculation border-t border-separator"
      aria-label={
        headline ? "Score calculation" : scenarioLabel + " calculation"
      }
    >
      <Accordion>
        <Accordion.Item id={headline ? "score-factors" : "comparison-factors"}>
          <Accordion.Heading>
            <Accordion.Trigger>
              {headline
                ? "How this score was calculated"
                : scenarioLabel + " calculation"}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="text-foreground">
              {correctedRating && (
                <p>
                  Rating corrected on{" "}
                  {new Date(correctedRating.date).toLocaleDateString("en", {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  })}
                  . Previously {correctedRating.previous ?? "unrated"}.{" "}
                  {correctedRating.reason}
                </p>
              )}
              <p>
                <strong>
                  {scenarioLabel} ·{" "}
                  {score.practiceAssessment || score.inventoryAssessment
                    ? score.verdict
                    : verdict}
                </strong>
              </p>
              {!score.practiceAssessment && !score.inventoryAssessment && (
                <p>{advice}</p>
              )}
              <p className="text-sm text-muted">
                {score.confidence} confidence
              </p>
              {score.inventoryAssessment ? (
                <>
                  <p>{score.inventoryAssessment.coverage}</p>
                  <p>
                    Each item below costs points. The largest cost counts in
                    full, the next one half, the next a quarter, and so on.
                    Anything that starts before you choose costs 50% more.
                  </p>
                  {score.inventoryAssessment.costs.length ? (
                    <ul className="m-0! list-none divide-y divide-separator p-0!">
                      {score.inventoryAssessment.costs.map((item) => (
                        <li
                          key={item.itemId}
                          className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-2"
                        >
                          <div>
                            <p>
                              {item.label}
                              {item.vendor ? " · " + item.vendor : ""}
                            </p>
                            <span className="text-sm text-muted">
                              {item.reason}
                              {item.consentPenalty
                                ? " Present before you agreed."
                                : ""}
                            </span>
                          </div>
                          <strong className="whitespace-nowrap tabular-nums">
                            −{item.cost}
                          </strong>
                          <div className="flex flex-wrap gap-x-3 text-xs">
                            {item.evidenceIds
                              .filter((id) => evidenceById.has(id))
                              .map((id, index) => (
                                <a
                                  className="inline-link"
                                  key={id}
                                  href={"#evidence-" + id}
                                >
                                  {"Evidence " + (index + 1)}
                                </a>
                              ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No tracking or outside sharing cost any points.</p>
                  )}
                </>
              ) : score.practiceAssessment ? (
                <>
                  <p>{score.practiceAssessment.coverage}</p>
                  {score.score !== null && (
                    <p>
                      The lowest supported practice rating determines the score
                      for this visit. Repeated observations of the same practice
                      count once.
                    </p>
                  )}
                  <ul className="m-0! list-none divide-y divide-separator p-0!">
                    {[...score.practiceAssessment.ratings]
                      .sort((a, b) => (a.score ?? 101) - (b.score ?? 101))
                      .map((factor) => (
                        <li
                          key={factor.factId}
                          className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-2"
                        >
                          <div>
                            {practiceById.get(factor.factId) && (
                              <p>{practiceById.get(factor.factId)?.summary}</p>
                            )}
                            <span className="text-sm text-muted">
                              {factor.reason}
                            </span>
                          </div>
                          <strong className="whitespace-nowrap tabular-nums">
                            {factor.score == null
                              ? "Unrated"
                              : factor.score + "/100"}
                          </strong>
                          <div className="flex flex-wrap gap-x-3 text-xs">
                            {factor.evidenceIds
                              .filter((id) => evidenceById.has(id))
                              .map((id, index) => {
                                const citation = practiceById
                                  .get(factor.factId)
                                  ?.citations.find((row) => row.id === id);
                                return (
                                  <a
                                    className="inline-link"
                                    key={id}
                                    href={"#evidence-" + id}
                                    data-citation-quote={citation?.quote}
                                  >
                                    {citation?.label ??
                                      "Evidence " + (index + 1)}
                                  </a>
                                );
                              })}
                          </div>
                        </li>
                      ))}
                  </ul>
                </>
              ) : findings.length > 0 ? (
                <dl className="review-factors my-3 divide-y divide-separator [&>div]:grid [&>div]:grid-cols-[1fr_auto] [&>div]:items-baseline [&>div]:gap-3 [&>div]:py-2 [&_dd]:tabular-nums [&_[data-impact=positive]_dd]:text-success [&_[data-impact=negative]_dd]:text-warning">
                  {score.score !== null && (
                    <div>
                      <dt>
                        {headline
                          ? "Starting score"
                          : "Starting score for this visit"}
                      </dt>
                      <dd>{score.baseScore}</dd>
                    </div>
                  )}
                  {[...findings]
                    .sort(
                      (a, b) =>
                        Number(a.adjustment === 0) -
                          Number(b.adjustment === 0) ||
                        b.adjustment - a.adjustment,
                    )
                    .map((item, index) => (
                      <div
                        key={index}
                        data-impact={
                          item.adjustment > 0
                            ? "positive"
                            : item.adjustment < 0
                              ? "negative"
                              : "neutral"
                        }
                      >
                        <dt>
                          {item.title}
                          {item.evidenceIds
                            .filter((id) => evidenceById.has(id))
                            .map((id, sourceIndex, ids) => (
                              <a
                                key={id}
                                className="inline-link score-evidence-link mt-1 block text-sm"
                                href={"#evidence-" + id}
                                aria-label={
                                  "View evidence for " +
                                  item.title +
                                  (ids.length > 1
                                    ? " (" + (sourceIndex + 1) + ")"
                                    : "")
                                }
                              >
                                {ids.length > 1
                                  ? "Source " + (sourceIndex + 1)
                                  : "View evidence"}
                              </a>
                            ))}
                        </dt>
                        <dd>
                          {item.adjustment === 0
                            ? "0"
                            : item.adjustment > 0
                              ? "+" + item.adjustment
                              : "−" + Math.abs(item.adjustment)}
                        </dd>
                      </div>
                    ))}
                  <div className="font-semibold">
                    <dt>DataDeal Score</dt>
                    <dd>{score.score} / 100</dd>
                  </div>
                </dl>
              ) : (
                <p>No score adjustments are available for this scan.</p>
              )}
              {!score.practiceAssessment &&
                !score.inventoryAssessment &&
                score.baseScore != null && (
                  <p>
                    Historical scoring rules. {score.baseScore}{" "}
                    {netAdjustment < 0 ? "−" : "+"} {Math.abs(netAdjustment)} ={" "}
                    {score.baseScore + netAdjustment} points.
                    {score.baseScore + netAdjustment !== score.score &&
                      " The published total is shown above."}
                  </p>
                )}
              <p>
                <a className="inline-link" href="/methodology">
                  See the scoring scale
                </a>
                {" · Methodology "}
                {score.methodologyVersion}
                {score.rulesRevision &&
                  " · Rules revision " + score.rulesRevision}
              </p>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </section>
  );
}

function Severity({ severity }: { severity: Adjustment["severity"] }) {
  const color = {
    positive: "success",
    informational: "default",
    caution: "warning",
    critical: "danger",
  } as const;
  return (
    <Chip
      size="sm"
      variant="soft"
      color={color[severity]}
      className="capitalize"
    >
      <Chip.Label>{severity}</Chip.Label>
    </Chip>
  );
}

function SourceLinks({ item }: { item: Pick<Adjustment, "evidenceIds"> }) {
  return (
    <div className="flex flex-wrap gap-2 [&_a]:underline [&_a]:underline-offset-2">
      {item.evidenceIds.map((id) => (
        <a key={id} href={"#evidence-" + id}>
          Source {id}
        </a>
      ))}
    </div>
  );
}

type DestinationVisit = {
  evidenceId: string;
  label: string;
  afterChoice: boolean;
  responded: boolean;
};

type ProviderReference = {
  domain: string;
  scanId: string;
  evidenceId: string;
  responded?: boolean;
};

type FlowDestination = {
  label: string;
  explanation: string;
  evidenceIds: string[];
  observed?: boolean;
  visits?: DestinationVisit[];
  declared?: boolean;
  relatedSources?: { href: string; label: string }[];
};

function flowEvidence(destination: FlowDestination) {
  if (destination.declared && destination.observed) return "both";
  return destination.declared ? "policy" : "observed";
}

const flowEvidenceLabels = {
  observed: "Browser observation",
  policy: "Policy disclosure",
  both: "Browser and policy",
};

const providerDescriptions = new Map([
  [
    "gstatic.com",
    {
      name: "Google service infrastructure",
      description:
        "Google lists this domain among the hosts used by its services.",
      source:
        "https://knowledge.workspace.google.com/admin/security/firewall-and-proxy-settings",
      relatedSite: "google.com",
    },
  ],
  [
    "instagram.com",
    {
      name: "Instagram",
      description:
        "Instagram is one of the services Meta documents alongside Facebook.",
      source:
        "https://developers.facebook.com/docs/content-library-and-api/content-library-api/overview",
      relatedSite: "facebook.com",
    },
  ],
  [
    "morgen.so",
    {
      name: "Morgen",
      description:
        "A calendar and scheduling tool that offers appointment booking links.",
      source: "https://www.morgen.so/",
    },
  ],
  [
    "google-analytics.com",
    {
      name: "Google Analytics",
      description:
        "Google documents this domain as an endpoint for sending measurement events.",
      source:
        "https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference#transport",
    },
  ],
  [
    "doubleclick.net",
    {
      name: "Google advertising",
      description:
        "Google documents ad-serving endpoints on this domain for Google Ad Manager.",
      source: "https://support.google.com/admanager/answer/10358597",
    },
  ],
]);

function DestinationVisits({ visits }: { visits: DestinationVisit[] }) {
  return (
    <ul
      className="wrap-anywhere"
      aria-label="Visits where this destination appeared"
    >
      {visits.map(({ evidenceId, label, afterChoice, responded }) => (
        <li key={evidenceId}>
          <a className="inline-link" href={"#evidence-" + evidenceId}>
            {label}
          </a>
          {responded ? " · HTTP response observed" : " · Request attempted"}
          {afterChoice && " · Request observed after the choice"}
        </li>
      ))}
    </ul>
  );
}

export function Flow({
  host,
  recipients,
  favicon,
  direction = "outgoing",
  illustrative = false,
}: {
  host: string;
  recipients: FlowDestination[];
  favicon?: string;
  direction?: "incoming" | "outgoing";
  illustrative?: boolean;
}) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>();
  const [touchPan, setTouchPan] = useState(false);
  const helpId = useId();
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState(0);
  const ready = useClientReady();
  const [group, setGroup] = useState(0);
  const [leafReferences, setLeafReferences] = useState<{
    provider: string;
    sites: ProviderReference[];
  }>();
  const [path, setPath] = useState<
    {
      host: string;
      favicon?: string;
      connections: FlowDestination[];
      references: ProviderReference[];
      previous: {
        group: number;
        selected: number;
        pan: { x: number; y: number };
      };
    }[]
  >([]);
  const related = path.at(-1);
  const incoming = direction === "incoming" && !related;
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const currentHost = related?.host ?? host;
  const currentFavicon = related ? related.favicon : favicon;
  const connections = related?.connections ?? recipients;
  const active = connections[selected];
  if (!active)
    return (
      <p>Recipient connections could not be established from this scan.</p>
    );
  const provider = providerDescriptions.get(
    active.label.toLowerCase().replace(/^www\./, ""),
  );
  const otherScans =
    leafReferences?.provider === active.label
      ? leafReferences.sites
      : (related?.references ?? []);
  const relatedService =
    provider?.relatedSite === currentHost.toLowerCase().replace(/^www\./, "");
  const visited = [host, ...path.map((entry) => entry.host)];
  // Every connection is drawn: concentric rings holding 6, 12, 18, … nodes.
  const visible = connections;
  const rings: number[] = [];
  for (let left = visible.length, k = 0; left > 0; k++) {
    const take = Math.min(left, 6 + 4 * k);
    rings.push(take);
    left -= take;
  }
  const outer = rings.length ? 26 + 20 * (rings.length - 1) : 0;
  const points = rings.flatMap((take, k) => {
    const radius = rings.length === 1 ? 32 : 26 + 20 * k;
    return Array.from({ length: take }, (_, index) => {
      const angle =
        (take <= 2 ? -Math.PI / 4 : -Math.PI / 2) +
        (k % 2) * (Math.PI / take) +
        (2 * Math.PI * index) / take;
      return {
        // Match CSS percentage precision across the server and browser engines.
        x: Number((50 + radius * Math.cos(angle)).toFixed(4)),
        y: Number((50 + radius * 1.04 * Math.sin(angle)).toFixed(4)),
      };
    });
  });
  // Start zoomed out just enough for the outer ring to fit.
  const fitZoom = Math.max(0.75, Math.min(1, 44 / Math.max(outer, 1)));
  const scale = zoom ?? fitZoom;
  function moveGraph(target: HTMLElement, x: number, y: number) {
    const bound = (value: number, limit: number) =>
      Math.max(-limit, Math.min(limit, value));
    setPan({
      x: bound(x, target.clientWidth * 0.65 * scale),
      y: bound(y, target.clientHeight * 0.65 * scale),
    });
  }
  const zoomBy = (factor: number) =>
    setZoom(Math.min(2.5, Math.max(0.35, scale * factor)));
  const network = (
    <div
      className="flow-network relative h-[clamp(26rem,60vw,40rem)] cursor-grab touch-pan-y overflow-hidden select-none focus-visible:outline-2 focus-visible:-outline-offset-2 active:cursor-grabbing data-touch-pan:touch-none"
      role="group"
      aria-label="Website connection network"
      aria-describedby={helpId}
      tabIndex={0}
      data-touch-pan={touchPan || undefined}
      onPointerDown={(event) => {
        if (
          event.button !== 0 ||
          (event.pointerType === "touch" && !touchPan) ||
          (event.target as Element).closest("button")
        )
          return;
        drag.current = {
          id: event.pointerId,
          x: event.clientX - pan.x,
          y: event.clientY - pan.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.id !== event.pointerId) return;
        moveGraph(
          event.currentTarget,
          event.clientX - start.x,
          event.clientY - start.y,
        );
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const directions: Record<string, [number, number]> = {
          ArrowLeft: [-40, 0],
          ArrowRight: [40, 0],
          ArrowUp: [0, -40],
          ArrowDown: [0, 40],
        };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        moveGraph(
          event.currentTarget,
          pan.x + direction[0],
          pan.y + direction[1],
        );
      }}
    >
      <div
        className="flow-viewport absolute inset-0"
        style={{
          translate: `${pan.x}px ${pan.y}px`,
          scale: String(scale),
          transformOrigin: "50% 50%",
        }}
      >
        <svg
          className="flow-lines absolute inset-0 size-full stroke-muted opacity-65 [&_[data-evidence=observed]]:stroke-accent [&_[data-evidence=both]]:stroke-accent"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {incoming && (
            <defs>
              <marker
                id={helpId + "-arrow"}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0 1l7 3-7 3" fill="none" stroke="context-stroke" />
              </marker>
            </defs>
          )}
          {points.map(({ x, y }, index) => (
            <line
              key={index}
              x1={incoming ? x : 50}
              y1={incoming ? y : 50}
              x2={incoming ? 50 + (x - 50) * 0.35 : x}
              y2={incoming ? 50 + (y - 50) * 0.35 : y}
              markerEnd={
                incoming && index < visible.length
                  ? `url(#${helpId}-arrow)`
                  : undefined
              }
              data-evidence={flowEvidence(visible[index])}
              strokeDasharray={
                visible[index]?.declared
                  ? visible[index].observed
                    ? "8 3 2 3"
                    : "2 5"
                  : "7 5"
              }
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {/* Same shape as the recipients: icon in the bubble, name below it. */}
        <strong className="flow-root absolute top-1/2 left-1/2 grid size-[clamp(3.2rem,8vw,4.75rem)] -translate-1/2 place-items-center rounded-full border-2 border-accent bg-surface">
          {currentFavicon ? (
            <img
              src={currentFavicon}
              alt=""
              width={28}
              height={28}
              className="size-[55%] object-contain"
            />
          ) : (
            <svg
              aria-hidden="true"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <circle cx="12" cy="12" r="9" />
              <ellipse cx="12" cy="12" rx="4" ry="9" />
              <path d="M3 12h18" />
            </svg>
          )}
          <span className="flow-root-label pointer-events-none absolute top-full left-1/2 mt-1.5 w-max max-w-[14rem] -translate-x-1/2 truncate text-sm font-semibold">
            {currentHost}
          </span>
        </strong>
        {visible.map((item, index) => {
          const icon = bundledSiteFavicon(item.label.toLowerCase());
          return (
            <Button
              key={item.label}
              size="sm"
              aria-pressed={selected === index}
              aria-label={item.label}
              aria-describedby={helpId + "-" + flowEvidence(item)}
              variant={selected === index ? "primary" : "secondary"}
              className="flow-destination absolute! max-w-[min(34%,10rem)] -translate-1/2 text-center leading-tight whitespace-normal wrap-anywhere rounded-full! p-0! size-[clamp(2.8rem,6vw,3.75rem)]"
              style={{
                left: points[index].x + "%",
                top: points[index].y + "%",
              }}
              isDisabled={!ready || loading}
              onPress={() => {
                setNotice("");
                setSelected(index);
              }}
            >
              {icon ? (
                <img src={icon} alt="" width={24} height={24} />
              ) : (
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  {item.declared ? (
                    <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" />
                  ) : (
                    <>
                      <circle cx="12" cy="12" r="9" />
                      <ellipse cx="12" cy="12" rx="4" ry="9" />
                      <path d="M3 12h18" />
                    </>
                  )}
                </svg>
              )}
              <span
                className="flow-label pointer-events-none absolute top-full left-1/2 mt-1.5 w-max max-w-[min(31vw,13rem)] -translate-x-1/2 truncate text-xs leading-tight text-foreground"
                aria-hidden="true"
              >
                {item.label}
              </span>
            </Button>
          );
        })}
      </div>
      <div className="flow-reset absolute! right-2 bottom-2 flex gap-1">
        <Button
          size="sm"
          variant="secondary"
          isIconOnly
          aria-label="Zoom out"
          onPress={() => zoomBy(1 / 1.25)}
        >
          −
        </Button>
        <Button
          size="sm"
          variant="secondary"
          isIconOnly
          aria-label="Zoom in"
          onPress={() => zoomBy(1.25)}
        >
          +
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => {
            setPan({ x: 0, y: 0 });
            setZoom(undefined);
          }}
        >
          Fit
        </Button>
      </div>
    </div>
  );
  if (illustrative)
    return (
      <div
        inert
        aria-hidden="true"
        className="[&_.flow-network]:h-48! [&_.flow-reset]:hidden [&_.flow-root]:size-9! [&_.flow-root-label]:text-[.66rem] [&_.flow-label]:text-[.66rem] [&_.flow-destination]:size-8!"
      >
        {network}
      </div>
    );
  return (
    <>
      <Button
        size="sm"
        variant={touchPan ? "primary" : "secondary"}
        className="flow-touch-toggle hidden! [@media(any-pointer:coarse)]:inline-flex! min-h-11"
        onPress={() => setTouchPan(!touchPan)}
      >
        {touchPan ? "Stop dragging" : "Drag graph"}
      </Button>
      {network}
      <p className="text-sm text-muted" id={helpId}>
        <span className="flow-pointer-help [@media(any-pointer:coarse)]:hidden">
          Drag or use the arrow keys to move the graph, and Ctrl + scroll or the
          + and − buttons to zoom.{" "}
        </span>
        <span className="flow-touch-help hidden [@media(any-pointer:coarse)]:inline">
          Use Drag graph to move around the canvas.{" "}
        </span>
        Select a connection to see its evidence.
      </p>
      <ul
        className="flow-legend my-2 flex list-none flex-wrap gap-x-4 gap-y-1 text-xs text-muted [&_li]:inline-flex [&_li]:items-center [&_li]:gap-1.5"
        aria-label="Connection evidence"
      >
        {[...new Set(connections.map(flowEvidence))].map((kind) => (
          <li key={kind} id={helpId + "-" + kind} data-evidence={kind}>
            {flowEvidenceLabels[kind]}
          </li>
        ))}
      </ul>
      {related && (
        <p
          className="flow-path mt-4 flex flex-wrap items-center gap-3 [&_strong]:rounded-lg [&_strong]:bg-surface-secondary [&_strong]:px-2 [&_strong]:py-1"
          aria-label="Connection path"
        >
          {visited.map((step, index) => (
            <span key={step}>
              {index > 0 && <span aria-hidden="true"> → </span>}
              {step}
            </span>
          ))}
        </p>
      )}
      {related && (
        <Button
          size="sm"
          variant="ghost"
          isDisabled={loading}
          onPress={() => {
            setPath(path.slice(0, -1));
            setGroup(related.previous.group);
            setSelected(related.previous.selected);
            setPan(related.previous.pan);
            setNotice("");
          }}
        >
          Back to {visited[visited.length - 2]}
        </Button>
      )}

      <section
        className="flow-provider my-4 rounded-2xl border border-separator p-4 sm:p-5"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="m-0 text-base font-semibold wrap-anywhere">
            {provider?.name ?? active.label}
          </h4>
          <span
            className="rounded-full bg-default px-2.5 py-0.5 text-xs font-medium"
            data-evidence={flowEvidence(active)}
          >
            {flowEvidenceLabels[flowEvidence(active)]}
          </span>
        </div>
        {provider?.name && provider.name !== active.label && (
          <p className="mt-0.5 mb-0 text-xs text-muted">{active.label}</p>
        )}
        <p className="mt-3 mb-0 text-sm leading-relaxed">
          {provider && provider.description + " "}
          {relatedService &&
            "The site and destination belong to the same documented service ecosystem. "}
          {active.explanation}
        </p>
      </section>
      {provider && (
        <p>
          <a className="inline-link" href={provider.source} rel="noreferrer">
            About {provider.name}
          </a>
        </p>
      )}
      {active.visits ? (
        <>
          <DestinationVisits visits={active.visits} />
          {active.evidenceIds.some(
            (id) => !active.visits?.some((visit) => visit.evidenceId === id),
          ) && (
            <SourceLinks
              item={{
                evidenceIds: active.evidenceIds.filter(
                  (id) =>
                    !active.visits?.some(({ evidenceId }) => evidenceId === id),
                ),
              }}
            />
          )}
        </>
      ) : (
        <SourceLinks item={active} />
      )}
      {active.relatedSources?.map(({ href, label }) => (
        <p key={href}>
          <a className="inline-link" href={href}>
            {label}
          </a>
        </p>
      ))}
      {active.label.includes(".") && (
        <Button
          size="sm"
          variant="secondary"
          isDisabled={loading}
          onPress={async () => {
            setLoading(true);
            setNotice("");
            try {
              const response = await fetch(
                "/api/v1/domains/" +
                  encodeURIComponent(active.label) +
                  "/connections",
              );
              if (!response.ok) {
                setNotice(
                  response.status === 404
                    ? "No published scan for this provider yet."
                    : "This provider scan could not be opened.",
                );
                return;
              }
              const result: {
                domain: string;
                scanId: string | null;
                favicon?: string;
                references?: ProviderReference[];
                destinations: {
                  label: string;
                  declaredEvidenceId?: string;
                  observedEvidenceId?: string;
                }[];
              } = await response.json();
              if (visited.includes(result.domain)) {
                setNotice(
                  "This provider is already in the connection path. Use Back to return to it.",
                );
                return;
              }
              if (!result.destinations.length) {
                setLeafReferences({
                  provider: active.label,
                  sites: (result.references ?? []).filter(
                    ({ domain }) => domain !== currentHost,
                  ),
                });
                setNotice(
                  result.scanId
                    ? "The provider’s scan has no recorded onward connections."
                    : "No scan of the provider itself is available.",
                );
                return;
              }
              setGroup(0);
              setZoom(undefined);
              setLeafReferences(undefined);
              setSelected(0);
              setPan({ x: 0, y: 0 });
              setPath([
                ...path,
                {
                  host: result.domain,
                  favicon: result.favicon,
                  previous: { group, selected, pan },
                  references: (result.references ?? []).filter(
                    ({ domain }) => domain !== currentHost,
                  ),
                  connections: result.destinations.map(
                    ({ label, declaredEvidenceId, observedEvidenceId }) => ({
                      label,
                      declared: Boolean(declaredEvidenceId),
                      observed: Boolean(observedEvidenceId),
                      evidenceIds: [],
                      explanation: [
                        declaredEvidenceId &&
                          "The provider's privacy policy names this destination.",
                        observedEvidenceId &&
                          "A browser visit to the provider attempted a request to this domain.",
                      ]
                        .filter(Boolean)
                        .join(" "),
                      relatedSources: [
                        {
                          id: declaredEvidenceId,
                          label: "View policy evidence",
                        },
                        {
                          id: observedEvidenceId,
                          label: "View browser evidence",
                        },
                      ].flatMap(({ id, label }) =>
                        id
                          ? [
                              {
                                href: `/report/${result.domain}?scan=${result.scanId}#evidence-${id}`,
                                label,
                              },
                            ]
                          : [],
                      ),
                    }),
                  ),
                },
              ]);
            } catch {
              setNotice("This provider scan could not be opened.");
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading
            ? "Opening scan…"
            : incoming
              ? "Expand website scan"
              : "Expand provider scan"}
        </Button>
      )}
      {notice && <p role="status">{notice}</p>}
      {otherScans.length > 0 && (
        <section className="mt-8" aria-label="Other scans with this provider">
          <h3>Other scans with this provider</h3>
          <p className="text-sm text-muted">
            These browser visits attempted a request to{" "}
            {leafReferences?.provider === active.label
              ? active.label
              : currentHost}
            .
          </p>
          <ul className="space-y-2 [&_li]:border-b [&_li]:border-separator [&_li]:py-2 [&_li]:target:bg-accent/10 [&_summary]:cursor-pointer">
            {otherScans.map(({ domain, scanId, evidenceId, responded }) => (
              <li key={domain}>
                <a
                  className="inline-link"
                  href={`/report/${domain}?scan=${scanId}#evidence-${evidenceId}`}
                >
                  {domain}
                </a>
                {responded && <p>Response recorded</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ScoreHistoryChart({
  data,
}: {
  data: { date: string; score: number | null }[];
}) {
  if (data.filter(({ score }) => score !== null).length < 2) return null;
  const shortDate = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const fullDate = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const chartData = data.map(({ date, score }) => {
    const point: Record<string, number> = { date: Date.parse(date) };
    if (score !== null) point.score = score;
    return point;
  });
  return (
    <div
      className="score-history-chart"
      role="group"
      aria-label="Privacy score over time"
    >
      <h3>Privacy score over time</h3>
      <LineChart data={chartData} height={200}>
        <LineChart.Grid vertical={false} />
        <LineChart.XAxis
          dataKey="date"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(date: number) => shortDate.format(date)}
          tickMargin={8}
          minTickGap={24}
        />
        <LineChart.YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          width={32}
        />
        <LineChart.Line
          name="Privacy score"
          dataKey="score"
          stroke="var(--accent)"
          strokeWidth={2}
          type="linear"
          connectNulls={false}
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
        <LineChart.Tooltip
          content={<LineChart.TooltipContent />}
          labelFormatter={(date) =>
            typeof date === "number" ? fullDate.format(date) + " UTC" : date
          }
        />
      </LineChart>
      {data.some(({ score }) => score === null) && (
        <p className="text-sm text-muted">
          Gaps mark scans without a comparable score. Open a scan below to see
          its result.
        </p>
      )}
    </div>
  );
}

export function ReportContent({
  host,
  report,
  score,
  headlineScenario = "accepted",
  defaultScore = headlineScenario === "default" ? score : null,
  practices = [],
  summaryClaims,
  acceptAllVisitId,
  otherWarnings,
  correctedRating,
  current,
  activeStages,
  previousRewardedScan,
  scanAvailable,
  history,
  archived,
  advanced,
  advancedAvailable,
  browserVisits,
  consentDifference,
  contentPages,
  pageDifference,
  defaultBrowserObserved,
  policyHighlights,
  adPreview,
  adUnit,
  limitedAdUnit,
  testAd,
  rewardTest,
  minimizeData,
  changes,
  comparison,
}: {
  host: string;
  report?: ScanReport;
  score: Score | null;
  headlineScenario?: DataPractice["scenario"];
  defaultScore?: Score | null;
  practices?: PracticeTakeaway[];
  summaryClaims: SummaryClaim[];
  acceptAllVisitId?: string;
  otherWarnings?: Score["adjustments"];
  correctedRating?: { previous: number | null; date: string; reason: string };
  current?: string;
  activeStages?: readonly ScanStage[];
  previousRewardedScan?: string;
  scanAvailable: boolean;
  history: {
    id: string;
    date: string;
    state: string;
    rating?: Pick<Score, "score" | "grade"> & ScoringRules;
  }[];
  archived: boolean;
  advanced: boolean;
  advancedAvailable: boolean;
  consentDifference?: ReturnType<typeof compareConsentDestinations>;
  contentPages?: PublicContentPageSample;
  pageDifference?: { text: string; evidenceId: string };
  browserVisits: {
    id: string;
    scenario: string;
    url?: string;
    finalPageKnown?: boolean;
    requests: number;
    cookies: number;
    storage?: { localEntries: number; sessionEntries: number };
    requestInspection?: {
      examined: number;
      matched: number;
      limitReached: boolean;
    };
    outside: number;
  }[];
  defaultBrowserObserved: boolean;
  policyHighlights: ReturnType<typeof publicPolicyHighlights>;
  adPreview: boolean;
  adUnit?: string;
  limitedAdUnit?: string;
  testAd: boolean;
  rewardTest?: {
    host: string;
    scanId: string;
    game?: boolean;
    signedIn?: boolean;
  };
  minimizeData: boolean;
  comparison?: ScanComparison;
  changes:
    | {
        evidenceId: string;
        url: string;
        kind: string;
        passage?: { before: string; after: string };
      }[]
    | null;
}) {
  useEffect(() => {
    const revealEvidence = () => {
      const id = window.location.hash.slice(1);
      if (!id.startsWith("evidence-")) return;
      const source = document.getElementById(id);
      let disclosure = source?.closest("details");
      while (disclosure) {
        disclosure.open = true;
        disclosure = disclosure.parentElement?.closest("details");
      }
      source?.scrollIntoView({ block: "nearest" });
    };
    revealEvidence();
    window.addEventListener("hashchange", revealEvidence);
    return () => window.removeEventListener("hashchange", revealEvidence);
  }, []);
  const findings = [...(score?.adjustments ?? [])];
  for (const item of otherWarnings ?? []) {
    if (
      critical(item) &&
      !findings.some(
        (known) =>
          known.rule === item.rule &&
          known.evidenceIds.length === item.evidenceIds.length &&
          item.evidenceIds.every((id) => known.evidenceIds.includes(id)),
      )
    )
      findings.push(item);
  }
  const requestFindings = publicRequestFindings(report);
  const providerDisclosures = publicProviderDisclosures(report);
  const analytics = selfHostedAnalyticsDisclosure(report);
  const recipients = findings.filter(
    (item) =>
      item.rule === "necessary_processor" || item.rule === "independent_ads",
  );
  const attemptedDestinations = new Map<string, DestinationVisit[]>();
  const visitLabels = {
    default: "Default visit",
    rejected: "Reject visit",
    accepted: "Accept visit",
  };
  function recordVisit(source: ReportEvidence, label: string) {
    const observation = source.observation;
    if (
      observation?.type !== "browser_consent_counts" &&
      observation?.type !== "browser_content_page"
    )
      return;
    for (const domain of observation.externalDomains) {
      const citations = attemptedDestinations.get(domain) ?? [];
      citations.push({
        evidenceId: source.id,
        label,
        afterChoice:
          observation.afterChoice?.externalDomains.includes(domain) ?? false,
        responded: observation.responseDomains?.includes(domain) ?? false,
      });
      attemptedDestinations.set(domain, citations);
    }
  }
  for (const source of report?.evidence ?? []) {
    if (
      source.scanId === report?.id &&
      source.kind === "observed_technical" &&
      source.observation?.type === "browser_consent_counts" &&
      source.observation.finalPageKnown !== false &&
      (!report?.consentCoverage ||
        (source.consentScenario &&
          report.consentCoverage[source.consentScenario] === "measured"))
    )
      recordVisit(
        source,
        source.consentScenario
          ? visitLabels[source.consentScenario]
          : "Browser visit",
      );
  }
  for (const { source, landed } of measuredContentVisits(report)) {
    recordVisit(
      source,
      visitLabels[source.consentScenario!] + " · " + landed.pathname,
    );
  }
  const flowDestinations: FlowDestination[] = [...attemptedDestinations].map(
    ([label, visits]) => ({
      label,
      evidenceIds: visits.map(({ evidenceId }) => evidenceId),
      visits,
      observed: true,
      explanation: visits.some(({ responded }) => responded)
        ? "The browser observed an HTTP response to a request for this domain."
        : "The browser attempted a request to this domain.",
    }),
  );
  for (const source of report?.evidence ?? []) {
    if (
      source.scanId !== report?.id ||
      source.kind !== "declared_first_party" ||
      source.observation?.type !== "policy_section"
    )
      continue;
    const localPlausible = selfHostedPlausible(source.excerpt);
    const selfHostedService =
      source.observation.topic === "purpose"
        ? source.excerpt.match(
            /\bself-hosted ((?!Plausible\b)[a-z ]{1,80}) instance at ([a-z0-9.-]+\.[a-z]{2,})\b/i,
          )
        : undefined;
    const selfHosted =
      localPlausible?.match(
        /\b(?:instance at|unter|erreichbar unter)\s+(?:https:\/\/)?([a-z0-9.-]+\.[a-z]{2,})\b/i,
      )?.[1] ?? selfHostedService?.[2];
    const hosts = new Set(source.observation.providerHosts ?? []);
    if (selfHosted?.endsWith("." + host)) hosts.add(selfHosted);
    for (const label of hosts) {
      const existing = flowDestinations.find(
        (destination) => destination.label === label,
      );
      if (existing) {
        existing.evidenceIds.push(source.id);
        existing.declared = true;
      } else {
        flowDestinations.push({
          label,
          explanation:
            label === selfHosted
              ? `The policy says the site runs its own ${localPlausible ? "Plausible" : selfHostedService?.[1]} instance on this subdomain. This disclosure alone does not establish a transfer to a separate company.`
              : `The policy names this provider in “${source.observation.heading}”. The scan has not confirmed that this provider received personal data.`,
          evidenceIds: [source.id],
          declared: true,
        });
      }
    }
  }
  for (const finding of requestFindings) {
    const fields = report?.evidence.find(
      (item) => item.id === finding.evidenceId,
    )?.observation;
    if (fields?.type !== "browser_request_fields") continue;
    const label =
      fields.relation === "cross_site"
        ? finding.destination
        : fields.signature === "plausible_event"
          ? "Site analytics"
          : "Site requests";
    const destination = flowDestinations.find((item) => item.label === label);
    if (destination) {
      if (!destination.explanation.includes(finding.text))
        destination.explanation += " " + finding.text;
      destination.evidenceIds.push(finding.evidenceId);
    } else {
      flowDestinations.push({
        label,
        explanation: finding.text,
        observed: true,
        evidenceIds: [finding.evidenceId],
      });
    }
  }
  for (const provider of providerDisclosures) {
    const target = provider.providerHost.replace(/^www\./, "");
    const node = flowDestinations.find(
      (item) =>
        item.declared &&
        item.evidenceIds.includes(provider.referringEvidenceId) &&
        (item.label === target || item.label.endsWith("." + target)),
    );
    if (!node) continue;
    node.relatedSources ??= [];
    node.relatedSources.push({
      href: "#evidence-" + provider.evidenceId,
      label: "Provider disclosure: " + (provider.excerpt ?? provider.section),
    });
  }
  const resourceEvidence = report?.evidence.find(
    (source) => source.observation?.type === "html_resource_hosts",
  );
  const routingEvidence = report?.evidence.find(
    (source) => source.observation?.type === "dns_cname",
  );
  const policyTopics =
    report?.evidence.flatMap((source) => {
      const section = source.observation;
      return section?.type === "policy_section" && section.topic
        ? [{ id: source.id, topic: section.topic, heading: section.heading }]
        : [];
    }) ?? [];
  const hasPolicy =
    findings.some((item) => item.rule === "policy_available") ||
    Boolean(
      report?.evidence.some(
        (source) =>
          isPolicyDocument(source) &&
          source.observation?.type === "policy_section",
      ),
    );
  const savedPolicyBrief =
    report?.policyBrief ?? report?.policySummaryAddendum?.items;
  const measuredDefaultVisit = browserVisits.find(
    ({ scenario }) => scenario === "default",
  );
  const measuredChoices = consentChoices.filter(
    ([scenario]) =>
      browserVisits.some((visit) => visit.scenario === scenario) ||
      report?.consentCoverage?.[scenario] === "measured",
  );
  const missingChoices = consentChoices.filter(
    ([scenario]) =>
      !measuredChoices.some(([measured]) => scenario === measured),
  );
  const hasChoiceVisit = measuredChoices.some(
    ([scenario]) => scenario !== "default",
  );
  const postChoiceComparison = consentDifference && (
    <div className="mb-4 space-y-1 text-sm">
      <h3 className="font-medium">After the consent choice</h3>
      <p className="wrap-anywhere">{consentDifference.text}</p>
      <div className="flex flex-wrap gap-x-4 text-xs">
        {consentDifference.sources.map((source) => (
          <a
            className="inline-link"
            key={source.id}
            href={"#evidence-" + source.id}
            data-citation-quote={source.excerpt}
          >
            {source.label} evidence
          </a>
        ))}
      </div>
    </div>
  );
  const coverageDetails = browserVisits.length > 0 &&
    missingChoices.length > 0 && (
      <ProviderDisclosure label="Scan coverage">
        <p>
          The recorded homepage visits are{" "}
          {measuredChoices.map(([, label]) => label.toLowerCase()).join(", ")}.
        </p>
        <dl className="text-sm text-muted">
          {missingChoices.map(([scenario, label]) => (
            <div key={scenario}>
              <dt>{label}</dt>
              <dd>{consentGap(report?.consentCoverage?.[scenario])}</dd>
            </div>
          ))}
        </dl>
      </ProviderDisclosure>
    );
  const policyBrief = policyHighlights.slice(0, 3);
  const controls = findings.find((item) => item.rule === "optional_control");
  const disclosureIds = findings
    .map((item, index) => (critical(item) ? "finding-" + index : null))
    .filter((id) => id !== null);
  const grade = score?.grade ?? "Unrated";
  const [verdict] = ratingGuidance[grade];
  const hasUsableReport = Boolean(
    report &&
    score &&
    (score.score !== null ||
      practices.length > 0 ||
      hasPolicy ||
      defaultBrowserObserved ||
      findings.some(
        (item) =>
          item.rule !== "missing_information" && item.confidence !== "low",
      )),
  );
  const currentState = states.find((state) => state === current);
  const scanActive = isActiveScan(currentState);
  const policyOnly = Boolean(
    report && score?.score === null && hasPolicy && !defaultBrowserObserved,
  );
  const policyReviewedAt = report?.evidence.find(({ id }) =>
    findings.some(
      (item) =>
        item.rule === "policy_available" && item.evidenceIds.includes(id),
    ),
  )?.retrievedAt;
  const [failedFavicons, setFailedFavicons] = useState<string[]>([]);
  const siteFavicon = [report?.favicon, bundledSiteFavicon(host)].find(
    (url): url is string => Boolean(url && !failedFavicons.includes(url)),
  );
  const policyDocuments = report?.evidence.filter(isPolicyDocument) ?? [];
  const technicalSources =
    report?.evidence.filter((source) => !isPolicyDocument(source)) ?? [];
  const privacyDocumentIds = findings
    .filter((item) => item.rule === "policy_available")
    .flatMap((item) => item.evidenceIds);
  const sourceSection = report &&
    (policyOnly || !advanced || !hasUsableReport) && (
      <PublicSources
        evidence={
          advanced
            ? publicReportEvidence(report, [
                ...policyBrief.map(({ source }) => source),
                ...findings.flatMap(({ evidenceIds }) => evidenceIds),
                ...(changes?.map(({ evidenceId }) => evidenceId) ?? []),
              ])
            : report.evidence
        }
        privacyDocumentIds={privacyDocumentIds}
      />
    );
  const evidenceById = new Map(
    report?.evidence.map((source) => [source.id, source]),
  );
  const hasCitedAnalysis = policyBrief.some((item) =>
    savedPolicyBrief?.some(
      (saved) =>
        saved.source === item.source &&
        saved.quote &&
        saved.topic === item.topic &&
        saved.quote === item.quote &&
        evidenceById.get(item.source)?.excerpt.includes(saved.quote),
    ),
  );
  const summaryHeading = (
    <div className="report-summary-heading flex items-center gap-2">
      <ReportIcon name={hasCitedAnalysis ? "sparkle" : "policy"} />
      <h2 className="text-lg! font-semibold!" id="review-summary-title">
        {hasCitedAnalysis ? "AI analysis" : "Scan summary"}
      </h2>
    </div>
  );
  const headlineVisit = browserVisits.find(
    (v) => v.id === (score?.noChoiceEvidence?.visitIds[0] ?? acceptAllVisitId),
  );
  const visitSnapshot = headlineVisit && (
    <section
      className="report-visit-snapshot grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-y-1 rounded-xl border border-border px-4 py-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(0,2fr)] sm:gap-x-4 sm:px-6 sm:py-4"
      aria-labelledby="visit-snapshot-title"
    >
      <div className="snapshot-heading col-start-1 row-start-1 flex items-center gap-2 text-muted">
        <ReportIcon name="glance" />
        <h2
          className="text-base! font-semibold! text-foreground"
          id="visit-snapshot-title"
        >
          {score?.noChoiceEvidence
            ? "Signed-out homepage visit"
            : "Accept-all visit"}
        </h2>
      </div>
      <dl className="col-span-full row-start-2 my-2 grid grid-cols-3 items-start gap-2 sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:my-0 [&>div]:grid [&_dt]:text-xs [&_dt]:text-muted [&_dd]:row-start-1 [&_dd]:text-lg [&_dd]:font-semibold [&_dd]:tabular-nums">
        <div>
          <dt>Attempted requests</dt>
          <dd>{headlineVisit.requests}</dd>
        </div>
        <div>
          <dt>Outside domains</dt>
          <dd>
            {headlineVisit.outside === 20 ? "20+" : headlineVisit.outside}
          </dd>
        </div>
        <div>
          <dt>Cookies at end</dt>
          <dd>{headlineVisit.cookies}</dd>
        </div>
      </dl>
      <a
        className="inline-link col-start-2 row-start-1 w-fit text-xs sm:col-start-1 sm:row-start-2"
        href={"#evidence-" + headlineVisit.id}
      >
        Visit evidence
      </a>
    </section>
  );
  const analysisOverview = (summaryClaims.length > 0 || visitSnapshot) && (
    <div className="report-analysis-overview grid grid-cols-[minmax(0,1fr)] gap-3">
      {summaryClaims.length > 0 && (
        <Card
          role="region"
          className="report-plain-summary min-w-0 gap-2 border border-border p-4 data-[ai=true]:border-accent/25 data-[ai=true]:shadow-sm sm:p-6 [&>p]:my-0! [&>p]:text-[.93rem] [&>p]:leading-relaxed sm:[&>p]:text-base"
          data-ai={hasCitedAnalysis || undefined}
          aria-labelledby="review-summary-title"
        >
          {summaryHeading}
          <SummaryText claims={summaryClaims} />
        </Card>
      )}
      {visitSnapshot}
    </div>
  );
  const acceptedVisit = browserVisits.find(
    (visit) => visit.scenario === "accepted",
  );
  const acceptedScore = acceptedVisit && report?.acceptAllScoring;
  const rejectedVisit = browserVisits.find(
    (visit) => visit.scenario === "rejected",
  );
  const rejectedScore = rejectedVisit && report?.rejectedScoring;
  const headlineLabel = score?.noChoiceEvidence
    ? noChoiceVisitLabel
    : ratingLabels[headlineScenario];
  const scenarioRatings = [
    {
      scenario: "default" as const,
      rating: defaultScore,
      visit: measuredDefaultVisit,
    },
    ...(acceptedScore
      ? [
          {
            scenario: "accepted" as const,
            rating: acceptedScore,
            visit: acceptedVisit,
          },
        ]
      : []),
    ...(rejectedScore
      ? [
          {
            scenario: "rejected" as const,
            rating: rejectedScore,
            visit: rejectedVisit,
          },
        ]
      : []),
  ];
  const calculation = (rating: Score, scenario: DataPractice["scenario"]) => (
    <RatingCalculation
      key={scenario}
      score={rating}
      scenarioLabel={
        rating.noChoiceEvidence ? noChoiceVisitLabel : ratingLabels[scenario]
      }
      headline={headlineScenario === scenario}
      correctedRating={scenario === "default" ? correctedRating : undefined}
      evidenceById={evidenceById}
      practices={practices}
    />
  );
  const ratingComparison =
    advanced && scenarioRatings.length > 1 && score ? (
      <section className="mt-8" aria-labelledby="scenario-ratings-title">
        <h2
          id="scenario-ratings-title"
          className="mb-2 text-xl! font-semibold!"
        >
          Ratings by consent choice
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted">
          {score.noChoiceEvidence
            ? "The public rating covers signed-out pages where the browser detected no consent choice."
            : "The public rating uses the visit after accepting all optional cookies."}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3 border-t border-separator py-4">
          {scenarioRatings.map(({ scenario, rating, visit }) => {
            const label = ratingLabels[scenario];
            return (
              <div
                key={label}
                data-rating={rating?.grade.toLowerCase()}
                className="min-w-32 flex-1"
              >
                <h3 className="mb-1 text-sm! font-medium!">{label}</h3>
                <div className="flex flex-wrap items-baseline gap-x-2 text-[var(--rating,var(--muted))]">
                  {rating?.score != null && (
                    <span className="whitespace-nowrap text-xl font-semibold tabular-nums">
                      {rating.score}
                      <span className="text-sm font-normal text-muted">
                        /100
                      </span>
                    </span>
                  )}
                  <span className="text-sm font-medium">
                    {rating?.grade ?? "Unrated"}
                  </span>
                </div>
                {visit && evidenceById.has(visit.id) && (
                  <a
                    className="inline-link mt-1 inline-block text-xs"
                    href={"#evidence-" + visit.id}
                    aria-label={label + " visit evidence"}
                  >
                    Visit evidence
                  </a>
                )}
              </div>
            );
          })}
        </div>
        {calculation(score, headlineScenario)}
        {scenarioRatings.flatMap(({ scenario, rating }) =>
          scenario !== headlineScenario && rating?.score != null
            ? [calculation(rating, scenario)]
            : [],
        )}
      </section>
    ) : score &&
      (score.score != null ||
        score.practiceAssessment?.ratings.length ||
        score.inventoryAssessment?.costs.length) ? (
      calculation(score, headlineScenario)
    ) : null;
  const observedSource =
    measuredDefaultVisit && evidenceById.get(measuredDefaultVisit.id);
  const homepageFinding = observedSource?.excerpt
    ? practices.find(
        (row) =>
          row.quietVisit &&
          !row.mismatch &&
          !row.unknowns.length &&
          row.scenario === "default" &&
          row.citations.length === 1 &&
          row.citations[0]?.id === observedSource.id,
      )
    : undefined;
  const browserFindings = practices.filter((row) => row !== homepageFinding);
  const findingsRows: ObservationRow[] =
    observedSource && measuredDefaultVisit && observedSource.excerpt
      ? [
          {
            source: observedSource,
            title: "Before you choose cookies",
            kind: "Observed",
            detail: summarizeDefaultVisit({
              outside: measuredDefaultVisit.outside,
              noCookies: measuredDefaultVisit.cookies === 0,
              noStorage:
                measuredDefaultVisit.storage?.localEntries === 0 &&
                measuredDefaultVisit.storage.sessionEntries === 0,
            }),
            evidenceLabel: "Default visit evidence",
            quote: homepageFinding?.citations[0]?.quote,
          },
        ]
      : [];
  const pageSource =
    pageDifference && evidenceById.get(pageDifference.evidenceId);
  if (pageSource && pageDifference)
    findingsRows.push({
      source: pageSource,
      title: "Connections beyond the homepage",
      kind: "Observed",
      detail: pageDifference.text,
      evidenceLabel: "Sampled visit evidence",
    });
  for (const item of policyBrief) {
    const source = evidenceById.get(item.source);
    if (source?.kind !== "declared_first_party" || !source.excerpt) continue;
    const title = item.title ?? policyTopicLabels[item.topic];
    findingsRows.push({
      source,
      title: title === "Appointment booking" ? "Optional booking" : title,
      kind: "Policy",
      icon:
        title === "Contact form"
          ? "contact"
          : title === "Appointment booking"
            ? "calendar"
            : undefined,
      detail: item.text,
      quote: item.quote,
      evidenceLabel: title + " policy",
    });
  }
  for (const finding of requestFindings) {
    const source = evidenceById.get(finding.evidenceId);
    if (source)
      findingsRows.push({
        source,
        kind: "Observed",
        title: finding.destination + " · " + visitLabels[finding.scenario],
        detail: finding.text,
        evidenceLabel: "Request field evidence",
      });
  }
  const analyticsSource = analytics && evidenceById.get(analytics.evidenceId);
  if (
    analyticsSource &&
    !findingsRows.some((row) => row.source.id === analyticsSource.id)
  )
    findingsRows.push({
      source: analyticsSource,
      kind: "Policy",
      title: "Site analytics",
      icon: "chart",
      quote: analytics.quote,
      detail: analytics.text,
      evidenceLabel: "Self-hosted analytics policy",
    });
  for (const provider of providerDisclosures) {
    const source = evidenceById.get(provider.evidenceId);
    if (source)
      findingsRows.push({
        source,
        kind: "Provider policy",
        title: provider.section,
        provider: provider.providerHost.replace(/^www\./, ""),
        evidenceLabel:
          provider.excerpt?.match(/^(.{2,52}?)\s+[–—]\s/u)?.[1] ??
          provider.section +
            " · " +
            (providerDisclosures.indexOf(provider) + 1),
        quote: provider.excerpt,
        referringEvidenceId: provider.referringEvidenceId,
      });
  }
  const privacyProfileAdvice = minimizeData && (
    <p className="text-sm text-muted">
      For your privacy profile, skip optional fields and use guest access if
      offered.
    </p>
  );
  const documentChangeDetails = changes && (
    <div>
      <h3>Document changes since the previous report</h3>
      {changes.length ? (
        <ul>
          {changes.map((item) => (
            <li key={item.evidenceId}>
              <a
                className="inline-link"
                href={
                  hasUsableReport ? "#evidence-" + item.evidenceId : item.url
                }
                rel="noreferrer"
              >
                {item.kind} · {new URL(item.url).pathname}
              </a>
              {item.passage && (
                <dl className="my-4 grid gap-3 sm:grid-cols-2 [&>div]:rounded-lg [&>div]:border [&>div]:border-border [&>div]:p-3 [&_dt]:font-semibold">
                  <div>
                    <dt>Before</dt>
                    <dd>{item.passage.before || "No text at this position"}</dd>
                  </div>
                  <div>
                    <dt>After</dt>
                    <dd>{item.passage.after || "No text at this position"}</dd>
                  </div>
                </dl>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>No changes found among documents retrieved in this scan.</p>
      )}
      <p className="text-sm text-muted">
        Document changes alone do not establish a change in site behavior.
      </p>
    </div>
  );
  const scanAction = archived ? (
    <a className="inline-link" href={"/report/" + host}>
      Open the latest report to request a scan
    </a>
  ) : (
    <RequestScan
      domain={host}
      active={scanActive}
      available={scanAvailable}
      label={
        policyOnly
          ? "Run browser scan"
          : current === "failed"
            ? "Retry scan"
            : !report
              ? "Request a scan"
              : "Rescan"
      }
      prominent={!hasUsableReport}
      compact={hasUsableReport}
    />
  );

  return (
    <ReportCitations evidence={report?.evidence} visits={browserVisits}>
      <a
        className="report-return mb-4 inline-flex items-center gap-1 text-sm text-muted"
        href="/#recent-reports"
      >
        <ReportIcon name="back" />
        Recent reports
      </a>
      <div className="report-domain-header mb-5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 sm:gap-x-4">
        <Avatar
          size="sm"
          className="domain-avatar size-9 shrink-0 self-center rounded-none! bg-transparent! sm:mt-1 sm:size-12 sm:self-start"
          aria-hidden="true"
        >
          {siteFavicon ? (
            <Image
              src={siteFavicon}
              alt=""
              width={48}
              height={48}
              unoptimized
              loading="eager"
              className="size-full object-contain"
              onError={() =>
                setFailedFavicons((failed) => [...failed, siteFavicon])
              }
            />
          ) : (
            <Avatar.Fallback>
              <ReportIcon name="globe" />
            </Avatar.Fallback>
          )}
        </Avatar>
        <div className="contents sm:block">
          <h1 className="col-start-2 row-start-1 min-w-0 self-center text-xl! font-semibold! tracking-tight [overflow-wrap:anywhere] sm:text-3xl!">
            {host}
          </h1>
          {score?.score != null && (
            <p className="report-decision col-span-full my-0! text-sm text-foreground sm:my-1!">
              {score.practiceAssessment || score.inventoryAssessment
                ? score.verdict
                : verdict}
            </p>
          )}

          {hasUsableReport && score?.score === null && (
            <p className="report-decision col-span-full my-0! text-sm text-foreground sm:my-1!">
              {score.verdict}
            </p>
          )}
          {report && (
            <div className="report-scan-meta col-span-full flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted [&_.button]:min-h-6 [&_.button]:text-xs">
              {policyOnly && !policyReviewedAt ? (
                <span>Policy reviewed</span>
              ) : (
                <time
                  dateTime={policyOnly ? policyReviewedAt : report.completedAt}
                >
                  {policyOnly
                    ? "Policy reviewed"
                    : archived
                      ? "Selected scan"
                      : "Scanned"}{" "}
                  {new Intl.DateTimeFormat("en", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(
                    new Date(
                      policyOnly ? policyReviewedAt! : report.completedAt,
                    ),
                  )}
                </time>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                {hasUsableReport && (archived || scanAvailable) && scanAction}
                {!archived && <ReportCompare host={host} />}
              </div>
            </div>
          )}
          {scanActive && (
            <p
              role="status"
              className="col-span-full my-0! text-sm text-muted sm:mt-2!"
            >
              {score?.score != null
                ? "Showing the last completed rating. "
                : hasUsableReport && "Showing the previous report. "}
              {current === "queued"
                ? "A new scan is queued."
                : "A scan is running."}
            </p>
          )}
          {hasUsableReport && current === "failed" && (
            <p
              role="status"
              className="col-span-full my-0! text-sm text-muted sm:mt-2!"
            >
              The latest scan failed. Showing the previous report.
            </p>
          )}
        </div>
        {hasUsableReport && score && (
          <section
            className="report-rating-summary col-span-full row-start-2 grid gap-2.5 rounded-2xl bg-[color-mix(in_oklab,var(--rating,var(--muted))_12%,var(--surface))] px-4 py-3 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:w-60 sm:self-start"
            data-rating={grade.toLowerCase()}
            aria-label="Privacy rating"
          >
            {score.score !== null ? (
              <>
                <div className="flex items-end justify-between gap-3">
                  <p className="report-score-number m-0! flex items-baseline gap-0.5 text-[var(--rating,var(--muted))] tabular-nums">
                    <strong className="text-4xl leading-none font-semibold tracking-tighter sm:text-5xl">
                      {score.score}
                    </strong>
                    <span className="text-xs text-muted">/100</span>
                  </p>
                  <div className="grid gap-0.5 pb-0.5 text-right leading-tight">
                    <span className="report-rating-band text-base font-semibold text-[var(--rating,var(--muted))]">
                      {grade}
                    </span>
                    <span className="text-xs whitespace-nowrap text-muted">
                      {headlineLabel}
                    </span>
                  </div>
                </div>
                <div
                  role="meter"
                  aria-label="DataDeal privacy score"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={score.score}
                  aria-valuetext={`${score.score} out of 100, ${grade}`}
                  className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--rating,var(--muted))_18%,transparent)]"
                >
                  <div
                    className="h-full rounded-full bg-[var(--rating,var(--muted))]"
                    style={{ width: Math.max(4, score.score) + "%" }}
                  />
                </div>
                {!score.practiceAssessment &&
                  !score.inventoryAssessment &&
                  !report?.demo && (
                    <span className="text-[.68rem] text-muted">
                      Earlier scoring rules
                    </span>
                  )}
              </>
            ) : (
              <div className="grid gap-0.5">
                <span className="text-xs text-muted">Accept-all rating</span>
                <h2 className="m-0! text-xl font-semibold">Unrated</h2>
              </div>
            )}
          </section>
        )}
      </div>
      {scanActive && currentState && (
        <ScanProgress state={currentState} stages={activeStages} />
      )}
      {!report || !score || !hasUsableReport ? (
        <>
          <EmptyState
            size="lg"
            role="region"
            aria-labelledby="report-availability-title"
          >
            <EmptyState.Header>
              {scanActive && (
                <EmptyState.Media>
                  <Spinner size="sm" aria-label="Scan processing" />
                </EmptyState.Media>
              )}
              <EmptyState.Title id="report-availability-title" aria-level={2}>
                {scanActive
                  ? "Scan in progress"
                  : current === "failed"
                    ? "Scan failed"
                    : report
                      ? "Privacy rating unavailable"
                      : "No report available"}
              </EmptyState.Title>
              <EmptyState.Description>
                {current === "queued"
                  ? "This scan is waiting for a worker."
                  : scanActive
                    ? "DataDeal is gathering public privacy evidence."
                    : current === "failed"
                      ? "The latest scan couldn’t retrieve enough public material."
                      : report
                        ? "DataDeal couldn’t verify enough about how this site handles personal data."
                        : "Run a scan to see how this website handles your data."}
              </EmptyState.Description>
            </EmptyState.Header>
            <EmptyState.Content hidden={scanActive}>
              {scanAction}
            </EmptyState.Content>
          </EmptyState>
          {contentPages && contentPages.pages.length > 0 && (
            <>
              <ReportContentPages
                sample={contentPages}
                homepage={measuredDefaultVisit}
              />
              {sourceSection}
            </>
          )}
          {changes && changes.length > 0 && (
            <>
              {privacyProfileAdvice}
              <Section id="history" title="Scan history">
                <HistoryComparison comparison={comparison} />
                {documentChangeDetails}
              </Section>
            </>
          )}
        </>
      ) : policyOnly ? (
        <>
          {analysisOverview}
          {privacyProfileAdvice}
          <ReportObservations rows={findingsRows} />
          <ContextFindings rows={browserFindings} />
          {findings.some(critical) && (
            <Section title="Critical privacy findings">
              <ul className="space-y-3 [&_li]:grid [&_li]:gap-1 [&_li]:border-b [&_li]:border-separator [&_li]:py-2">
                {findings.filter(critical).map((item) => (
                  <li key={item.title}>
                    <strong>{item.title}</strong>
                    <span>{item.explanation}</span>
                    <SourceLinks item={item} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {contentPages && (
            <ReportContentPages
              sample={contentPages}
              homepage={measuredDefaultVisit}
            />
          )}
          {sourceSection}
          {documentChangeDetails && (
            <Section id="history" title="Scan history">
              <HistoryComparison comparison={comparison} />
              {documentChangeDetails}
            </Section>
          )}
        </>
      ) : (
        <>
          {analysisOverview}
          {/* Below the score and summary, never above them. */}
          <ReportAdvertisement
            path={adUnit}
            limitedPath={limitedAdUnit}
            testAd={testAd}
          />
          {(["left", "right"] as const).map((side) => (
            <ReportAdvertisement
              key={side}
              path={adUnit}
              limitedPath={limitedAdUnit}
              testAd={testAd}
              format="rail"
              side={side}
            />
          ))}
          {privacyProfileAdvice}
          <ReportObservations rows={findingsRows} />
          <ContextFindings rows={browserFindings} />

          {ratingComparison}
          {adPreview && (
            <aside
              className="my-5 rounded-lg bg-surface p-4"
              aria-label="Advertisement placement preview"
            >
              <small>Advertisement placement preview</small>
              <p>Google Ad Manager display placement</p>
            </aside>
          )}
          {!advanced && (
            <>
              {findings.some(critical) && (
                <Section title="Critical privacy findings">
                  <ul>
                    {findings.filter(critical).map((item, index) => (
                      <li key={index}>
                        <strong>{item.title}</strong>
                        <p>{item.explanation}</p>
                        <SourceLinks item={item} />
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {coverageDetails}
              {sourceSection}
              {(advancedAvailable || previousRewardedScan) && (
                <Section title="Advanced report">
                  {previousRewardedScan && (
                    <p>
                      <a
                        className="inline-link"
                        href={`/report/${host}?scan=${previousRewardedScan}`}
                      >
                        Open the earlier report you unlocked
                      </a>
                    </p>
                  )}
                  {advancedAvailable && (
                    <AdvancedPreview
                      graph={
                        <Flow
                          host="Example site"
                          illustrative
                          recipients={[
                            "First-party host",
                            "Booking service",
                            "Analytics service",
                          ].map((label) => ({
                            label,
                            explanation: "Illustrative service",
                            evidenceIds: [],
                            declared: true,
                          }))}
                        />
                      }
                      reward={
                        rewardTest ? (
                          <RewardedAdTest {...rewardTest} />
                        ) : undefined
                      }
                    />
                  )}
                </Section>
              )}
            </>
          )}
          {advanced && (
            <>
              {contentPages && (
                <ReportContentPages
                  sample={contentPages}
                  homepage={measuredDefaultVisit}
                />
              )}
              {policyTopics.length > 0 && (
                <Section title="Topics in the privacy policy">
                  <p className="text-sm text-muted">
                    Where the privacy policy talks about each topic. Open a
                    section to read the quoted passages.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(policyTopicLabels).map(([topic, label]) => {
                      // One row per policy section; a long section can supply
                      // several excerpts for the same topic.
                      const sections = new Map<
                        string,
                        { id: string; count: number }
                      >();
                      for (const source of policyTopics)
                        if (source.topic === topic) {
                          const entry = sections.get(source.heading);
                          if (entry) entry.count++;
                          else
                            sections.set(source.heading, {
                              id: source.id,
                              count: 1,
                            });
                        }
                      if (!sections.size) return null;
                      return (
                        <section
                          key={topic}
                          className="rounded-2xl border border-separator p-2"
                          aria-label={label}
                        >
                          <h3 className="m-0! px-2 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                            {label}
                          </h3>
                          <ul className="m-0! list-none p-0!">
                            {[...sections].map(([heading, { id, count }]) => (
                              <li key={heading}>
                                <a
                                  className="group flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 text-sm text-foreground no-underline hover:bg-default/60 focus-visible:outline-2 focus-visible:outline-focus"
                                  href={"#evidence-" + id}
                                >
                                  <span className="min-w-0 flex-1 group-hover:underline">
                                    {heading}
                                  </span>
                                  {count > 1 && (
                                    <span className="shrink-0 rounded-full bg-default px-2 py-0.5 text-xs text-muted">
                                      {count} passages
                                    </span>
                                  )}
                                  <span
                                    aria-hidden="true"
                                    className="shrink-0 text-muted"
                                  >
                                    ›
                                  </span>
                                </a>
                              </li>
                            ))}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                </Section>
              )}
              {hasChoiceVisit && (
                <Section title="Consent comparison">
                  {postChoiceComparison}
                  <p className="text-sm text-muted">
                    Each row covers a whole homepage visit, including activity
                    before a choice. Outside domains can belong to the same
                    operator.
                  </p>
                  <ConsentTable
                    label="Observed consent scenarios and end-of-visit measurements"
                    rows={measuredChoices.map(([scenario, label]) => {
                      const visit = browserVisits.find(
                        (item) => item.scenario === scenario,
                      );
                      return {
                        label,
                        outside: visit?.outside,
                        cookies: visit?.cookies,
                        source: visit?.id,
                      };
                    })}
                  />
                  {controls && (
                    <p>
                      {controls.confidence === "low"
                        ? "The homepage markup includes a reject option."
                        : "The scan identified a reject control."}
                    </p>
                  )}
                </Section>
              )}
              {coverageDetails}
              <Section title="Where your data flows">
                <Flow
                  key={report.id}
                  host={host}
                  favicon={siteFavicon}
                  recipients={flowDestinations}
                />
              </Section>
              {report.policyClaims?.length ? (
                <Section title="What the privacy policy says">
                  <ul>
                    {report.policyClaims.map((claim) => (
                      <li key={`${claim.source}-${claim.text}`}>
                        <strong>
                          {
                            {
                              recipient: "Recipient",
                              purpose: "Purpose",
                              data_category: "Data collected",
                              retention: "How long data is kept",
                            }[claim.category]
                          }
                        </strong>
                        <p>{claim.text}</p>
                        <ProviderDisclosure
                          label={`Policy evidence · ${claim.confidence} confidence`}
                        >
                          <blockquote>{claim.quote}</blockquote>
                          <a
                            className="inline-link"
                            href={`#evidence-${claim.source}`}
                            data-citation-quote={claim.quote}
                          >
                            View source
                          </a>
                        </ProviderDisclosure>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
              <Section title="Detected services and infrastructure">
                {recipients.length ? (
                  <ul className="space-y-2 [&_li]:border-b [&_li]:border-separator [&_li]:py-2 [&_li]:target:bg-accent/10 [&_summary]:cursor-pointer">
                    {recipients.map((item) => (
                      <li key={item.rule}>
                        <strong>
                          {item.rule === "necessary_processor"
                            ? "Hosting provider"
                            : "Advertising network"}
                        </strong>
                        <Severity severity={item.severity} />
                        <p>{item.explanation}</p>
                      </li>
                    ))}
                  </ul>
                ) : !resourceEvidence &&
                  !routingEvidence &&
                  !flowDestinations.length ? (
                  <p>No service inventory is available for this scan.</p>
                ) : null}
                {flowDestinations.some(({ declared }) => declared) && (
                  <ProviderDisclosure label="Services named in the privacy policy">
                    <ul className="space-y-2 [&_li]:border-b [&_li]:border-separator [&_li]:py-2 [&_li]:target:bg-accent/10 [&_summary]:cursor-pointer">
                      {flowDestinations
                        .filter(({ declared }) => declared)
                        .map((item) => (
                          <li key={item.label}>
                            <strong>{item.label}</strong>
                            <SourceLinks
                              item={{
                                evidenceIds: item.evidenceIds.filter(
                                  (id) =>
                                    !item.visits?.some(
                                      ({ evidenceId }) => evidenceId === id,
                                    ),
                                ),
                              }}
                            />
                          </li>
                        ))}
                    </ul>
                  </ProviderDisclosure>
                )}
                {attemptedDestinations.size > 0 && (
                  <ProviderDisclosure
                    label={`External domains observed in browser visits (${attemptedDestinations.size})`}
                  >
                    <p>
                      This inventory comes from the visits DataDeal could
                      measure. A request or response alone does not establish
                      the purpose of the request or what data was sent.
                    </p>
                    <ul className="space-y-2 [&_li]:border-b [&_li]:border-separator [&_li]:py-2 [&_li]:target:bg-accent/10 [&_summary]:cursor-pointer">
                      {[...attemptedDestinations]
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([domain, visits]) => (
                          <li key={domain}>
                            <strong>{domain}</strong>
                            <DestinationVisits visits={visits} />
                          </li>
                        ))}
                    </ul>
                  </ProviderDisclosure>
                )}
                {routingEvidence?.observation?.type === "dns_cname" && (
                  <>
                    <h3>DNS routing aliases</h3>
                    <ul className="space-y-2 [&_li]:border-b [&_li]:border-separator [&_li]:py-2 [&_li]:target:bg-accent/10 [&_summary]:cursor-pointer">
                      {routingEvidence.observation.targets.map((target) => (
                        <li key={target}>{target}</li>
                      ))}
                    </ul>
                    <p>
                      Routing aliases do not establish where personal data is
                      stored.
                    </p>
                    <a href={"#evidence-" + routingEvidence.id}>
                      View DNS evidence
                    </a>
                  </>
                )}
                {resourceEvidence?.observation?.type ===
                  "html_resource_hosts" && (
                  <>
                    <h3>Hosts referenced in homepage HTML</h3>
                    <p>
                      Script and iframe tags referenced these hosts. A reference
                      alone does not show what data a browser sends.
                    </p>
                    <ul className="space-y-2 [&_li]:border-b [&_li]:border-separator [&_li]:py-2 [&_li]:target:bg-accent/10 [&_summary]:cursor-pointer">
                      {resourceEvidence.observation.hosts.map((hostname) => (
                        <li key={hostname}>{hostname}</li>
                      ))}
                    </ul>
                    <a href={"#evidence-" + resourceEvidence.id}>
                      View source evidence
                    </a>
                  </>
                )}
              </Section>
              {!score.practiceAssessment && !score.inventoryAssessment && (
                <Section title="Detailed findings">
                  {findings.length ? (
                    <Accordion
                      allowsMultipleExpanded
                      defaultExpandedKeys={disclosureIds}
                      className="privacy-findings"
                    >
                      {findings.map((item, index) => (
                        <Accordion.Item key={index} id={"finding-" + index}>
                          <Accordion.Heading>
                            <Accordion.Trigger className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-start">
                              <span>{item.title}</span>
                              <Severity severity={item.severity} />
                              <Accordion.Indicator />
                            </Accordion.Trigger>
                          </Accordion.Heading>
                          <Accordion.Panel>
                            <Accordion.Body>
                              <p>{item.explanation}</p>
                              <p className="text-sm text-muted">
                                {item.confidence} confidence
                              </p>
                              <SourceLinks item={item} />
                            </Accordion.Body>
                          </Accordion.Panel>
                        </Accordion.Item>
                      ))}
                    </Accordion>
                  ) : (
                    <p>No scored findings are available for this scan.</p>
                  )}
                </Section>
              )}
              {policyDocuments.length > 0 && (
                <PublicSources
                  title="Sources"
                  evidence={policyDocuments}
                  privacyDocumentIds={privacyDocumentIds}
                />
              )}
              <Section title="Evidence">
                {technicalSources.length ? (
                  <ul className="space-y-2 [&_li]:border-b [&_li]:border-separator [&_li]:py-2 [&_li]:target:bg-accent/10 [&_summary]:cursor-pointer">
                    {technicalSources.map((source) => (
                      <li key={source.id} id={"evidence-" + source.id}>
                        <div>
                          <h3>
                            {source.observation?.type === "policy_section"
                              ? source.observation.heading
                              : source.id}{" "}
                            · {source.kind.replaceAll("_", " ")}
                          </h3>
                          <p>{source.excerpt}</p>
                          {source.observation?.type ===
                            "browser_consent_counts" && (
                            <p>
                              {inspectionSummary(
                                source.observation.requestInspection,
                              )}
                            </p>
                          )}
                          {source.observation?.type ===
                            "browser_consent_counts" &&
                            source.observation.afterChoice && (
                              <p>
                                Requests from the consent click to the end of
                                observation:{" "}
                                {source.observation.afterChoice.requests}.
                                {source.observation.afterChoice.externalDomains
                                  .length > 0 && (
                                  <>
                                    {" "}
                                    External destinations in that interval:{" "}
                                    {source.observation.afterChoice.externalDomains.join(
                                      ", ",
                                    )}
                                    .
                                  </>
                                )}
                              </p>
                            )}
                          {source.observation?.type ===
                            "browser_consent_counts" &&
                            source.observation.externalDomains.length > 0 && (
                              <>
                                <p>External domains with attempted requests</p>
                                <ul>
                                  {source.observation.externalDomains.map(
                                    (hostname) => (
                                      <li key={hostname}>
                                        {hostname}
                                        {source.observation?.type ===
                                          "browser_consent_counts" &&
                                          source.observation.responseDomains?.includes(
                                            hostname,
                                          ) &&
                                          " · HTTP response observed"}
                                      </li>
                                    ),
                                  )}
                                </ul>
                              </>
                            )}
                          {source.observation?.type ===
                            "response_cookie_attributes" && (
                            <dl className="review-factors my-3 divide-y divide-separator [&>div]:grid [&>div]:grid-cols-[1fr_auto] [&>div]:items-baseline [&>div]:gap-3 [&>div]:py-2 [&_dd]:tabular-nums [&_[data-impact=positive]_dd]:text-success [&_[data-impact=negative]_dd]:text-warning">
                              <div>
                                <dt>Set-Cookie headers</dt>
                                <dd>{source.observation.count}</dd>
                              </div>
                              <div>
                                <dt>Secure</dt>
                                <dd>{source.observation.secure}</dd>
                              </div>
                              <div>
                                <dt>HttpOnly</dt>
                                <dd>{source.observation.httpOnly}</dd>
                              </div>
                              <div>
                                <dt>Recognized SameSite value</dt>
                                <dd>{source.observation.sameSite}</dd>
                              </div>
                            </dl>
                          )}
                          <p className="text-sm text-muted">
                            Retrieved {source.retrievedAt.slice(0, 10)} UTC
                          </p>
                        </div>
                        {source.url && (
                          <a
                            className="inline-link"
                            href={source.url}
                            rel="noreferrer"
                          >
                            Open source
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No source material was retrieved.</p>
                )}
              </Section>
              <Section id="history" title="Scan history">
                <ScoreHistoryChart
                  data={history
                    .slice()
                    .reverse()
                    .map(({ date, rating }) => ({
                      date,
                      score:
                        rating && sameScoringRules(rating, score)
                          ? rating.score
                          : null,
                    }))}
                />
                {score.score !== null &&
                  history.some(
                    ({ rating }) =>
                      rating &&
                      rating.score !== null &&
                      !sameScoringRules(rating, score),
                  ) && (
                    <p>
                      Some scans used different scoring rules. A change in score
                      across versions may reflect a change in methodology.
                    </p>
                  )}
                {archived && (
                  <p>
                    <a className="inline-link" href={"/report/" + host}>
                      View latest scan
                    </a>
                  </p>
                )}
                <HistoryComparison comparison={comparison} />
                {documentChangeDetails}
                {history.length ? (
                  <Timeline density="compact" size="sm">
                    {history.map((item, index) => {
                      const prior = history
                        .slice(index + 1)
                        .find(({ rating }) => rating !== undefined)?.rating;
                      const delta =
                        item.rating?.score != null &&
                        prior?.score != null &&
                        sameScoringRules(item.rating, prior)
                          ? item.rating.score - prior.score
                          : null;
                      return (
                        <Timeline.Item
                          key={item.id}
                          status={item.id === report.id ? "current" : "default"}
                        >
                          <Timeline.Rail>
                            <Timeline.Marker aria-hidden="true" />
                            <Timeline.Connector />
                          </Timeline.Rail>
                          <Timeline.Content>
                            <time dateTime={item.date}>
                              {item.date.slice(0, 10)}
                            </time>{" "}
                            · {item.state.replaceAll("_", " ")}
                            {item.rating && (
                              <>
                                {" "}
                                <Chip size="sm" variant="soft">
                                  <Chip.Label>
                                    {item.rating.score === null
                                      ? item.rating.grade
                                      : `${item.rating.score}/100 · ${item.rating.grade}`}
                                  </Chip.Label>
                                </Chip>
                                <span className="text-sm text-muted">
                                  {" · Methodology " +
                                    item.rating.methodologyVersion}
                                  {item.rating.rulesRevision &&
                                    " · Rules revision " +
                                      item.rating.rulesRevision}
                                </span>
                                {delta !== null && (
                                  <span className="text-sm text-muted">
                                    {" "}
                                    · {delta > 0 ? "+" : ""}
                                    {delta} points
                                  </span>
                                )}
                              </>
                            )}
                            {item.rating && item.id !== report.id && (
                              <>
                                {" "}
                                ·{" "}
                                <a
                                  className="inline-link"
                                  href={"?scan=" + item.id}
                                >
                                  View scan
                                </a>
                              </>
                            )}
                          </Timeline.Content>
                        </Timeline.Item>
                      );
                    })}
                  </Timeline>
                ) : (
                  <p>{report.completedAt.slice(0, 10)} · Scan completed</p>
                )}
              </Section>
            </>
          )}
        </>
      )}
    </ReportCitations>
  );
}
