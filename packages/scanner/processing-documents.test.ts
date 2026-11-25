import { expect, it, vi } from "vitest";
import { load } from "cheerio";
import { evidence } from "@datadeal/contracts";
import { processingDocumentEvidence } from "./processing-documents";
import { linkedDocuments, type DocumentLink } from "./sitemap";
import { extractPolicySections } from "./observations";

const id = "11000000-0000-4000-8000-000000000001";
const site = new URL("https://reviewed.example");
const danni = new URL("https://thedannicraft.de/privacy");

it.each([
  "We operate a self‑hosted Plausible Analytics instance.",
  "Wir nutzen eine selbst-gehostete Plausible-Instanz auf unseren eigenen Servern.",
  "Wir hosten Plausible selbst.",
  "We use Plausible Analytics for traffic analysis.",
  "We do not use Plausible Cloud.",
  "We operate a self-hosted Plausible instance. We use Plausible Cloud.",
  "We host Plausible ourselves for the newsletter. We use Plausible Cloud for the newsletter.",
])(
  "a software reference on thedannicraft.de cannot fetch or publish cloud terms: %s",
  async (statement) => {
    const doc = load(
      "<main><h2>Sharing</h2><p>" +
        statement +
        ' See <a href="https://plausible.io/privacy">Privacy policy</a>.</p><p>' +
        statement +
        ' See <a href="https://plausible.io/dpa">DPA</a>.</p></main>',
    );
    const [section] = extractPolicySections(doc, danni);
    expect(section.providerHosts).toBeUndefined();
    expect(section.providerPolicyUrls).toBeUndefined();
    const fetch = vi.fn(async (url: URL) => ({ url, html: dpa }));
    expect(
      await processingDocumentEvidence(
        id,
        danni,
        [],
        [{ url: danni, page: doc, privacy: true }],
        fetch,
        new AbortController().signal,
      ),
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("preserves a separately scoped Cloud use without assigning it to the self-hosted site analytics", async () => {
  const cloud = "We use Plausible Cloud for our newsletter analytics.";
  const doc = load(
    "<main><h2>Sharing</h2><p>We operate a self-hosted Plausible instance for the main website.</p><p>" +
      cloud +
      ' <a href="https://plausible.io/privacy">Privacy policy</a>.</p><p>' +
      cloud +
      ' <a href="https://plausible.io/dpa">DPA</a>.</p></main>',
  );
  const [section] = extractPolicySections(doc, danni);
  expect(section.providerHosts).toEqual(["plausible.io"]);
  expect(section.providerContexts?.["https://plausible.io/privacy"]).toContain(
    cloud,
  );
  expect(
    section.providerContexts?.["https://plausible.io/privacy"],
  ).not.toContain("self-hosted");
  const rows = await processingDocumentEvidence(
    id,
    danni,
    [],
    [{ url: danni, page: doc, privacy: true }],
    async (url) => ({ url, html: dpa }),
    new AbortController().signal,
  );
  expect(rows[0]).toMatchObject({
    kind: "third_party_reference",
    observation: { referral: { excerpt: cloud + " DPA." } },
  });
});
const clause =
  "We process visitor data on behalf of the customer when the hosted service is used.";
const dpa =
  "<main><h1>Data Processing Agreement (DPA)</h1><h2>Hosted service</h2><p>" +
  clause +
  '</p><a href="/subprocessors">Our subprocessors</a></main>';
const list =
  "<main><h1>Subprocessors</h1><h2>Enterprise plan</h2><table><tr><th>Provider</th><th>Purpose</th></tr><tr><td>Orbit Mail</td><td>Email delivery</td></tr></table></main>";
const run = (
  policy: string,
  pages: Record<string, string>,
  links: DocumentLink[] = [],
) => {
  const fetchPage = vi.fn(async (url: URL) => ({
    url,
    html: pages[url.href] ?? "",
  }));
  const rows = processingDocumentEvidence(
    id,
    site,
    links,
    [{ url: new URL("/privacy", site), page: load(policy), privacy: true }],
    fetchPage,
    new AbortController().signal,
  );
  return { rows, fetchPage };
};

it("retains exact bounded, publisher-attributed clauses and table scope from a declared host", async () => {
  const policy =
    '<p>Our hosting provider is Orbit. Read the <a href="https://orbit.example/privacy">Orbit privacy policy</a>.</p>';
  const { rows, fetchPage } = run(policy, {
    "https://orbit.example/privacy": '<footer><a href="/dpa">DPA</a></footer>',
    "https://orbit.example/dpa": dpa,
    "https://orbit.example/subprocessors": list,
  });
  const records = (await rows).map((row) => evidence.parse(row));
  expect(fetchPage).toHaveBeenCalledTimes(3);
  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({
    kind: "third_party_reference",
    url: "https://orbit.example/dpa",
    excerpt: clause,
    observation: {
      type: "processing_document",
      heading: "Hosted service",
      document: "dpa",
      referral: {
        url: "https://reviewed.example/privacy",
        excerpt:
          "Our hosting provider is Orbit. Read the Orbit privacy policy.",
      },
    },
  });
  expect(records[1]).toMatchObject({
    excerpt: "Orbit Mail · Email delivery",
    observation: {
      heading: "Enterprise plan — Provider · Purpose",
      document: "subprocessors",
    },
  });
});

it("recognizes German and English site links without treating them as a privacy policy or an executed contract", async () => {
  const home = load(
    '<a href="/vertrag">Vertrag zur Auftragsverarbeitung</a><a href="/unterauftragnehmer">Unterauftragnehmer</a><a href="/terms">Terms</a>',
  );
  const links = linkedDocuments(home, site);
  expect(links.map((row) => row.kind)).toEqual([
    "dpa",
    "subprocessors",
    "other",
  ]);
  const { rows } = run(
    "",
    {
      "https://reviewed.example/vertrag":
        "<h1>Auftragsverarbeitungsvertrag</h1><p>Wir verarbeiten personenbezogene Daten im Auftrag des Kunden nur für den vereinbarten Zweck.</p>",
      "https://reviewed.example/unterauftragnehmer":
        "<h1>Unterauftragnehmer</h1><p>See our standard terms.</p>",
    },
    links,
  );
  expect(await rows).toMatchObject([
    { kind: "declared_first_party", observation: { document: "dpa" } },
  ]);
});

it("skips self-hosting, unbound providers, sensitive URLs, redirects and generic terms", async () => {
  const html =
    '<p>We use self-hosted Orbit for hosting. <a href="https://orbit.example/dpa">DPA</a></p><p>Our hosting provider is Orbit. <a href="https://unrelated.example/dpa">DPA</a></p><p>Our hosting provider is Orbit. <a href="https://orbit.example/dpa?token=private">DPA</a></p><a href="/legal.pdf">AVV</a><a href="/dpa">DPA</a>';
  const { rows, fetchPage } = run(html, {
    "https://reviewed.example/dpa":
      "<h1>Terms of service</h1><p>" + clause + "</p>",
  });
  expect(await rows).toEqual([]);
  expect(fetchPage.mock.calls.map(([url]) => url.href)).toEqual([
    "https://reviewed.example/legal.pdf",
    "https://reviewed.example/dpa",
  ]);
  const links = linkedDocuments(load('<a href="/dpa">DPA</a>'), site);
  expect(
    await processingDocumentEvidence(
      id,
      site,
      links,
      [],
      async () => ({
        url: new URL("https://elsewhere.example/dpa"),
        html: dpa,
      }),
      new AbortController().signal,
    ),
  ).toEqual([]);
});

it("caps unique document retrieval attempts even on a large index", async () => {
  const root = Array.from(
    { length: 12 },
    (_, i) => '<a href="/legal/' + i + '">AVV</a>',
  ).join("");
  const { rows, fetchPage } = run(root, {});
  expect(await rows).toEqual([]);
  expect(fetchPage).toHaveBeenCalledTimes(4);
});
