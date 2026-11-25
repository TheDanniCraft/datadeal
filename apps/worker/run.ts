import { createHash } from "node:crypto";
import {
  practiceAnalysisInput,
  publishDataPractices,
  publishPolicyClaims,
  type EvidenceAnalyzer,
  preferredPolicyEvidenceId,
  promptVersion,
  selectAnalysisEvidence,
  validateCandidates,
} from "@datadeal/ai";
import { setTimeout as delay } from "node:timers/promises";
import { readMetaCookiePolicy } from "./meta-cookie-policy";
import { connect, type ScanStage } from "@datadeal/database";
import {
  configuredContentPageLimit,
  isRetryableScanFailure,
  researchVendorPolicy,
  scan,
} from "@datadeal/scanner";
import { analyzeInventory } from "./inventory-analysis";
import { analysisFailure, analyzeWithRetry } from "./analysis-retry";
import {
  consentSettleMs,
  measureContentPages,
  observeConsentWithCoverage,
  realVisitorLaunchArgs,
  untestedConsentCoverage,
} from "./consent-observation";

export async function runWorker(
  analyzer: EvidenceAnalyzer,
  { requireBrowser = false }: { requireBrowser?: boolean } = {},
) {
  const pageLimit = configuredContentPageLimit(process.env.CONTENT_PAGE_LIMIT);
  const compareIdentifiers =
    process.env.DATADEAL_COMPARE_VISIT_IDENTIFIERS === "true";
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const browserProxy = process.env.DATADEAL_BROWSER_PROXY?.trim();
  const configuredDomains = process.env.DATADEAL_CONSENT_DOMAINS;
  const consentDomains = new Set(
    (configuredDomains ?? (browserProxy ? "*" : ""))
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  if (requireBrowser && !consentDomains.size) consentDomains.add("*");
  if ((requireBrowser || consentDomains.size) && !browserProxy)
    throw new Error("DATADEAL_BROWSER_PROXY is required for browser scans");
  const launchBrowser =
    browserProxy && consentDomains.size
      ? async () => {
          const { chromium } = await import("playwright");
          return chromium.launch({
            chromiumSandbox: true,
            timeout: 5000,
            proxy: { server: browserProxy, bypass: "<-loopback>" },
            args: realVisitorLaunchArgs,
          });
        }
      : undefined;
  const db = connect(databaseUrl);
  let stopping = false;
  let nextCleanupAt = 0;
  let nextMonitoringAt = 0;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      stopping = true;
    });

  try {
    await db.checkScanStorage().catch(() => {
      throw new Error(
        "Worker storage is not ready. Check PostgreSQL connectivity and apply all DataDeal migrations.",
      );
    });
    if (launchBrowser) {
      try {
        const browser = await launchBrowser();
        await browser.close();
      } catch {
        throw new Error(
          "Worker browser is not ready. Install Playwright Chromium and its dependencies, and check Chromium sandbox and proxy configuration.",
        );
      }
    }
    console.info(
      JSON.stringify({
        event: "worker_ready",
        identifierComparisonEnabled: compareIdentifiers,
        contentPageLimit: pageLimit,
        browserCoverage: consentDomains.has("*")
          ? "all_public_domains"
          : consentDomains.size
            ? "configured_domains"
            : "disabled",
      }),
    );
    while (!stopping) {
      if (Date.now() >= nextCleanupAt) {
        nextCleanupAt = Date.now() + 60_000;
        try {
          if (
            process.env.NODE_ENV !== "production" &&
            process.env.DATADEAL_LOCAL_SAMPLE_ADS === "true" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(
              new URL(databaseUrl).hostname,
            )
          )
            await db.settleOfflineFlights();
          const counts = await db.pruneExpiredPrivateData();
          if (Object.values(counts).some((count) => count > 0)) {
            console.info(
              JSON.stringify({ event: "expired_data_pruned", ...counts }),
            );
          }
        } catch {
          console.warn(JSON.stringify({ event: "retention_cleanup_failed" }));
        }
      }
      if (Date.now() >= nextMonitoringAt) {
        nextMonitoringAt = Date.now() + 15 * 60_000;
        try {
          for (const domain of await db.dueWatchlistDomains()) {
            if (stopping) break;
            await db.enqueue(domain, "watchlist");
          }
        } catch {
          console.warn(
            JSON.stringify({ event: "watchlist_monitoring_failed" }),
          );
        }
      }
      const job = await db.claim();
      if (!job) {
        await delay(1500);
        continue;
      }
      const renewLease = async (stage?: ScanStage) => {
        const owned = await db.renewScanLease(job.id, job.owner, stage);
        if (!owned)
          console.warn(
            JSON.stringify({ event: "scan_lease_lost", scanId: job.id }),
          );
        return owned;
      };
      let report: Awaited<ReturnType<typeof scan>>;
      try {
        report = await scan(
          job.id,
          job.domain,
          analyzer.selectPrivacyDocuments?.bind(analyzer),
          async (stage) => {
            if (!(await renewLease(stage))) throw new Error("Scan lease lost");
          },
          { contentPageLimit: pageLimit },
        );
      } catch (error) {
        const retry =
          isRetryableScanFailure(error) &&
          (await db.retryScan(job.id, job.owner));
        const failed = !retry && (await db.finish(job.id, job.owner, null));
        console.info(
          JSON.stringify({
            event: retry
              ? "scan_retry_queued"
              : failed
                ? "scan_failed"
                : "scan_lease_lost",
            scanId: job.id,
            attempt: job.attempts,
          }),
        );
        continue;
      }
      report.consentCoverage = { ...untestedConsentCoverage };
      if (
        launchBrowser &&
        (consentDomains.has("*") || consentDomains.has(job.domain))
      ) {
        if (!(await renewLease("browser"))) continue;
        try {
          const homepageSource = report.evidence.find(
            (source) =>
              source.observation?.type === "response_cookie_attributes",
          );
          if (!homepageSource?.url)
            throw new Error(
              "Missing final homepage URL for browser observation",
            );
          const homepage = new URL(homepageSource.url);
          const browser = await launchBrowser();
          try {
            const { observations, coverage } = await observeConsentWithCoverage(
              browser,
              homepage,
              undefined,
              compareIdentifiers,
            );
            report.consentCoverage = coverage;
            report.partial = !(
              observations.some(({ scenario }) => scenario === "default") &&
              report.findings.some(({ rule }) => rule === "policy_available")
            );
            for (const {
              scenario,
              visitedUrl,
              requests,
              cookies,
              storage,
              storageSummary,
              freshContext,
              capture,
              externalDomains,
              responseDomains,
              network,
              requestInspection,
              afterChoice,
            } of observations) {
              const evidenceId = `browser-consent-${scenario}`;
              const choiceObserved = afterChoice && scenario !== "default";
              report.evidence.push({
                id: evidenceId,
                kind: "observed_technical",
                consentScenario: scenario,
                url: visitedUrl,
                excerpt:
                  `This visit attempted ${requests} HTTP requests. The browser observed for ${consentSettleMs / 1000} seconds after ${choiceObserved ? "the consent choice" : "the page loaded"} and submitted no forms. The browser context held ${cookies} cookies at the end of the observation window.` +
                  (storage
                    ? ` The top-level origin held ${storage.localEntries} local storage and ${storage.sessionEntries} session storage entries.`
                    : "") +
                  (choiceObserved
                    ? ` The visible ${scenario === "rejected" ? "reject" : "accept"} control disappeared after the browser clicked it.`
                    : ""),
                observation: {
                  type: "browser_consent_counts",
                  freshContext,
                  capture,
                  requestInspection,
                  finalPageKnown: true,
                  requests,
                  cookies,
                  storage,
                  storageSummary,
                  externalDomains,
                  responseDomains,
                  afterChoice,
                },
                retrievedAt: new Date().toISOString(),
                scanId: job.id,
              });
              for (const [index, observation] of network.entries()) {
                const matchedEmail = observation.fieldCategories.includes(
                  "email_address_value",
                );
                const fields = observation.fieldCategories
                  .filter(
                    (field) =>
                      !matchedEmail ||
                      (field !== "email" && field !== "email_value"),
                  )
                  .map((field) =>
                    field === "email_address_value"
                      ? "an email-shaped value in an email field"
                      : field === "email_value"
                        ? "an email-shaped value"
                        : field.replaceAll("_", " ") + " field",
                  );
                report.evidence.push({
                  id: `browser-network-${scenario}-${index + 1}`,
                  kind: "observed_technical",
                  consentScenario: scenario,
                  url: homepage.origin,
                  excerpt:
                    `The browser attempted ${observation.attempts} ${observation.method} request(s) to ${observation.targetDomain} containing ${fields.join(", ")}. It observed ${observation.responses} HTTP response(s).` +
                    (observation.signature === "permutive_event"
                      ? " The request format matches Permutive’s Events API."
                      : observation.signature === "plausible_event"
                        ? " The request format matches the Plausible Events API."
                        : ""),
                  retrievedAt: new Date().toISOString(),
                  scanId: job.id,
                  observation,
                });
              }
              if (scenario === "rejected" && choiceObserved) {
                report.findings = report.findings.filter(
                  (item) => item.rule !== "optional_control",
                );
                report.findings.push({
                  rule: "optional_control",
                  title: "Browser interaction with a reject control observed",
                  explanation:
                    "The browser clicked the visible reject control and the control disappeared. The scan did not establish whether all optional processing stopped.",
                  confidence: "moderate",
                  severity: "informational",
                  evidenceIds: [evidenceId],
                });
              }
            }
            if (
              job.domain === "facebook.com" &&
              observations.some((visit) =>
                visit.storageSummary.end.cookies.recognized.some(
                  (cookie) =>
                    cookie.site === "facebook.com" &&
                    (cookie.name === "datr" || cookie.name === "sb"),
                ),
              )
            ) {
              const policy = await readMetaCookiePolicy(browser, job.id);
              if (policy) report.evidence.push(policy);
            }
            await measureContentPages(
              browser,
              report,
              homepage,
              renewLease,
              compareIdentifiers,
            );
            report.completedAt = new Date().toISOString();
          } finally {
            await browser.close();
          }
        } catch {
          console.warn(
            JSON.stringify({
              event: "browser_consent_unavailable",
              scanId: job.id,
            }),
          );
        }
      }
      if (report && !(await renewLease())) continue;
      const analysis = await (async () => {
        if (!report) return undefined;
        const supplied = selectAnalysisEvidence(report.evidence);
        if (!supplied.length) return undefined;
        if (!(await renewLease("analysis"))) return undefined;
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              model: analyzer.model,
              promptVersion,
              input: practiceAnalysisInput(supplied),
            }),
          )
          .digest("hex");
        const cached = await db.cachedAnalysis(hash);
        if (cached) {
          try {
            const output = validateCandidates(
              (cached as { output?: unknown }).output,
              supplied,
            );
            console.info(
              JSON.stringify({ event: "analysis_cache_hit", scanId: job.id }),
            );
            return {
              hash,
              result: { model: analyzer.model, promptVersion, output },
            };
          } catch {
            console.warn(
              JSON.stringify({
                event: "analysis_cache_invalid",
                scanId: job.id,
              }),
            );
          }
        }
        const candidates = await analyzeWithRetry(
          analyzer,
          supplied,
          () => renewLease("analysis"),
          ({ reason, providerStatus }) =>
            console.warn(
              JSON.stringify({
                event: "analysis_retry",
                scanId: job.id,
                attempt: 2,
                reason,
                providerStatus,
              }),
            ),
        );
        if (!candidates) return undefined;
        const result = validateCandidates(candidates, supplied);
        return {
          hash,
          result: { model: analyzer.model, promptVersion, output: result },
        };
      })().catch((error: unknown) => {
        const { reason, providerStatus } = analysisFailure(error);
        console.warn(
          JSON.stringify({
            event: "analysis_unavailable",
            scanId: job.id,
            reason,
            providerStatus,
          }),
        );
        return undefined;
      });
      if (report && analysis) {
        const brief = analysis.result.output.brief;
        if (brief?.length) report.policyBrief = brief;
        const claims = publishPolicyClaims(
          analysis.result.output,
          report.evidence,
          report.id,
        );
        if (claims.length) report.policyClaims = claims;
        report.preferredPolicyEvidenceId = preferredPolicyEvidenceId(
          analysis.result.output,
          report.evidence,
          report.id,
        );
      }
      if (report)
        Object.assign(
          report,
          publishDataPractices(report, analysis?.result.output.practices),
        );
      if (report) {
        // Scoring v2 input, independent of the policy analysis. A failure leaves the report on the previous rules.
        const inventory = await analyzeInventory(
          analyzer,
          report,
          researchVendorPolicy,
          () => renewLease("analysis"),
        ).catch((error: unknown) => {
          const { reason, providerStatus } = analysisFailure(error);
          console.warn(
            JSON.stringify({
              event: "inventory_unavailable",
              scanId: job.id,
              reason,
              providerStatus,
            }),
          );
          return undefined;
        });
        if (inventory) report.storageInventory = inventory;
      }
      if (!(await renewLease("publication"))) continue;
      // A report that fails validation fails this job, not the whole worker.
      const published = await db
        .finish(job.id, job.owner, report, analysis)
        .catch(async (error: unknown) => {
          const issues =
            error && typeof error === "object" && "issues" in error
              ? (error.issues as { path: PropertyKey[] }[])
                  .slice(0, 5)
                  .map(({ path }) => path.join("."))
              : undefined;
          console.error(
            JSON.stringify({
              event: "publication_invalid",
              scanId: job.id,
              issues,
            }),
          );
          await db.finish(job.id, job.owner, null).catch(() => undefined);
          return false;
        });
      console.info(
        JSON.stringify({
          event: published ? "scan_finished" : "scan_lease_lost",
          scanId: job.id,
          hasReport: published && report !== null,
        }),
      );
    }
  } finally {
    await db.close();
  }
}
