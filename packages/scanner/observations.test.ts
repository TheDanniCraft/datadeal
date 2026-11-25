import { expect, it } from "vitest";
import { load } from "cheerio";
import { policySummarySentence } from "@datadeal/contracts";
import { isPrivacyLinkLabel } from "./sitemap";
import {
  externalResourceHosts,
  extractPolicySections,
  isAppOnlyPolicy,
  rejectControlLabel,
  summarizeResponseCookies,
} from "./observations";

it("pairs collection, disclosure and purpose wording with the passage beneath each heading", () => {
  const rows = [
    [
      "How is your personal data collected?",
      "We receive details when you request a quote.",
      "collection",
    ],
    [
      "How We Share Your Personal Data",
      "Our hosting provider stores the completed enquiry.",
      "sharing",
    ],
    [
      "Disclosures of your personal information",
      "A delivery service receives the address for your order.",
      "sharing",
    ],
    [
      "Why We Collect Your Data",
      "We use the project brief to prepare an estimate.",
      "purpose",
    ],
    [
      "We don’t track you through cookies or any other storage methods.",
      "Your settings can still use anonymous cookies and local storage.",
      "purpose",
    ],
    [
      "We do not sell your personal information.",
      "You can request a copy of the information we hold.",
      "sharing",
    ],
  ];
  const markup = load(
    rows.map(([title, text]) => `<h2>${title}</h2><p>${text}</p>`).join("") +
      "<h2>How we share community news</h2><p>Read about our team.</p>",
  );
  expect(
    extractPolicySections(markup).map(({ topic, excerpt }) => [topic, excerpt]),
  ).toEqual(rows.map(([, text, topic]) => [topic, text]));
});

it("recognizes combined privacy links without mistaking cookie settings for a policy", () => {
  expect(isPrivacyLinkLabel("Privacy and cookies")).toBe(true);
  expect(isPrivacyLinkLabel("Cookies & Datenschutz")).toBe(true);
  expect(isPrivacyLinkLabel("Cookie settings")).toBe(false);
});

it("keeps a qualified advertising disclosure later in a purpose section", () => {
  const condition =
    "Depending on your settings, we may personalize ads using your interests.";
  const $ = load(`<main>
    <h2>How we use your data</h2>
    <p>${"We use information to provide and improve requested services. ".repeat(14)}</p>
    <p>${condition}</p>
    <h2>Your rights</h2>
    <p>You can request a copy of your information.</p>
  </main>`);
  const [purpose] = extractPolicySections($);
  expect(purpose.topic).toBe("purpose");
  expect(purpose.excerpt).toContain(condition);
  expect(purpose.excerpt).not.toContain("request a copy");
});

it("keeps question-style collection, use, sharing and transfer passages distinct", () => {
  const headings = [
    "What types of personal data do we collect?",
    "What do we do with your personal data, and why?",
    "Who do we share your personal data with, and why?",
    "Where in the world is your personal data transferred to?",
  ];
  const sections = extractPolicySections(
    load(
      headings
        .map((heading, i) => `<h2>${heading}</h2><p>Disclosure ${i + 1}.</p>`)
        .join(""),
    ),
  );
  expect(sections.map(({ topic, excerpt }) => [topic, excerpt])).toEqual([
    ["collection", "Disclosure 1."],
    ["purpose", "Disclosure 2."],
    ["sharing", "Disclosure 3."],
    ["transfers", "Disclosure 4."],
  ]);
});

it("keeps complete sentences when a policy passage exceeds the citation budget", () => {
  const opening = "We share contact details with our booking provider.";
  const qualified =
    "We share " + "booking information, ".repeat(45) + "only at your request.";
  expect(
    extractPolicySections(
      load(`<h2>Sharing</h2><p>${opening} ${qualified}</p>`),
    )[0]?.excerpt,
  ).toBe(opening);
});

it("keeps wrapped accessible headings paired with their own excerpts", () => {
  const $ = load(`<main>
    <div><div role="heading" aria-level="2">Welche Informationen erheben wir?</div></div>
    <div>We receive the information you submit in a form.</div>
    <div><div role="heading" aria-level="2">Wie verwenden wir deine Informationen?</div></div>
    <div>We use the information to handle that request.</div>
    <div><div role="heading" aria-level="2">Contact</div></div>
    <div>Unrelated text.</div>
  </main>`);
  expect(extractPolicySections($)).toMatchObject([
    {
      topic: "collection",
      excerpt: "We receive the information you submit in a form.",
    },
    {
      topic: "purpose",
      excerpt: "We use the information to handle that request.",
    },
  ]);
});

it("excludes a policy headed for an app while preserving mixed website scope", () => {
  expect(
    isAppOnlyPolicy(
      load("<main><h2>Datenschutzerklärung</h2><h3>Example App</h3></main>"),
    ),
  ).toBe(true);
  expect(
    isAppOnlyPolicy(
      load("<main><h2>Website privacy policy</h2><h3>Example App</h3></main>"),
    ),
  ).toBe(false);
});

it("extracts a policy section without including the next topic or sidebar", () => {
  const markup = load(`<aside><h2>Your rights</h2><p>Sidebar text</p></aside>
    <main><h2>Retention of personal information</h2><p>We keep account data for one year.</p>
    <h2>Contact us</h2><p>Unrelated section.</p></main>`);
  expect(extractPolicySections(markup)).toEqual([
    {
      title: "Retention of personal information",
      excerpt: "We keep account data for one year.",
      topic: "retention",
    },
  ]);
});

it("recognizes collection questions and disclosure headings", () => {
  const markup = load(`<main>
    <h2>What information do we collect?</h2>
    <p>We collect your email address when you create an account.</p>
    <h2>Disclosure of personal information</h2>
    <p>We share your email address with our email delivery provider.</p>
  </main>`);
  expect(extractPolicySections(markup).map(({ topic }) => topic)).toEqual([
    "collection",
    "sharing",
  ]);
});

it("recognizes retention headings phrased as retaining information", () => {
  const markup = load(`<main>
    <h1>Retaining your information</h1>
    <p>We keep contact messages for 30 days.</p>
  </main>`);
  expect(extractPolicySections(markup)).toEqual([
    {
      title: "Retaining your information",
      topic: "retention",
      excerpt: "We keep contact messages for 30 days.",
    },
  ]);
});

it("recognizes German collection and sharing headings", () => {
  const markup = load(`<main lang="de">
    <h2>Welche Daten erheben wir?</h2>
    <p>Wir erheben Ihre E-Mail-Adresse bei der Registrierung.</p>
    <h2>Weitergabe personenbezogener Daten</h2>
    <p>Wir übermitteln Ihre Adresse an den Versanddienstleister.</p>
  </main>`);
  const sections = extractPolicySections(markup);
  expect(sections.map(({ topic }) => topic)).toEqual(["collection", "sharing"]);
  const scanId = "00100000-0000-4000-8000-000000000005";
  expect(
    sections.map(({ title, excerpt, topic }, index) =>
      policySummarySentence(
        {
          id: "section-" + index,
          scanId,
          kind: "declared_first_party",
          excerpt,
          retrievedAt: "2026-01-01T00:00:00Z",
          observation: { type: "policy_section", heading: title, topic },
        },
        scanId,
      ),
    ),
  ).toEqual([
    "Wir erheben Ihre E-Mail-Adresse bei der Registrierung.",
    "Wir übermitteln Ihre Adresse an den Versanddienstleister.",
  ]);
});

it("finds an explicit cookie rejection label without assuming generic controls are for consent", () => {
  const markup = load(`
    <button>Reject all</button>
    <div hidden><button>Reject all cookies</button></div>
    <button disabled>Decline optional cookies</button>
    <dialog open><p>Cookie settings</p><button aria-label="Reject optional">Continue</button></dialog>
  `);
  expect(rejectControlLabel(markup)).toBe("Reject optional");
  expect(
    rejectControlLabel(load("<button>Reject all</button>")),
  ).toBeUndefined();
});

it("collects distinct external script and iframe hostnames only", () => {
  const markup = load(`
    <script src="https://scripts.example.com/app.js?token=private"></script>
    <script src="//scripts.example.com/another.js"></script>
    <iframe src="//media.example.net/embed"></iframe>
    <iframe src="https://site.example.com/own"></iframe>
    <script src="/relative.js"></script>
    <script src="https://name:secret@excluded.example.net/app.js"></script>
    <img src="https://images.example.org/logo.png">
  `);
  expect(
    externalResourceHosts(markup, new URL("https://site.example.com")),
  ).toEqual(["scripts.example.com", "media.example.net"]);
});

it("summarizes declared response cookie attributes without retaining identifiers", () => {
  const result = summarizeResponseCookies([
    "session=private-value; Secure; HttpOnly; SameSite=Strict",
    "preference=another-value; samesite = lax",
    "Secure=not-a-flag; SameSite=invalid",
  ]);
  expect(result).toEqual({
    type: "response_cookie_attributes",
    count: 3,
    secure: 1,
    httpOnly: 1,
    sameSite: 2,
  });
  expect(summarizeResponseCookies([]).count).toBe(0);
});
it("extracts policy sections from standalone bold paragraph headings", () => {
  const $ = load(`<main><p><b>3. Aufruf der Website</b></p>
    <p>We receive <strong>technical browser data</strong> when you visit.</p>
    <p><strong>2. Drittanbieter</strong></p>
    <p>We identify optional providers in the privacy settings.</p></main>`);
  expect(extractPolicySections($)).toMatchObject([
    {
      topic: "collection",
      excerpt: "We receive technical browser data when you visit.",
    },
    {
      topic: "sharing",
      excerpt: "We identify optional providers in the privacy settings.",
    },
  ]);
});
