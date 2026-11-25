import { cookies, headers } from "next/headers";

import { auth } from "../../../lib/auth";
import { notFound } from "next/navigation";
import { domain, scanReport } from "@datadeal/contracts";
import { database, demoMode, lookup } from "../../../lib/reports";
import { ReportContent } from "./report-content";
import {
  evaluate,
  evaluateHeadline,
  verifiedAcceptAllRating,
  verifiedRejectRating,
} from "@datadeal/scoring";
import { changedScoreDrivers, documentChanges } from "../../../lib/history";
import { compareVisitDestinations } from "../../../lib/visit-history";
import { comparePolicyDisclosures } from "../../../lib/policy-history";
import { practiceTakeaways } from "../../../lib/practice-takeaways";
import {
  acceptAllHomepage,
  visitorSummary,
} from "../../../lib/visitor-summary";
import { publicPolicyHighlights } from "../../../lib/policy-highlights";
import { limitedDisplayUnit } from "../../../lib/ads/inventory";
import { acceptedExposureSummary } from "../../../lib/accepted-exposure";
import {
  publicReportEvidence,
  withPracticeEvidenceExcerpts,
} from "../../../lib/public-report-evidence";
import {
  compareConsentDestinations,
  consentChoiceTakeaway,
} from "../../../lib/consent-comparison";
import { isPublicWarning } from "../../../lib/public-warnings";
import { publicContentPageDifference } from "../../../lib/content-page-difference";
import { publicContentPageSample } from "../../../lib/content-pages";
import {
  defaultVisitEvidence,
  hasAdvancedSnapshotDetails,
} from "../../../lib/browser-summary";
import {
  hasLocalReward,
  guestReportHolders,
  localRewardCookie,
  localRewardEnabled,
  localPointsEnabled,
  localRewardHolder,
} from "../../../lib/local-reward";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{
    scan?: string | string[];
    "ad-preview"?: string;
    "ad-test"?: string;
  }>;
}) {
  const parsed = domain.safeParse((await params).domain);
  if (!parsed.success) notFound();
  const {
    host,
    report: latest,
    score: latestScore,
    history,
  } = await lookup(parsed.data);
  const query = await searchParams;
  const scan = query.scan;
  const published = history.flatMap((row) =>
    (row.state === "completed" || row.state === "partially_completed") &&
    row.report &&
    (demoMode || !row.report.demo)
      ? [scanReport.parse(row.report)]
      : [],
  );
  if (
    scan !== undefined &&
    (typeof scan !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(scan))
  )
    notFound();
  const archivedReports =
    scan && database
      ? await database.archivedReports(host, scan, demoMode)
      : [];
  const report =
    scan === undefined
      ? latest
      : archivedReports[0]
        ? scanReport.parse(archivedReports[0].report)
        : undefined;
  if (scan !== undefined && !report) notFound();
  const headline = report ? evaluateHeadline(report) : undefined;
  const score = headline?.rating ?? latestScore;
  const accepted = report && verifiedAcceptAllRating(report);
  const rejected = report && verifiedRejectRating(report);
  const defaultScore = report && evaluate(report);
  const position = published.findIndex((item) => item.id === report?.id);
  const session = await auth?.api.getSession({ headers: await headers() });
  const pro =
    session && database ? await database.hasPro(session.user.id) : false;
  const rewardCookies = report && localRewardEnabled() ? await cookies() : null;
  const localRewardValue = report
    ? rewardCookies?.get(localRewardCookie(report.id))?.value
    : undefined;
  const rewardHolder = report && localRewardHolder(report.id, localRewardValue);
  const localReward = Boolean(
    report &&
    ((rewardHolder &&
      (await database?.hasScanReward(report.id, rewardHolder))) ||
      hasLocalReward(report.id, localRewardValue)),
  );
  const accountReward =
    !pro && session && database && report && !report.demo
      ? await database.hasScanReward(report.id, {
          kind: "user",
          userId: session.user.id,
        })
      : false;
  const previousGuests =
    !pro &&
    !localReward &&
    !accountReward &&
    report &&
    !report.demo &&
    report.id === latest?.id &&
    rewardCookies
      ? guestReportHolders(rewardCookies.getAll()).filter(
          (entry) => entry.scanId !== report.id,
        )
      : [];
  const scanReward = localReward || accountReward;
  const advanced =
    pro ||
    scanReward ||
    (process.env.DATADEAL_BROWSER_TEST === "true" && report?.demo === true);
  const showHistory = advanced && (!scanReward || pro);
  let previous =
    scan !== undefined
      ? archivedReports[1] && scanReport.parse(archivedReports[1].report)
      : position >= 0
        ? published[position + 1]
        : undefined;
  if (
    showHistory &&
    report &&
    !previous &&
    database &&
    scan === undefined &&
    history.length === 20
  ) {
    const [, older] = await database.archivedReports(host, report.id, demoMode);
    if (older) previous = scanReport.parse(older.report);
  }
  const comparison =
    showHistory && report && previous
      ? {
          score: changedScoreDrivers(previous, report),
          destinations: compareVisitDestinations(previous, report),
          policy: comparePolicyDisclosures(previous, report),
        }
      : undefined;
  const previousRewardedScan =
    !advanced && scan === undefined && report && !report.demo && (session || previousGuests.length)
      ? await database?.previousRewardedScan(
          host,
          report.id,
          session?.user.id ?? null,
          previousGuests,
        )
      : undefined;
  function visibleRating(rating: typeof score) {
    if (advanced || !rating) return rating;
    return {
      ...rating,
      practiceAssessment: rating.practiceAssessment && {
        coverage: rating.practiceAssessment.coverage,
        ratings: [...rating.practiceAssessment.ratings]
          .sort((a, b) => (a.score ?? 101) - (b.score ?? 101))
          .filter(
            (row, index) => index < 3 || (row.score != null && row.score < 60),
          ),
      },
      adjustments: rating.adjustments.filter(
        (item, index) =>
          index < 5 || item.adjustment !== 0 || isPublicWarning(item),
      ),
    };
  }
  const publicScore = visibleRating(score);
  const summary = visitorSummary(report);
  const acceptedHomepage = acceptAllHomepage(report);
  const practices = practiceTakeaways(
    report,
    headline?.scenario ?? "default",
    { default: defaultScore, accepted, rejected },
    Boolean(advanced),
  );
  const otherWarnings = Object.entries({
    default: defaultScore,
    accepted,
    rejected,
  }).flatMap(([scenario, rating]) =>
    scenario === headline?.scenario
      ? []
      : (rating?.adjustments.filter(isPublicWarning) ?? []),
  );
  const consentDifference = compareConsentDestinations(report);
  const consentTakeaway =
    acceptedExposureSummary(
      defaultScore ?? null,
      accepted,
      new Map(report?.evidence.map((source) => [source.id, source])),
      report?.id,
    ) ?? consentChoiceTakeaway(report, consentDifference);
  const policyHighlights = report ? publicPolicyHighlights(report) : [];

  const defaultVisit = defaultVisitEvidence(report);
  const sampledPages = publicContentPageSample(report);
  const pageDifference = publicContentPageDifference(
    sampledPages,
    defaultVisit?.observation?.type === "browser_consent_counts"
      ? {
          id: defaultVisit.id,
          outside: defaultVisit.observation.externalDomains.length,
        }
      : undefined,
  );
  const publicReport =
    !advanced && report
      ? {
          ...report,
          dataPractices: undefined,
          rejectedScoring: undefined,
          pageSample: undefined,
          scoring: undefined,
          scoringCorrection: undefined,
          acceptAllScoring: undefined,
          policyClaims: undefined,
          findings: [],
          evidence: publicReportEvidence(
            report,
            [
              ...summary.claims.flatMap((c) => c.sources.map((s) => s.source)),
              ...(acceptedHomepage ? [acceptedHomepage.source.id] : []),
              ...(pageDifference ? [pageDifference.evidenceId] : []),
              ...policyHighlights.map(({ source }) => source),
              ...practices.flatMap((practice) =>
                practice.citations.map((citation) => citation.id),
              ),
              ...(publicScore?.practiceAssessment?.ratings.flatMap(
                (row) => row.evidenceIds,
              ) ?? []),
              ...(consentTakeaway ? [consentTakeaway.evidenceId] : []),
              ...(consentTakeaway?.beforeChoiceEvidenceId
                ? [consentTakeaway.beforeChoiceEvidenceId]
                : []),
              ...otherWarnings.flatMap((item) => item.evidenceIds),
              ...(publicScore?.adjustments.flatMap(
                (item) => item.evidenceIds,
              ) ?? []),
            ],
            [
              ...practices.map((row) => row.factId),
              ...(publicScore?.practiceAssessment?.ratings.map(
                (row) => row.factId,
              ) ?? []),
              ...(summary.factId ? [summary.factId] : []),
            ],
          ),
        }
      : report && {
          ...withPracticeEvidenceExcerpts(report, [
            ...practices.map((row) => row.factId),
            ...[defaultScore, accepted, rejected].flatMap(
              (rating) =>
                rating?.practiceAssessment?.ratings.map((row) => row.factId) ??
                [],
            ),
            ...(summary.factId ? [summary.factId] : []),
          ]),
          acceptAllScoring: accepted,
          rejectedScoring: rejected,
        };
  const minimizeData = Boolean(
    pro &&
    session &&
    database &&
    (await database.privacyProfile(session.user.id)) === "data_minimization",
  );
  const testAd = Boolean(
    report &&
    !report.demo &&
    !pro &&
    process.env.NODE_ENV === "development" &&
    (query["ad-test"] === "1" ||
      process.env.DATADEAL_LOCAL_SAMPLE_ADS === "true"),
  );
  const configuredAdUnit = testAd
    ? "/6355419/Travel/Europe/France/Paris"
    : pro
      ? undefined
      : process.env.DATADEAL_GOOGLE_AD_UNIT;
  const adUnit =
    !report?.demo &&
    configuredAdUnit &&
    /^\/[0-9]+(?:,[0-9]+)?(?:\/[A-Za-z0-9_.-]+)+$/.test(configuredAdUnit)
      ? configuredAdUnit
      : undefined;
  const current = history[0]?.state;
  const activeStages =
    !scan && current === "fetching"
      ? await database?.activeScanStages(history[0].id)
      : undefined;
  const browserVisits = (report?.evidence ?? []).flatMap((source) =>
    source.scanId === report?.id &&
    source.kind === "observed_technical" &&
    source.consentScenario &&
    source.observation?.type === "browser_consent_counts" &&
    source.observation.finalPageKnown !== false &&
    (!report?.consentCoverage ||
      report.consentCoverage[source.consentScenario] === "measured") &&
    source.observation.requests > 0
      ? [
          {
            id: source.id,
            scenario: source.consentScenario,
            url: source.url,
            finalPageKnown: source.observation.finalPageKnown,
            requests: source.observation.requests,
            cookies: source.observation.cookies,
            storage: source.observation.storage,
            requestInspection: source.observation.requestInspection,
            outside: source.observation.externalDomains.length,
          },
        ]
      : [],
  );
  const displayedReport =
    publicReport && (consentTakeaway || (advanced && consentDifference))
      ? {
          ...publicReport,
          evidence: publicReport.evidence.map((row) => {
            const detail =
              advanced &&
              consentDifference?.sources.find((item) => item.id === row.id);
            const excerpt = detail
              ? detail.excerpt
              : consentTakeaway?.evidenceId === row.id
                ? consentTakeaway.text
                : undefined;
            return excerpt
              ? { ...row, excerpt: row.excerpt + " " + excerpt }
              : row;
          }),
        }
      : publicReport;
  const snapshotDetails = hasAdvancedSnapshotDetails(report);
  const historicalScores = new Map(
    published.map((snapshot) => {
      const { grade, score, methodologyVersion, rulesRevision, baseScore } =
        evaluateHeadline(snapshot).rating;
      return [
        snapshot.id,
        { grade, score, methodologyVersion, rulesRevision, baseScore },
      ] as const;
    }),
  );
  return (
    <article className="privacy-report mx-auto w-full max-w-[50rem] py-6 sm:py-9">
      <ReportContent
        host={host}
        report={displayedReport}
        consentDifference={advanced ? consentDifference : undefined}
        practices={practices}
        summaryClaims={summary.claims}
        acceptAllVisitId={acceptedHomepage?.source.id}
        otherWarnings={otherWarnings}
        policyHighlights={policyHighlights}
        score={publicScore}
        defaultScore={advanced ? defaultScore : undefined}
        headlineScenario={headline?.scenario}
        advanced={Boolean(advanced)}
        browserVisits={
          advanced
            ? browserVisits
            : browserVisits.filter(
                (visit) =>
                  visit.scenario === "default" ||
                  visit.id === acceptedHomepage?.source.id,
              )
        }
        contentPages={advanced ? sampledPages : undefined}
        pageDifference={pageDifference}
        advancedAvailable={
          snapshotDetails || Boolean(!report?.demo && defaultVisit && previous)
        }
        defaultBrowserObserved={Boolean(defaultVisit)}
        adPreview={
          !adUnit &&
          !pro &&
          process.env.NODE_ENV === "development" &&
          query["ad-preview"] === "1"
        }
        activeStages={activeStages}
        current={
          scan === undefined || report?.id === latest?.id ? current : undefined
        }
        scanAvailable={Boolean(database)}
        previousRewardedScan={previousRewardedScan}
        limitedAdUnit={!pro && !report?.demo ? limitedDisplayUnit() : undefined}
        adUnit={adUnit}
        testAd={testAd}
        rewardTest={
          testAd &&
          localRewardEnabled() &&
          report &&
          snapshotDetails &&
          scan === undefined
            ? {
                host,
                scanId: report.id,
                game: localPointsEnabled(),
                signedIn: Boolean(session),
              }
            : undefined
        }
        minimizeData={minimizeData}
        archived={scan !== undefined && report?.id !== latest?.id}
        comparison={comparison}
        changes={
          showHistory && report && previous
            ? documentChanges(previous, report)
            : null
        }
        history={
          showHistory
            ? history.map((row) => ({
                id: row.id,
                date: row.requestedAt.toISOString(),
                state: row.state,
                rating: historicalScores.get(row.id),
              }))
            : []
        }
      />
      {pro && report && !report.demo && (
        <div className="mt-6">
          <a
            className="inline-link"
            href={`/api/v1/domains/${host}/export?scan=${report.id}`}
          >
            Download report as JSON
          </a>
        </div>
      )}
    </article>
  );
}
