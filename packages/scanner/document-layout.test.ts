import { createHash } from "node:crypto";
import { load } from "cheerio";
import { expect, it } from "vitest";
import { captureDocument } from "./document-layout";

it("reads complete semantic passages and keeps the historical full-document digest", () => {
  const html = `<main><nav>Legal menu</nav><div role="toolbar">Language settings</div>
    <article><h1>Privacy notice</h1><time>June 17</time><a href="#body">Skip narration</a>
    <p><b>I. Contact</b></p><p>We use <strong>your email</strong> to <a href="/inquiries">answer your inquiry</a>.</p>
    <ul><li>One choice.</li><li>One choice.</li></ul><aside>Subscribe now</aside>
    <p hidden>Staff notes</p><p lang="en">${"Long passage. ".repeat(285)}</p></article></main>`;
  const legacy = load(html);
  legacy("script,style,nav,footer").remove();
  const hash = createHash("sha256")
    .update(legacy("main").text().replace(/\s+/gu, " ").trim())
    .digest("hex");
  const result = captureDocument(load(html))!;
  expect(result.hash).toBe(hash);
  expect(
    result.documentLayout.map(({ kind, start, end }) => [
      kind,
      result.excerpt.slice(start, end),
    ]),
  ).toEqual([
    ["title", "Privacy notice"],
    ["metadata", "June 17"],
    ["heading", "I. Contact"],
    ["paragraph", "We use your email to answer your inquiry."],
    ["item", "One choice."],
    ["item", "One choice."],
  ]);
  expect(result.excerpt).not.toMatch(
    /Language settings|Skip narration|Subscribe now|Staff notes|Long passage/,
  );
});

it("retains a complete title for documents without a readable body and keeps inline text in unwrapped prose", () => {
  expect(
    captureDocument(
      load(
        '<title>Legal notice</title><main><a href="/legal">Directory</a></main>',
      ),
    )?.excerpt,
  ).toBe("Legal notice");
  expect(
    captureDocument(load("<body>Choose <em>what</em> you share.</body>"))
      ?.excerpt,
  ).toBe("Choose what you share.");
});
