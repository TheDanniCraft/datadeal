import { publishedReportPayload } from "./published-report";

export async function comparePublicReports(left: string, right: string) {
  return Promise.all(
    [left, right].map(async (host) => {
      const { report, state } = await publishedReportPayload(host);
      return {
        host,
        scanId: report?.scanId ?? null,
        state,
        scanDate: report?.completedAt ?? null,
        partial: report?.partial ?? null,
        headlineScenario: report?.headlineScenario,
        noChoiceVisit: report?.noChoiceVisit,
        score: report?.score ?? null,
        grade: report?.grade ?? null,
        confidence: report?.confidence ?? null,
        verdict: report?.verdict ?? null,
        methodologyVersion: report?.methodologyVersion ?? null,
        visitorClaim: report?.visitorSummary?.[0] ?? null,
        browser:
          report?.browserSummary && report.browserEvidenceId
            ? {
                text: report.browserSummary,
                evidenceId: report.browserEvidenceId,
              }
            : null,
        takeaway:
          report?.policySummary?.[0] && report.policyEvidenceId
            ? {
                text: report.policySummary[0],
                evidenceId: report.policyEvidenceId,
              }
            : null,
        warnings: report?.warnings ?? [],
      };
    }),
  );
}
