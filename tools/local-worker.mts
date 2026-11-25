import { randomUUID } from "node:crypto";
import {
  completePolicyReview,
  publishPolicyClaims,
  promptVersion,
  validateCandidates,
  publishDataPractices,
  selectAnalysisEvidence,
  selectPolicyEvidence,
  completionAnalyzer,
} from "../packages/ai/index";
import { researchVendorPolicy, scan } from "../packages/scanner/index";
import { analyzeInventory } from "../apps/worker/inventory-analysis";
import { runWorker } from "../apps/worker/run";
import { connect } from "../packages/database/index";
import { scanReport, type ScanReport } from "../packages/contracts/index";
import {
  calculateScore,
  calculateAcceptAllScore,
  calculateRejectScore,
  evaluateHeadline,
} from "../packages/scoring/index";
import { subscriptionCompletion } from "./claude-subscription";
import { startLocalBrowserProxy } from "./local-browser-proxy";

const model = process.env.DATADEAL_CLAUDE_MODEL?.trim() || "claude-opus-5-5";
const complete = subscriptionCompletion(model);
function infer(
  instructions: string,
  input: string,
  signal = AbortSignal.timeout(180000),
) {
  return complete(instructions, input, signal, 16000);
}

const args = process.argv.slice(2);
const smoke = args[0] === "--smoke";
const scanDomain = args[0] === "--scan" ? args[1] : undefined;
const replayDomain =
  args[0] === "--replay" && args.length === 3 ? args[1] : undefined;
// Scoring v2 dry run on a saved scan: classify, research, score, print.
const inventoryDomain =
  args[0] === "--inventory" && args.length === 3 ? args[1] : undefined;
const recoverDomain =
  args[0] === "--recover-summary" &&
  (args.length === 3 || (args.length === 4 && args[3] === "--apply"))
    ? args[1]
    : undefined;
if (process.env.NODE_ENV === "production")
  throw new Error(
    "The Claude subscription worker is only available for local development.",
  );
if (
  args.length &&
  !smoke &&
  !scanDomain &&
  !replayDomain &&
  !recoverDomain &&
  !inventoryDomain
)
  throw new Error(
    "Use --smoke, --scan DOMAIN, --replay DOMAIN SCAN_ID, or --recover-summary DOMAIN SCAN_ID [--apply].",
  );
if (!smoke && !scanDomain) {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for the local worker.");
  const db = new URL(process.env.DATABASE_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname))
    throw new Error(
      "The subscription development worker requires a loopback database.",
    );
}
try {
  if (smoke) {
    const reply = await infer("Reply with exactly OK.", "Connection test.");
    if (reply.trim() !== "OK")
      throw new Error("Unexpected smoke-test response.");
    console.info("Claude subscription inference verified.");
  } else {
    // Same analyzer as production; only the transport differs.
    const analyzer = completionAnalyzer(
      model + " (Claude subscription)",
      complete,
    );
    if (recoverDomain) {
      const db = connect(process.env.DATABASE_URL!);
      try {
        const { report, output } = await db.policyReviewSource(
          args[2],
          recoverDomain,
        );
        if (
          report.policySummaryAddendum ||
          report.policyBrief?.length ||
          report.policyClaims?.length
        ) {
          console.info("This scan already has published policy analysis.");
        } else {
          const sources = selectAnalysisEvidence(report.evidence);
          const prior = validateCandidates(output, sources);
          const recovered = await completePolicyReview(
            prior,
            sources,
            async (instructions, input) => {
              const signal = AbortSignal.timeout(35_000);
              return infer(instructions, input, signal);
            },
          );
          const items = (recovered.brief ?? []).flatMap((item) =>
            item.quote ? [{ ...item, quote: item.quote }] : [],
          );
          const topics = {
            data_category: "collection",
            purpose: "purpose",
            recipient: "sharing",
            retention: "retention",
          } as const;
          const lines: NonNullable<
            ScanReport["policySummaryAddendum"]
          >["items"] = [...items];
          for (const claim of publishPolicyClaims(
            recovered,
            sources,
            report.id,
          )) {
            const topic = topics[claim.category];
            if (lines.length >= 3) break;
            if (
              claim.confidence === "low" ||
              claim.text.length > 230 ||
              claim.quote.length < 18 ||
              lines.some((item) => item.topic === topic) ||
              !sources.some(
                (source) =>
                  source.id === claim.source &&
                  source.observation?.type === "policy_section" &&
                  source.observation.topic === topic,
              )
            )
              continue;
            lines.push({
              topic,
              source: claim.source,
              text: claim.text,
              quote: claim.quote,
            });
          }
          if (!lines.length)
            throw new Error(
              "The saved evidence yielded no publishable policy summary.",
            );
          const addendum = {
            model: analyzer.model,
            promptVersion,
            reviewedAt: new Date().toISOString(),
            items: lines,
          };
          const status =
            args[3] === "--apply"
              ? await db.savePolicySummaryAddendum(
                  report.id,
                  report.domain,
                  addendum,
                )
              : "preview";
          console.info(
            JSON.stringify(
              { domain: report.domain, scanId: report.id, status, ...addendum },
              null,
              2,
            ),
          );
        }
      } finally {
        await db.close();
      }
    } else if (inventoryDomain) {
      const db = connect(process.env.DATABASE_URL!);
      const report = await (async () => {
        try {
          const [snapshot] = await db.archivedReports(
            inventoryDomain,
            args[2],
            false,
          );
          return scanReport.parse(snapshot?.report);
        } finally {
          await db.close();
        }
      })();
      const inventory = await analyzeInventory(
        analyzer,
        report,
        researchVendorPolicy,
      );
      if (!inventory) throw new Error("Inventory analysis is unavailable.");
      report.storageInventory = inventory;
      const byId = new Map(inventory.classifications.map((c) => [c.itemId, c]));
      for (const item of [...inventory.storage, ...inventory.recipients]) {
        const c = byId.get(item.id);
        console.info(
          [
            "domain" in item
              ? "recipient " + item.domain
              : item.mechanism + " " + item.name,
            item.phases.join("+"),
            c ? `${c.purpose}/${c.controller}` : "UNCLASSIFIED",
            c?.vendor ?? "",
            c?.reason ?? "",
          ].join(" | "),
        );
      }
      console.info(
        JSON.stringify(
          {
            research: inventory.research,
            default: calculateScore(report).score,
            rejected: calculateRejectScore(report)?.score,
            accepted: calculateAcceptAllScore(report)?.score,
            acceptedVerdict: calculateAcceptAllScore(report)?.verdict,
            topCosts: calculateAcceptAllScore(
              report,
            )?.inventoryAssessment?.costs.slice(0, 8),
          },
          null,
          2,
        ),
      );
    } else if (scanDomain || replayDomain) {
      const report = scanDomain
        ? await scan(randomUUID(), scanDomain, analyzer.selectPrivacyDocuments)
        : await (async () => {
            const db = connect(process.env.DATABASE_URL!);
            try {
              const [snapshot] = await db.archivedReports(
                replayDomain!,
                args[2],
                false,
              );
              const report = scanReport.parse(snapshot?.report);
              if (report.id !== args[2])
                throw new Error(
                  "Published scan ID differs from the requested scan.",
                );
              return report;
            } finally {
              await db.close();
            }
          })();
      const evidence = replayDomain
        ? selectAnalysisEvidence(report.evidence)
        : selectPolicyEvidence(report.evidence);
      if (!evidence.length)
        throw new Error("The scan did not retrieve policy evidence.");
      console.info(
        `Analyzing ${evidence.length} sources for ${report.domain} (scan ${report.id}).`,
      );
      const result = await analyzer.analyze(evidence);
      const replay = replayDomain && {
        ...report,
        ...publishDataPractices(report, result.practices),
      };
      console.info(
        JSON.stringify(
          {
            domain: report.domain,
            evidenceSources: evidence.length,
            claims: result.claims.length,
            ...(replay && {
              storedHeadline: evaluateHeadline(report).rating.score,
              reconsidered: {
                before: calculateScore(replay).score,
                afterReject: calculateRejectScore(replay)?.score,
                afterAccept: calculateAcceptAllScore(replay)?.score,
              },
              practiceCoverage: replay.practiceCoverage,
              reviewedPractices: replay.dataPractices
                .filter((p) => p.interpretation === "analyst_reviewed")
                .map(({ scenario, summary, role, purpose, evidence }) => ({
                  scenario,
                  summary,
                  role,
                  purpose,
                  evidence,
                })),
            }),
            retention: result.claims
              .filter(
                ({ category, supportingQuote }) =>
                  category === "retention" && supportingQuote,
              )
              .map(({ claim, supportingQuote }) => ({
                claim,
                source: supportingQuote?.evidenceId,
                quote: supportingQuote?.text,
              })),
            brief: result.brief?.map(({ topic, text, source }) => ({
              topic,
              text,
              source,
            })),
          },
          null,
          2,
        ),
      );
    } else {
      process.env.DATADEAL_CONSENT_DOMAINS ??= "*";
      const proxy =
        process.env.DATADEAL_CONSENT_DOMAINS?.trim() &&
        !process.env.DATADEAL_BROWSER_PROXY
          ? await startLocalBrowserProxy()
          : undefined;
      if (proxy) process.env.DATADEAL_BROWSER_PROXY = proxy.url;
      try {
        await runWorker(analyzer);
      } finally {
        proxy?.close();
      }
    }
  }
} catch (error) {
  console.error(
    error instanceof SyntaxError
      ? "Invalid JSON response."
      : error instanceof Error
        ? error.message
        : "Local worker failed.",
  );
  process.exitCode = 1;
}
