import { load } from "cheerio";
import { expect, it } from "vitest";
import { classifyDocument } from "./documents";
import { linkedDocuments } from "./sitemap";

it("discovers explicitly linked PDF policies and agreements on a publisher’s legal host", () => {
  const home = new URL("https://example.org");
  const page =
    load(`<a href="https://legal.example.org/2026/general.pdf">Privacy Policy (PDF, 240 KB)</a>
    <a href="https://legal.example.org/agreements/2026.pdf">Data Processing Agreement (PDF)</a>
    <a href="https://unrelated.example/terms.pdf">Privacy Policy (PDF)</a>
    <a href="https://legal.example.org/private.pdf?token=123">Privacy Policy (PDF)</a>`);
  expect(
    linkedDocuments(page, home, true).map(({ url, kind }) => [url, kind]),
  ).toEqual([
    ["https://legal.example.org/2026/general.pdf", "privacy"],
    ["https://legal.example.org/agreements/2026.pdf", "dpa"],
  ]);
});

it("separates an imprint or contact directory from a nominated privacy policy", () => {
  for (const [path, title, privacy, expected] of [
    ["/impressum-81395212.bild.html", "Impressum", true, "imprint"],
    ["/directory", "Contact directory", true, "contact"],
    ["/cookies", "Cookie Policy", false, "cookies"],
    ["/terms", "Terms of use", false, "terms"],
    ["/privacy", "Privacy notice", true, "privacy"],
    ["/legal", "Legal information", false, "other"],
  ] as const) {
    expect(
      classifyDocument(
        load("<h1>" + title + "</h1>"),
        new URL(path, "https://example.org"),
        privacy,
      ),
    ).toBe(expected);
  }
});
