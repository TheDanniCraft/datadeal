import type { ScanReport } from "@datadeal/contracts";
import type { BrowserScanVisit } from "@datadeal/contracts/browser-scan";
import { consentSettleMs } from "@datadeal/collector/consent";

/** A measured visit, from the worker's browser or a visitor's extension. */
export type MeasuredVisit = BrowserScanVisit["observation"] & {
  scenario: BrowserScanVisit["scenario"];
  visitedUrl: string;
  network: BrowserScanVisit["network"];
};

/** Adds the evidence and findings for measured homepage visits. */
export function recordVisits(
  report: ScanReport,
  observations: readonly MeasuredVisit[],
  homepage: URL,
  scanId: string,
) {
  const job = { id: scanId };
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
            !matchedEmail || (field !== "email" && field !== "email_value"),
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
}
