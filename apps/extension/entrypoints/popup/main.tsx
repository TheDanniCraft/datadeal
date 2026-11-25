import {
  Alert,
  Button,
  Card,
  Chip,
  Disclosure,
  Link,
  buttonVariants,
} from "@heroui/react";
import { comparableReport, publishPopupRating } from "../../lib/popup-rating";
import { createRoot } from "react-dom/client";
import { useEffect, useState, type ReactNode } from "react";
import { browser } from "wxt/browser";
import { FormReminderPreference } from "./form-reminder-preference";
import {
  domainLookup,
  isActiveScan,
  privacyPreference,
  scenarioLabel,
  noChoiceVisitLabel,
  type DomainLookup,
} from "@datadeal/contracts";
import "./style.css";

declare const DATADEAL_REPORT_ORIGIN: string;
const origin = DATADEAL_REPORT_ORIGIN;

function SourceLink({
  reportUrl,
  scanId,
  evidenceId,
  label,
  children = "Source",
}: {
  reportUrl: string;
  scanId?: string | null;
  evidenceId?: string;
  label: string;
  children?: string;
}) {
  if (!scanId || !evidenceId) return null;
  const url = new URL(reportUrl);
  url.searchParams.set("scan", scanId);
  url.hash = "evidence-" + encodeURIComponent(evidenceId);
  return (
    <>
      {" "}
      <Link
        className="text-xs font-medium text-(--popup-link)! underline underline-offset-2"
        href={url.href}
        target="_blank"
        rel="noreferrer"
        aria-label={label}
      >
        {children}
      </Link>
    </>
  );
}

function FindingDetails({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Disclosure>
      <Disclosure.Heading>
        <Button
          slot="trigger"
          size="sm"
          variant="tertiary"
          className="w-full justify-between"
        >
          {title}
          <Disclosure.Indicator />
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="space-y-2 pt-2 text-sm leading-relaxed">
          {children}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}

function Popup() {
  const [host, setHost] = useState<string | null>(null);
  const [result, setResult] = useState<DomainLookup | null>(null);
  const [message, setMessage] = useState("Checking the active website…");
  const [minimizeData, setMinimizeData] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pollingStarted = Date.now();
    let tabId: number | undefined;

    async function refresh(domain: string) {
      const response = await fetch(
        origin + "/api/v1/domains/" + encodeURIComponent(domain),
        {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(5000),
          ]),
        },
      );
      if (!response.ok) throw new Error("Lookup failed");
      const parsed = domainLookup.parse(await response.json());
      if (controller.signal.aborted) return;
      setResult({ ...parsed, report: comparableReport(parsed.report) });
      if (tabId !== undefined) void publishPopupRating(tabId, domain, parsed);
      if (isActiveScan(parsed.state)) {
        const progress =
          parsed.state === "queued" ? "Scan queued." : "Scan in progress.";
        setMessage(
          parsed.report ? progress + " Showing the previous report." : progress,
        );
        if (Date.now() - pollingStarted < 60_000) {
          timer = setTimeout(() => void refresh(domain).catch(showError), 4000);
        } else {
          setMessage(
            parsed.report
              ? "Scan still in progress. Showing the previous report."
              : "Scan still in progress. Open the report for updates.",
          );
        }
      } else if (parsed.state === "failed") {
        setMessage(
          parsed.report
            ? "The latest scan failed. Showing the previous report."
            : "The latest scan failed.",
        );
      } else {
        setMessage(
          parsed.latestUnratedScan
            ? "The newer scan gathered too little evidence for a rating. Showing the last rated report."
            : parsed.report
              ? ""
              : "No report available yet.",
        );
      }
    }

    function showError() {
      if (!controller.signal.aborted)
        setMessage("Could not reach DataDeal. Open the report to try again.");
    }

    async function syncPrivacyProfile() {
      const response = await fetch(origin + "/api/v1/account/privacy-profile", {
        cache: "no-store",
        credentials: "include",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) return;
      const profile = privacyPreference.safeParse(await response.json());
      if (!controller.signal.aborted && profile.success)
        setMinimizeData(profile.data === "data_minimization");
    }

    async function load() {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      const url = tab?.url ? new URL(tab.url) : null;
      const domain =
        url && ["http:", "https:"].includes(url.protocol)
          ? (await import("tldts")).getDomain(url.hostname, {
              allowPrivateDomains: true,
            })
          : null;
      if (!tab || !domain) {
        setMessage("Open a public website to see its report.");
        return;
      }
      if (controller.signal.aborted) return;
      tabId = tab.incognito ? undefined : tab.id;
      setHost(domain);
      void syncPrivacyProfile().catch(() => {});
      await refresh(domain);
    }

    void load().catch(showError);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  const report = result?.report;
  const reportUrl = origin + "/report/" + encodeURIComponent(host ?? "");
  const openReport = (
    <Link
      className={buttonVariants({
        variant: report ? "secondary" : "primary",
        size: "sm",
        className: report
          ? "ml-auto text-foreground! no-underline"
          : "w-full text-accent-foreground! no-underline",
      })}
      target="_blank"
      rel="noreferrer"
      href={reportUrl}
    >
      {!result || result.report
        ? "Open report"
        : isActiveScan(result?.state)
          ? "Open scan status"
          : "Open DataDeal to request a scan"}
      <Link.Icon aria-hidden="true" />
    </Link>
  );
  return (
    <>
      <header className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
        <img src="/icon/32.png" alt="" width={24} height={24} />
        <h1 className="text-sm font-semibold tracking-tight">DataDeal</h1>
        {report && openReport}
      </header>
      <main className="grid gap-3 p-4">
        {host && (
          <Card className="gap-0 p-4 shadow-none">
            <Card.Content className="report-heading grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
              <h2 className="wrap-anywhere text-xl font-semibold leading-tight tracking-tight">
                {host}
              </h2>
              {report && (
                <div
                  data-rating={report.grade.toLowerCase()}
                  className="row-span-3 grid justify-items-end gap-1 text-(--rating,var(--popup-muted))"
                >
                  {report.score !== null && (
                    <span className="score text-[2rem] leading-none font-semibold tracking-tight tabular-nums">
                      {report.score}
                      <small className="ml-0.5 text-xs font-normal tracking-normal text-(--popup-muted)">
                        /100
                      </small>
                    </span>
                  )}
                  <Chip
                    size="sm"
                    variant="soft"
                    className="bg-[color-mix(in_oklch,currentColor_10%,transparent)] text-inherit"
                  >
                    {report.score === null ? "Unrated" : report.grade}
                  </Chip>
                  {report.score != null && report.headlineScenario && (
                    <small className="text-xs text-(--popup-muted)">
                      {report.noChoiceVisit
                        ? noChoiceVisitLabel
                        : scenarioLabel[report.headlineScenario]}
                    </small>
                  )}
                </div>
              )}
              {report && (
                <p className="text-sm leading-snug">{report.verdict}</p>
              )}
              {report && (
                <p className="mt-1.5 text-xs text-(--popup-muted)">
                  {report.confidence} confidence ·{" "}
                  <time dateTime={report.completedAt}>
                    {report.completedAt.slice(0, 10)}
                  </time>{" "}
                  UTC
                </p>
              )}
            </Card.Content>
          </Card>
        )}
        <p className="text-sm text-(--popup-muted) empty:hidden" role="status">
          {message}
        </p>
        {report && (
          <>
            {report.warnings.length > 0 && (
              <Alert
                status="warning"
                className="warnings items-start rounded-xl bg-[color-mix(in_oklch,var(--rating-concerning)_8%,var(--surface))] p-3"
                aria-labelledby="warnings-heading"
              >
                <Alert.Indicator className="text-(--rating-concerning)" />
                <Alert.Content>
                  <Alert.Title id="warnings-heading" className="text-sm">
                    Privacy warnings
                  </Alert.Title>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-snug marker:text-(--rating-concerning)">
                    {report.warnings.map((warning, index) => (
                      <li key={index}>
                        {warning}
                        <SourceLink
                          reportUrl={reportUrl}
                          scanId={report.scanId}
                          evidenceId={
                            report.warningEvidenceIds?.[index] ?? undefined
                          }
                          label={`Source for warning: ${warning}`}
                        />
                      </li>
                    ))}
                  </ul>
                </Alert.Content>
              </Alert>
            )}
            {report.visitorSummary && report.visitorSummary.length > 0 && (
              <section className="grid gap-1.5 px-1 text-sm leading-relaxed">
                <h3 className="text-sm font-semibold">
                  What this means for you
                </h3>
                <p>
                  {report.visitorSummary.map((claim, i) => (
                    <span key={claim.evidenceIds.join("/")}>
                      {i > 0 && " "}
                      {claim.text}
                      {claim.evidenceIds.map((id, j) => (
                        <SourceLink
                          key={id}
                          reportUrl={reportUrl}
                          scanId={report.scanId}
                          evidenceId={id}
                          label={
                            claim.evidenceLabels?.[j] ??
                            `Statement ${i + 1}, source ${j + 1}`
                          }
                        >
                          {String(i + 1) +
                            (claim.evidenceIds.length > 1
                              ? String.fromCharCode(97 + j)
                              : "")}
                        </SourceLink>
                      ))}
                    </span>
                  ))}
                </p>
              </section>
            )}
            {!report.visitorSummary && report.practiceTakeaway && (
              <section className="grid gap-1.5 px-1 text-sm leading-relaxed">
                <h3 className="text-sm font-semibold">
                  What this means for you
                </h3>
                <p>
                  {report.practiceTakeaway.summary}{" "}
                  {report.practiceTakeaway.significance}
                  {report.practiceTakeaway.evidenceIds.map((id, i) => (
                    <SourceLink
                      key={id}
                      reportUrl={reportUrl}
                      scanId={report.scanId}
                      evidenceId={id}
                      label={"Evidence for this practice, source " + (i + 1)}
                    >
                      {String(i + 1)}
                    </SourceLink>
                  ))}
                </p>
              </section>
            )}
            {!report.visitorSummary &&
              report.browserSummary &&
              !report.practiceTakeaway && (
                <section className="grid gap-1.5 px-1 text-sm leading-relaxed">
                  <h3 className="text-sm font-semibold leading-tight">
                    {report.contentPageDifference
                      ? "Observed during visits"
                      : "Observed on the homepage"}
                  </h3>
                  <p>
                    {report.browserSummary}
                    <SourceLink
                      reportUrl={reportUrl}
                      scanId={report.scanId}
                      evidenceId={report.browserEvidenceId}
                      label="Source for homepage observation"
                    />
                  </p>
                  {report.contentPageDifference && (
                    <p>
                      {report.contentPageDifference.text}
                      <SourceLink
                        reportUrl={reportUrl}
                        scanId={report.scanId}
                        evidenceId={report.contentPageDifference.evidenceId}
                        label="Source for sampled page observation"
                      />
                    </p>
                  )}
                </section>
              )}
            {!report.visitorSummary && report.consentTakeaway && (
              <p className="px-1 text-sm">
                {report.consentTakeaway.text}{" "}
                <SourceLink
                  reportUrl={reportUrl}
                  scanId={report.scanId}
                  evidenceId={report.consentTakeaway.evidenceId}
                  label="Consent choice evidence"
                />
                {report.consentTakeaway.beforeChoiceEvidenceId && (
                  <SourceLink
                    reportUrl={reportUrl}
                    scanId={report.scanId}
                    evidenceId={report.consentTakeaway.beforeChoiceEvidenceId}
                    label="Evidence for the visit without a choice"
                  />
                )}
              </p>
            )}
            {report.requestFindings?.length ? (
              <FindingDetails title="What the requests contained">
                {report.requestFindings.slice(0, 2).map((item) => (
                  <p key={item.evidenceId}>
                    <strong>{item.destination}</strong>
                    {" · "}
                    {item.scenario === "default"
                      ? "Default visit"
                      : item.scenario === "accepted"
                        ? "Accept visit"
                        : "Reject visit"}
                    . {item.text}{" "}
                    <SourceLink
                      reportUrl={reportUrl}
                      scanId={report.scanId}
                      evidenceId={item.evidenceId}
                      label={"Request evidence for " + item.destination}
                    />
                  </p>
                ))}
              </FindingDetails>
            ) : null}
            {!report.visitorSummary &&
              (report.policySummary?.length ? (
                <section className="grid gap-1.5 px-1 text-sm leading-relaxed">
                  <h3 className="text-sm font-semibold leading-tight">
                    Privacy policy
                  </h3>
                  <p>
                    {[
                      ...report.policySummary,
                      ...(report.additionalPolicySummary
                        ? [report.additionalPolicySummary]
                        : []),
                    ].map((statement, index) => (
                      <span key={index}>
                        {index > 0 && " "}
                        {statement}
                        <SourceLink
                          reportUrl={reportUrl}
                          scanId={report.scanId}
                          evidenceId={report.policyEvidenceIds?.[index]}
                          label={`Source for policy statement ${index + 1}`}
                        />
                      </span>
                    ))}
                    {report.analyticsDisclosure && (
                      <>
                        {" "}
                        {report.analyticsDisclosure.text}
                        <SourceLink
                          reportUrl={reportUrl}
                          scanId={report.scanId}
                          evidenceId={report.analyticsDisclosure.evidenceId}
                          label="Source for self-hosted analytics policy"
                        />
                      </>
                    )}
                  </p>
                </section>
              ) : (
                report.analyticsDisclosure && (
                  <p>
                    {report.analyticsDisclosure.text}{" "}
                    <SourceLink
                      reportUrl={reportUrl}
                      scanId={report.scanId}
                      evidenceId={report.analyticsDisclosure.evidenceId}
                      label="Source for self-hosted analytics policy"
                    />
                  </p>
                )
              ))}
            {report.providerDisclosures?.length ? (
              <FindingDetails title="What linked providers disclose">
                {report.providerDisclosures.slice(0, 2).map((item) => (
                  <p key={item.evidenceId}>
                    <strong>{item.providerHost}</strong>
                    {" · "}
                    {item.excerpt
                      ? "“" + item.excerpt + "”"
                      : item.section}{" "}
                    <SourceLink
                      reportUrl={reportUrl}
                      scanId={report.scanId}
                      evidenceId={item.evidenceId}
                      label={"Provider policy for " + item.providerHost}
                    />
                  </p>
                ))}
              </FindingDetails>
            ) : null}
            {report.partial &&
              !report.visitorSummary?.length &&
              !report.browserSummary &&
              !report.policySummary?.length &&
              !report.policyOnly && (
                <p className="text-xs text-(--popup-muted)">
                  Partial scan. Open the report for its coverage.
                </p>
              )}
            {minimizeData && (
              <p>
                For your privacy profile, skip optional fields and use guest
                access if offered.
              </p>
            )}
          </>
        )}
        {host && !report && openReport}
        <FormReminderPreference />
      </main>
    </>
  );
}

const themePreference = window.matchMedia("(prefers-color-scheme: dark)");
function applySystemTheme() {
  const root = document.documentElement;
  root.classList.toggle("dark", themePreference.matches);
  root.dataset.theme = themePreference.matches ? "mouve-dark" : "mouve-light";
}
applySystemTheme();
themePreference.addEventListener("change", applySystemTheme);

createRoot(document.getElementById("root")!).render(<Popup />);
