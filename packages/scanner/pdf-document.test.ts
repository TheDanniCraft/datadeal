import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { extractPdfText, maxPdfBytes } from "./pdf-document";

// Write an ordinary PDF with a cross-reference table and one text run per page.
function policyPdf(pages: string[]) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const page of pages) {
    const contentId = objects.length + 2;
    const content = `BT /F1 12 Tf 40 740 Td (${page}) Tj ET\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    );
  }
  let file = "%PDF-1.4\n";
  const xref = ["0000000000 65535 f "];
  for (const [i, object] of objects.entries()) {
    xref.push(String(Buffer.byteLength(file)).padStart(10, "0") + " 00000 n ");
    file += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(file);
  file += `xref\n0 ${xref.length}\n${xref.join("\n")}\ntrailer\n<< /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(file);
}

const reader = spawnSync("pdftotext", ["-v"], {
  timeout: 2_000,
  windowsHide: true,
});
afterEach(() => vi.unstubAllEnvs());

it.skipIf(reader.status !== 0)(
  "preserves policy text and page boundaries",
  async () => {
    const text = await extractPdfText(
      policyPdf(["Privacy policy", "We store support requests for 30 days."]),
    );
    expect(text?.split("\f").map((page) => page.trim())).toEqual([
      "Privacy policy",
      "We store support requests for 30 days.",
    ]);
  },
);

it("returns no text for an unavailable converter", async () => {
  vi.stubEnv("PATH", "/nonexistent-datadeal-pdf-reader");
  expect(await extractPdfText(policyPdf(["Private requests"]))).toBeNull();
});

it("ignores HTML, oversized input, invalid PDFs and canceled scans", async () => {
  const tooBig = Buffer.alloc(maxPdfBytes + 1);
  tooBig.write("%PDF-1.4");
  expect(await extractPdfText(tooBig)).toBeNull();
  expect(await extractPdfText(Buffer.from("<p>Privacy policy</p>"))).toBeNull();
  expect(await extractPdfText(Buffer.from("%PDF-1.4\ninvalid"))).toBeNull();
  expect(
    await extractPdfText(policyPdf(["Ignored"]), AbortSignal.abort()),
  ).toBeNull();
});

it("supplies no evidence for a page without embedded text", async () => {
  expect(await extractPdfText(policyPdf([""]))).toBeNull();
});

it("discards partial text when a later page cannot be decoded", async () => {
  const damaged = policyPdf(["Readable", "Unreadable"])
    .toString()
    .replace(
      "7 0 obj\n<< /Length",
      "7 0 obj\n<< /Filter /UnknownDecode /Length",
    );
  expect(await extractPdfText(Buffer.from(damaged))).toBeNull();
});
