import { expect, it } from "vitest";
import type { Evidence, ScanReport } from "@datadeal/contracts";
import { publicReportEvidence } from "./public-report-evidence";

it("includes one excerpt per retrieved policy and every cited row without publishing unrelated detail", () => {
  const scanId = "00000000-0000-4000-8000-000000000001";
  const completedAt = "2026-11-25T10:00:00.000Z";
  const section = (id: string, path: string): Evidence => ({
    id,
    scanId,
    retrievedAt: completedAt,
    kind: "declared_first_party",
    excerpt: "Verbatim excerpt from " + id,
    url: "https://policy.example.org/" + path,
    observation: {
      type: "policy_section",
      heading: id,
      providerHosts: ["private.example.org"],
    },
  });
  const report: ScanReport = {
    id: scanId,
    domain: "example.org",
    demo: false,
    partial: false,
    completedAt,
    findings: [],
    evidence: [
      section("main", "privacy"),
      section("cited", "privacy"),
      section("unrelated", "privacy"),
      section("cookies", "technologies/cookies"),
      section("retention", "technologies/retention"),
      {
        ...section("subprocessor-table", "subprocessors"),
        kind: "third_party_reference",
        observation: {
          type: "processing_document",
          document: "subprocessors",
          heading: "Supplier · Purpose",
          referral: {
            url: "https://example.org/privacy",
            excerpt: "Our hosting provider is Example Hosting.",
          },
        },
      },
      { ...section("foreign-scan", "privacy"), scanId: "different-scan" },
      {
        ...section("finding", "privacy"),
        kind: "observed_technical",
        observation: undefined,
      },
      {
        ...section("graph-only", "privacy"),
        kind: "inferred_infrastructure",
        observation: undefined,
      },
    ],
  };
  const rows = publicReportEvidence(report, [
    "cited",
    "finding",
    "foreign-scan",
  ]);
  expect(rows.map(({ id }) => id)).toEqual([
    "main",
    "cited",
    "cookies",
    "retention",
    "subprocessor-table",
    "finding",
  ]);
  for (const { id, excerpt } of rows)
    expect(excerpt).toBe("Verbatim excerpt from " + id);
  expect(JSON.stringify(rows)).not.toContain("private.example.org");
  expect(
    rows.find((row) => row.id === "subprocessor-table")?.observation,
  ).toMatchObject({
    type: "processing_document",
    referral: { url: "https://example.org/privacy" },
  });
});
