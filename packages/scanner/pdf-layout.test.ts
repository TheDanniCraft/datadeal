import { load } from "cheerio";
import { expect, it } from "vitest";
import { captureDocument } from "./document-layout";
import { extractPolicySections } from "./observations";
import { pdfDocumentHtml } from "./pdf-layout";
import { processingDocumentEvidence } from "./processing-documents";

it("recovers readable policy headings and links normalized excerpts to the stored text", () => {
  const html = pdfDocumentHtml(
    "Privacy Notice\r\n\r\n1. Information we collect\r\nWe collect contact details when you\r\nsend a support request.\fRetention\n\nWe retain the conversation for one month.",
  );
  expect(
    extractPolicySections(load(html)).map(({ topic, excerpt }) => [
      topic,
      excerpt,
    ]),
  ).toEqual([
    [
      "collection",
      "We collect contact details when you send a support request.",
    ],
    ["retention", "We retain the conversation for one month."],
  ]);
  const captured = captureDocument(load(html))!;
  expect(captured.documentLayout.map(({ kind }) => kind)).toEqual([
    "title",
    "heading",
    "paragraph",
    "heading",
    "paragraph",
  ]);
  for (const section of extractPolicySections(load(html))) {
    expect(captured.excerpt).toContain(section.excerpt);
  }
});

it("keeps the publisher and wrapped agreement title in order and extracts an actual processor clause", async () => {
  const html = pdfDocumentHtml(
    "Acme Ltd\nDATA PROCESSING\nAGREEMENT\n\n2. Instructions\nWe process personal data only on the documented\ninstructions of the controller.",
  );
  const page = load(html);
  expect(page("title").text()).toBe("DATA PROCESSING AGREEMENT");
  expect(
    page("main")
      .children()
      .map((_, el) => page(el).text())
      .get(),
  ).toEqual([
    "Acme Ltd",
    "DATA PROCESSING AGREEMENT",
    "2. Instructions",
    "We process personal data only on the documented instructions of the controller.",
  ]);
  const url = new URL("https://publisher.example/terms");
  const rows = await processingDocumentEvidence(
    "11000000-0000-4000-8000-000000000001",
    url,
    [{ kind: "dpa", url: url.href, label: "Data Processing Agreement" }],
    [],
    async () => ({ url, html }),
    new AbortController().signal,
  );
  expect(rows).toMatchObject([
    {
      excerpt:
        "We process personal data only on the documented instructions of the controller.",
      observation: { heading: "2. Instructions", document: "dpa" },
    },
  ]);
});

it("treats literal markup and entity references as evidence text only", () => {
  const line =
    'We use <script>alert(1)</script>, &lt;code&gt; and <a href="/privacy">example</a>.';
  const page = load(pdfDocumentHtml("Terms & conditions\n\n" + line));
  expect(page("a,script,code").length).toBe(0);
  expect(page("h1").text()).toBe("Terms & conditions");
  expect(page("main p").text()).toBe(line);
  const prose = load(
    pdfDocumentHtml(
      "We may forward inquiries to the company.\nSee their privacy policy.",
    ),
  );
  expect(prose("title,h1,h2").length).toBe(0);
});

it("uses the numbered outline across wrapped questions, quoted prose and flattened table cells", () => {
  const html = pdfDocumentHtml(
    [
      "Website Privacy Notice",
      "This website is operated by Example",
      "Foundation, a registered charity.",
      "1. What types of personal data do we collect and where do we get it from?",
      "“Personal data” refers to information about a person.",
      "",
      "Legal basis",
      "",
      "2. What are your rights in relation to your personal data and how can you",
      "exercise them?",
      "You may ask for a copy of your details.",
    ].join("\n"),
  );
  const page = load(html);
  expect(
    page("h2")
      .map((_, node) => page(node).text())
      .get(),
  ).toEqual([
    "1. What types of personal data do we collect and where do we get it from?",
    "2. What are your rights in relation to your personal data and how can you exercise them?",
  ]);
  expect(page("main p").first().text()).toBe(
    "This website is operated by Example Foundation, a registered charity.",
  );
  const topics = extractPolicySections(page);
  expect(topics.map(({ topic }) => topic)).toEqual(["collection", "rights"]);
  expect(topics[1].excerpt).toBe("You may ask for a copy of your details.");
});

it("keeps index labels out of policy disclosures and recovers the substantive section after the index", () => {
  const index =
    "Website Privacy Policy\nTable of Contents\n1. Sharing .... 3\n2. Your rights .... 4";
  expect(extractPolicySections(load(pdfDocumentHtml(index)))).toEqual([]);
  const page = load(
    pdfDocumentHtml(
      index +
        "\f1. Sharing\nWe send invoices to our processor.\n2. Your rights\nYou can request access.",
    ),
  );
  expect(extractPolicySections(page).map(({ excerpt }) => excerpt)).toEqual([
    "We send invoices to our processor.",
    "You can request access.",
  ]);
  expect(captureDocument(page)?.excerpt).not.toContain("....");
});
