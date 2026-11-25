import { expect, it } from "vitest";
import type { Evidence } from "@datadeal/contracts";
import { isPolicyDocument, readingBlockKind } from "./report-documents";

const row: Evidence = {
  id: "document",
  scanId: "0c8b5193-b4d5-4b91-a155-b1ba1d3f041d",
  kind: "declared_first_party",
  url: "https://sample.org/privacy",
  excerpt: "Privacy policy",
  retrievedAt: "2026-11-25T12:00:00Z",
};
it("selects legal documents and excludes contact directories even if they reference privacy", () => {
  expect(isPolicyDocument(row)).toBe(true);
  for (const path of ["/impressum-813.bild.html", "/contact", "/help"]) {
    expect(
      isPolicyDocument({
        ...row,
        url: "https://sample.org" + path,
        excerpt: "ImpressumWIR bei BILDKontakt – read our privacy policy.",
      }),
    ).toBe(false);
  }
  expect(isPolicyDocument({ ...row, kind: "observed_technical" })).toBe(false);
  expect(
    isPolicyDocument({ ...row, url: "https://sample.org/legal/cookies" }),
  ).toBe(true);
});
it("recognizes stored numbered legal headings while preserving numbered prose", () => {
  expect(readingBlockKind("I. Allgemeines", "paragraph")).toBe("heading");
  expect(readingBlockKind("3. Aufruf der Website", "paragraph")).toBe(
    "heading",
  );
  expect(
    readingBlockKind(
      "3. Aufruf der Website. Hier werden Daten gespeichert.",
      "paragraph",
    ),
  ).toBe("paragraph");
});
