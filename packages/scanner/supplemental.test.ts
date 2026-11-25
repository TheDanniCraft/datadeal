import { load } from "cheerio";
import { expect, it } from "vitest";
import {
  googleCookieSections,
  supplementalSection,
  supplementalDocuments,
} from "./supplemental";

const policy = new URL("https://policies.google.com/privacy?hl=en");

it("keeps separate named-cookie purposes from the official document for citation", () => {
  const page = load(
    "<main><h2>Functionality</h2><p>SOCS remembers the choices made about using cookies.</p><p>NID can store selected preferences on Search.</p><h2>Advertising</h2><p>NID can be used to show ads on certain services.</p><nav><p>NID appears in a navigation link unrelated to a disclosure.</p></nav><p>Some cookies such as X-NID have similar names.</p></main>",
  );
  const sections = googleCookieSections(
    page,
    new URL("/technologies/cookies?hl=en", policy),
  );
  expect(sections.map((s) => s.title)).toEqual([
    "Functionality",
    "Functionality",
    "Advertising",
  ]);
  expect(sections[2].excerpt).toBe(
    "NID can be used to show ads on certain services.",
  );
  expect(googleCookieSections(page, policy)).toEqual([]);
  expect(
    googleCookieSections(
      page,
      new URL("https://policies.google.com.example.org/technologies/cookies"),
    ),
  ).toEqual([]);
});

it("follows at most one distinct same-origin document for each policy topic", () => {
  const links = supplementalDocuments(
    load(`
    <a href="https://support.google.com/technologies/cookies">Cookie policy</a>
    <a href="https://user@policies.google.com/private">Retention policy</a>
    <a href="/settings?id=private">Cookie policy</a>
    <a href="#cookies">Cookie policy</a>
    <a href="/technologies/retention?hl=en#periods">data retention periods</a>
    <a href="/technologies/cookies?hl=en">how Google uses cookies</a>
    <a href="/second">Cookie notice</a>`),
    policy,
  );
  expect(links.map(({ topic, url }) => [topic, url.href])).toEqual([
    ["retention", "https://policies.google.com/technologies/retention?hl=en"],
    ["cookies", "https://policies.google.com/technologies/cookies?hl=en"],
  ]);
});

it("requires a specific target for generic labels and skips consent controls", () => {
  const links = supplementalDocuments(
    load(`
    <a href="/settings">Learn more</a>
    <a href="/cookies">Cookie settings</a>
    <a href="/manage">Accept all cookies</a>
    <a href="/legal/cookie-policy.html">Read more</a>
    <a href="/legal/retention" aria-label="Retention policy"></a>`),
    policy,
  );
  expect(links.map((item) => item.url.pathname)).toEqual([
    "/legal/cookie-policy.html",
    "/legal/retention",
  ]);
});

it("requires a matching document heading and substantive policy prose", () => {
  expect(
    supplementalSection(
      load(`<title>How Google uses cookies – Privacy &amp; Terms – Google</title>
    <main><p>Session cookies remember preferences for the duration of a visit.</p></main>`),
      "cookies",
    ),
  ).toBeDefined();
  expect(
    supplementalSection(
      load(`<h1>How Google retains data we collect</h1>
    <main><p>We delete support records when their retention period ends.</p></main>`),
      "retention",
    ),
  ).toBeDefined();
  expect(
    supplementalSection(
      load(
        `<h1>Cookie settings</h1><p>Use the controls to accept or reject optional cookies.</p>`,
      ),
      "cookies",
    ),
  ).toBeUndefined();
  expect(
    supplementalSection(
      load(`<h1>Retention policy</h1><nav><p>Retention periods for each of our products</p></nav>
      <main><p><a href="/policy">Read more about retention practices for our services</a></p></main>`),
      "retention",
    ),
  ).toBeUndefined();
  expect(
    supplementalSection(
      load(
        `<h1>Privacy policy</h1><p>We delete support records after one month.</p>`,
      ),
      "retention",
    ),
  ).toBeUndefined();
});
