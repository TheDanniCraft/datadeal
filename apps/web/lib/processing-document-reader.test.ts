import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { type Evidence, type ScanReport } from "@datadeal/contracts";
import {
  documentTitle,
  DocumentPassages,
} from "../app/report/[domain]/evidence-dialog";
import { publicReportEvidence } from "./public-report-evidence";

it("renders every saved passage for a single linked provider agreement through the anonymous projection", () => {
  const id = "11000000-0000-4000-8000-000000000001";
  const completedAt = "2026-11-25T12:00:00.000Z";
  const excerpts = [
    "We process personal data on behalf of the customer.",
    "We process visitor data only under documented instructions.",
    "Orbit provides database hosting for the enterprise service.",
  ];
  const evidence: Evidence[] = excerpts.map((excerpt, index) => ({
    id: "processing-document-" + (index + 1),
    kind: "third_party_reference",
    scanId: id,
    retrievedAt: completedAt,
    url: "https://provider.example/dpa",
    excerpt,
    observation: {
      type: "processing_document",
      document: "dpa",
      heading: "Enterprise hosting",
      referral: {
        url: "https://site.example/privacy",
        excerpt: "Our hosting provider is Provider.",
      },
    },
  }));
  const report: ScanReport = {
    id,
    completedAt,
    domain: "site.example",
    demo: false,
    partial: true,
    findings: [],
    evidence,
  };
  const rows = publicReportEvidence(report, []);
  expect(rows).toHaveLength(3);
  expect(documentTitle(rows)).toBe("Data processing agreement");
  const html = renderToStaticMarkup(
    createElement(DocumentPassages, { sources: rows, quote: excerpts[1] }),
  );
  for (const quote of excerpts) expect(html).toContain(quote);
  expect(html).toMatch(
    /<mark[^>]*>We process visitor data only under documented instructions\.<\/mark>/,
  );
  expect(rows[2].observation).toMatchObject({
    referral: { url: "https://site.example/privacy" },
  });
});

it("opens the accepted privacy document and excludes the unrelated BILD imprint from public reader sources", () => {
  const id = "11000000-0000-4000-8000-000000000001";
  const at = "2026-11-25T12:00:00.000Z";
  const document = {
    id: "document-1",
    scanId: id,
    kind: "declared_first_party",
    retrievedAt: at,
    url: "https://example.de/documents/abc",
    documentKind: "privacy",
    excerpt:
      "Privacy noticeSkip narrationWho we areWe answer contact requests.",
    documentLayout: [
      { kind: "title", start: 0, end: 14 },
      { kind: "heading", start: 28, end: 38 },
      { kind: "paragraph", start: 38, end: 65 },
    ],
  } satisfies Evidence;
  const imprint = {
    ...document,
    id: "document-2",
    url: "https://example.de/impressum",
    documentKind: "imprint",
    excerpt: "ImpressumWIR bei BILDKontakt",
    documentLayout: undefined,
  } satisfies Evidence;
  const citation = {
    ...document,
    id: "document-1-section-1",
    documentKind: undefined,
    documentLayout: undefined,
    excerpt: "We answer contact requests.",
    observation: { type: "policy_section", heading: "Who we are" },
  } satisfies Evidence;
  const report: ScanReport = {
    id,
    completedAt: at,
    domain: "example.de",
    demo: false,
    partial: true,
    findings: [],
    evidence: [imprint, document, citation],
  };
  const rows = publicReportEvidence(report, []);
  expect(rows.map((row) => row.id)).toEqual([document.id, citation.id]);
  expect(rows[1].documentKind).toBe("privacy");
  expect(publicReportEvidence(report, [imprint.id])[0].documentKind).toBe(
    "imprint",
  );
  expect(documentTitle(rows)).toBe("Privacy notice");
  const html = renderToStaticMarkup(
    createElement(DocumentPassages, { sources: rows, quote: citation.excerpt }),
  );
  expect(html).toContain("Who we are</h3>");
  expect(html).toMatch(/<mark[^>]*>We answer contact requests\.<\/mark>/);
  expect(html).not.toMatch(/Impressum|Skip narration/);
});
