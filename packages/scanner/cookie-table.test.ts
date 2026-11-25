import { load } from "cheerio";
import { expect, it } from "vitest";
import { cookieTableSections } from "./cookie-table";
import { findDocuments } from "./documents";

const table = `<table><thead><tr><th>Purpose</th><th>Cookie name</th><th>Duration</th></tr></thead>
  <tbody><tr><td>Remembers the selected region.</td><td>region_choice</td><td>One month</td></tr>
  <tr hidden><td>Hidden row for an old version.</td><td>old</td><td>Expired</td></tr>
  <tr><td colspan="3">Navigation and unrelated text</td></tr></tbody></table>`;

it("keeps an explicitly named cookie with its own purpose in an ordinary site's published policy", async () => {
  const homepage = new URL("https://example.org/");
  const docs = await findDocuments(
    homepage,
    [{ kind: "privacy", label: "Privacy", url: "https://example.org/privacy" }],
    [],
    undefined,
    async (url) => ({
      url,
      html: `<main><h1>Privacy policy</h1><p>We use cookies to remember your preferences when you return to our website.</p>${table}</main>`,
    }),
    new AbortController().signal,
  );
  const policy = docs.find((d) => d.privacy);
  expect(policy?.sections).toContainEqual({
    title: "region_choice",
    topic: "purpose",
    excerpt: "Remembers the selected region. region_choice One month",
  });
  expect(policy?.sections.some((s) => s.title === "old")).toBe(false);
});

it("restricts generic Name headers to cookie documents and skips unrelated tables", () => {
  const page = load(table.replace("Cookie name", "Name"));
  expect(cookieTableSections(page, false)).toEqual([]);
  expect(cookieTableSections(page, true)).toHaveLength(1);
  expect(
    cookieTableSections(load(table.replace("Purpose", "Price")), true),
  ).toEqual([]);
});
