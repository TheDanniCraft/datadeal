import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
import { scan } from "./index";

const { request, lookup } = vi.hoisted(() => ({
  request: vi.fn(),
  lookup: vi.fn(),
}));

vi.mock("node:https", () => ({ request }));
vi.mock("node:dns/promises", () => ({
  lookup,
  Resolver: class {
    async resolveCname() {
      return [];
    }
  },
}));

const scanId = "11000000-0000-4000-8000-000000000001";

function mockResponse(statusCode: number, headers: object, html = "") {
  request.mockImplementationOnce((_url, _options, callback) =>
    Object.assign(new EventEmitter(), {
      end: () =>
        callback(
          Object.assign(Readable.from([Buffer.from(html)]), {
            statusCode,
            headers,
          }),
        ),
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  lookup.mockResolvedValue([{ address: "93.184.215.14", family: 4 }]);
});

it("follows the exact HTTPS www alias and retrieves policies on that origin", async () => {
  mockResponse(301, { location: "https://www.example.com/" });
  mockResponse(
    200,
    { "content-type": "text/html" },
    `
    <a href="/privacy">Privacy policy</a>
      <a href="/article">Privacy policy changes spark debate</a>
    <a href="https://example.com/terms">Terms</a>
  `,
  );
  mockResponse(404, {});
  mockResponse(404, {});
  mockResponse(
    200,
    { "content-type": "text/html" },
    "<p>We process inquiries submitted through the contact form.</p>",
  );

  const report = await scan(scanId, "example.com");
  expect(report.domain).toBe("example.com");
  expect(report.evidence.map(({ url }) => url)).toEqual([
    "https://www.example.com/",
    "https://www.example.com/privacy",
  ]);
  expect(request.mock.calls.map(([url]) => url.href)).toEqual([
    "https://example.com/",
    "https://www.example.com/",
    "https://www.example.com/robots.txt",
    "https://www.example.com/sitemap.xml",
    "https://www.example.com/privacy",
  ]);
});

// URL-keyed fixtures keep assertions about real request destinations independent of fetch order.
function mockPages(pages: Record<string, string | { location: string }>) {
  request.mockImplementation((url: URL, _options, callback) => {
    const page = pages[url.href];
    return Object.assign(new EventEmitter(), {
      end: () =>
        callback(
          Object.assign(
            Readable.from([Buffer.from(typeof page === "string" ? page : "")]),
            {
              statusCode: typeof page === "string" ? 200 : page ? 302 : 404,
              headers:
                typeof page === "string"
                  ? { "content-type": "text/html" }
                  : (page ?? {}),
            },
          ),
        ),
    });
  });
}

it("preserves the governing consent passage and named vendors beyond the section preview, and follows only scoped disclosures", async () => {
  const policy = "https://example.com/privacy";
  const directory = "https://example.com/privacy/vendors";
  const vendorPolicy = "https://audience.example.org/privacy/";
  const condition =
    "When you consent, we use browser identifiers for personalized advertising and audience measurement.";
  const lead =
    "The following advertising partners are independent controllers for their own processing.";
  const referral =
    "Our Privacy Manager lists the advertising providers for this service.";
  mockPages({
    "https://example.com/": '<a href="/privacy">Privacy policy</a>',
    [policy]: `<main><h1>Privacy policy</h1><h2>Advertising partners</h2>
      <p>${"Policy background. ".repeat(54)}</p><p>${condition}</p><p>${lead}</p><ul>
      <li>Audience Inc. <a href="${vendorPolicy}">Privacy policy</a></li>
      <li>Private link <a href="file:///C:/Downloads/private.html">Privacy</a></li>
      <li>Secret link <a href="https://bad.example.org/privacy?token=secret">Privacy</a></li>
      <li>Escaped path <a href="https://bad.example.org/privacy/%5Cprivate">Privacy</a></li></ul>
      <p>Our <a href="/privacy/vendors">Privacy Manager</a> lists the advertising providers for this service.</p>
      <p>See another <a href="https://other.example.org/manage">Privacy Manager</a> for advertising.</p>
      <h2>Security</h2><p>We do not use the following advertising partners.</p><ul><li>Never Used <a href="https://unused.example/privacy">Privacy</a></li></ul></main>`,
    [directory]: `<main><h1>Advertising partners</h1><p>${lead}</p><ul>
      <li>Creative Media <a href="https://creative.example.net/privacy">Policy</a></li></ul></main>`,
    [vendorPolicy]:
      "<main><h1>Privacy policy</h1><h2>How we use information</h2><p>We use browser events for advertising campaign measurement on publisher sites.</p></main>",
  });
  const report = await scan(scanId, "example.com");
  const rows = report.evidence;
  const member = rows.find(
    (e) =>
      e.observation?.type === "policy_section" &&
      e.observation.vendorListing?.policyUrl === vendorPolicy,
  )!;
  expect(member).toMatchObject({
    kind: "declared_first_party",
    url: policy,
    excerpt: "Audience Inc. Privacy policy",
  });
  if (member.observation?.type !== "policy_section")
    throw Error("Missing list entry");
  const contextId = member.observation.vendorListing!.contextEvidenceId;
  const context = rows.find((e) => e.id === contextId);
  expect(context).toMatchObject({
    url: policy,
    excerpt: condition + " " + lead,
    kind: "declared_first_party",
  });
  expect(
    rows.find(
      (e) =>
        e.observation?.type === "provider_policy" &&
        e.observation.referringEvidenceId === member.id,
    ),
  ).toMatchObject({
    kind: "third_party_reference",
    url: vendorPolicy,
    excerpt:
      "We use browser events for advertising campaign measurement on publisher sites.",
  });
  const directoryContext = rows.find(
    (e) =>
      e.url === directory &&
      e.observation?.type === "policy_section" &&
      e.observation.directoryReferralId,
  );
  if (directoryContext?.observation?.type !== "policy_section")
    throw Error("Missing directory context");
  const referralId = directoryContext.observation.directoryReferralId;
  expect(rows.find((e) => e.id === referralId)).toMatchObject({
    url: policy,
    excerpt: referral,
    kind: "declared_first_party",
  });
  expect(
    request.mock.calls
      .map(([u]) => u.href)
      .filter((url) =>
        /bad\.example|other\.example|unused\.example|file:/.test(url),
      ),
  ).toEqual([]);
});

it("follows the public Privacy link on GitHub’s homepage to its localized docs statement", async () => {
  // Verified on the public homepage: the visible label is simply “Privacy”.
  const path = "/site-policy/privacy-policies/github-general-privacy-statement";
  const docs = "https://docs.github.com";
  mockPages({
    "https://github.com/":
      '<footer><a href="' + docs + path + '">Privacy</a></footer>',
    [docs + path]: { location: "/en" + path },
    [docs + "/en" + path]:
      "<main><h1>GitHub General Privacy Statement</h1><h2>Personal Data We Collect</h2><p>We collect your account details.</p></main>",
  });
  const report = await scan(scanId, "github.com");
  expect(report.evidence).toContainEqual(
    expect.objectContaining({
      kind: "declared_first_party",
      url: docs + "/en" + path,
      observation: expect.objectContaining({
        type: "policy_section",
        topic: "collection",
      }),
    }),
  );
  expect(report.findings.some((f) => f.rule === "policy_available")).toBe(true);
});

it("accepts an image-labelled public agreement on a dedicated legal host", async () => {
  const dpa = "https://legal.example.com/documents/controller-terms";
  mockPages({
    "https://www.example.com/":
      '<footer><a href="' +
      dpa +
      '"><img alt="Data processing agreement"></a></footer>',
    [dpa]:
      "<main><h1>Data Processing Agreement</h1><p>We process personal data on documented instructions from the customer.</p></main>",
  });
  const report = await scan(scanId, "www.example.com");
  expect(report.evidence).toContainEqual(
    expect.objectContaining({
      kind: "declared_first_party",
      url: dpa,
      observation: expect.objectContaining({
        type: "processing_document",
        document: "dpa",
      }),
    }),
  );
  expect(report.findings.some((f) => f.rule === "policy_available")).toBe(
    false,
  );
});

it("a dedicated host permits only a labelled public document and public same-origin redirects", async () => {
  const legal = "https://legal.example.com";
  mockPages({
    "https://example.com/": [
      '<a href="' + legal + '/privacy">Learn more</a>',
      '<a href="' + legal + '/account">Privacy policy</a>',
      '<a href="' + legal + '/policy?member=123">Privacy policy</a>',
      '<a href="https://legal.example.com.unrelated.net/privacy">Privacy policy</a>',
      '<a href="https://community.example.com/privacy">Privacy policy</a>',
      '<a href="' + legal + '/notice">Privacy policy</a>',
      '<a href="' + legal + '/statement">Privacy policy</a>',
      '<a href="' + legal + '/placeholder">Privacy policy</a>',
    ].join(""),
    [legal + "/notice"]: { location: "/login" },
    [legal + "/statement"]: { location: "https://docs.example.com/privacy" },
    [legal + "/placeholder"]: "<h1>Contact us</h1><p>We process inquiries.</p>",
  });
  const report = await scan(scanId, "example.com");
  expect(
    request.mock.calls
      .map(([url]) => url.href)
      .filter((url) => new URL(url).origin !== "https://example.com"),
  ).toEqual([legal + "/notice", legal + "/statement", legal + "/placeholder"]);
  expect(report.findings.some((f) => f.rule === "policy_available")).toBe(
    false,
  );
});

it("keeps hosted public-suffix tenants separate during document discovery", async () => {
  mockPages({
    "https://github.io/":
      '<a href="https://docs.github.io/privacy">Privacy policy</a>',
  });
  await scan(scanId, "github.io");
  expect(
    request.mock.calls.every(([url]) => url.hostname === "github.io"),
  ).toBe(true);
});

it("checks the document host's public DNS addresses before making its request", async () => {
  lookup.mockImplementation(async (host) => [
    {
      address: host === "docs.example.com" ? "192.168.1.1" : "93.184.215.14",
      family: 4,
    },
  ]);
  mockPages({
    "https://example.com/":
      '<a href="https://docs.example.com/privacy">Privacy</a>',
  });
  const report = await scan(scanId, "example.com");
  expect(lookup.mock.calls.some(([host]) => host === "docs.example.com")).toBe(
    true,
  );
  expect(
    request.mock.calls.every(([url]) => url.hostname === "example.com"),
  ).toBe(true);
  expect(report.findings.some((f) => f.rule === "policy_available")).toBe(
    false,
  );
});

it("opens a prose-filled privacy hub and cites the visitor policy behind it", async () => {
  mockPages({
    "https://example.com/": '<a href="/center">Privacy</a>',
    "https://example.com/center":
      '<main><h1>Privacy center</h1><p>Read how we use your information and find the right document for the service you use.</p><a href="/app">Privacy policy</a><a href="/web">Privacy notice</a></main>',
    "https://example.com/app":
      "<main><h1>Mobile app privacy policy</h1><p>We use your location when navigating.</p></main>",
    "https://example.com/web":
      "<main><h1>Website privacy notice</h1><h2>Data we collect</h2><p>We store your contact details when you submit an inquiry.</p></main>",
  });
  const report = await scan(scanId, "example.com");
  expect(
    report.evidence
      .filter((item) => item.kind === "declared_first_party")
      .map((item) => item.url),
  ).toEqual(["https://example.com/web", "https://example.com/web"]);
});

it("retains a first-party policy with negative statements and links to feature-specific policies", async () => {
  const url = "https://example.com/privacy";
  mockPages({
    "https://example.com/": '<a href="/privacy">Privacy Policy</a>',
    [url]:
      '<title>Example Privacy Policy</title><main><h1>We don’t track you.</h1><h2>About us</h2><p>We provide a search engine.</p><h2>Privacy Policy</h2><p>We never store any information that could identify your searches or browsing history.</p><a href="/mail/privacy">Email Privacy Policy</a></main>',
  });
  const report = await scan(scanId, "example.com");
  expect(report.evidence).toContainEqual(
    expect.objectContaining({
      kind: "declared_first_party",
      documentKind: "privacy",
      url,
      excerpt: expect.stringContaining("We never store any information"),
    }),
  );
});

it("requests English throughout discovery and cites the validated translation in the same jurisdiction", async () => {
  const german = "https://example.com/de/datenschutz?region=eu";
  const english = "https://example.com/en/privacy?region=eu";
  mockPages({
    "https://example.com/":
      '<a href="/de/datenschutz?region=eu&utm_source=tracker">Datenschutz</a>',
    [german]:
      '<html lang="de"><head><link rel="alternate" hreflang="en-US" href="/us/privacy"><link rel="alternate" hreflang="en" href="/en/privacy?region=us"><link rel="alternate" hreflang="en" href="/en/privacy?region=eu"></head><main><h1>Datenschutz</h1><p>Wir verarbeiten Ihre Daten.</p></main></html>',
    [english]:
      '<html lang="en"><main><h1>Privacy policy</h1><h2>How do we use your information?</h2><p>We use your email to reply when you ask for help.</p><h2>How do we share information with third parties?</h2><p>We share information with our email provider to deliver your reply.</p></main></html>',
  });
  const report = await scan(scanId, "example.com");
  const sources = report.evidence.filter(
    (e) => e.kind === "declared_first_party",
  );
  expect(sources.map((e) => e.url)).toEqual([english, english, english]);
  expect(
    sources
      .slice(1)
      .map(
        (e) => e.observation?.type === "policy_section" && e.observation.topic,
      ),
  ).toEqual(["purpose", "sharing"]);
  expect(
    request.mock.calls.every(
      ([, opts]) => opts.headers["Accept-Language"] === "en",
    ),
  ).toBe(true);
  expect(
    request.mock.calls
      .map(([url]) => url.href)
      .filter(
        (href) =>
          href.includes("/us/") ||
          href.includes("region=us") ||
          href.includes("tracker"),
      ),
  ).toEqual([]);
});

it.each([
  "blocked",
  "wrong language",
  "wrong region after redirect",
  "not a policy",
])(
  "retains original cited evidence when the same-policy English alternate is %s",
  async (outcome) => {
    const original =
      '<html lang="de"><head><link rel="alternate" hreflang="en" href="https://outside.test/privacy"></head><main><h1>Datenschutz</h1><p>Wir verarbeiten Ihre Daten.</p><a href="/privacy?lang=en">English</a></main></html>';
    const variants: Record<string, string | { location: string }> = {
      "wrong language":
        '<html lang="de"><h1>Datenschutz</h1><p>Wir verarbeiten Ihre Daten.</p></html>',
      "wrong region after redirect": { location: "/us/privacy" },
      "not a policy":
        '<html lang="en"><h1>Welcome</h1><p>Sign in to view this page.</p></html>',
    };
    mockPages({
      "https://example.com/": '<a href="/privacy">Datenschutz</a>',
      "https://example.com/privacy": original,
      "https://example.com/us/privacy":
        '<html lang="en"><h1>Privacy policy</h1><p>We process inquiries.</p></html>',
      ...(outcome === "blocked"
        ? {}
        : { "https://example.com/privacy?lang=en": variants[outcome] }),
    });
    const report = await scan(scanId, "example.com");
    expect(request.mock.calls.map(([url]) => url.hostname)).not.toContain(
      "outside.test",
    );
    expect(
      report.evidence
        .filter((e) => e.kind === "declared_first_party")
        .map((e) => e.url),
    ).toEqual(["https://example.com/privacy"]);
  },
);

it("validates ambiguous AI nominations against the pages and uses bounded local link IDs", async () => {
  mockPages({
    "https://example.com/": '<a href="/legal">Legal</a>',
    "https://example.com/legal":
      '<a href="/choices">Your personal data choices</a><a href="/handling">Our data practices</a><a href="https://outside.test/p">Privacy</a>',
    "https://example.com/choices":
      "<h1>Privacy policy</h1><p>Use these settings to update your choices.</p>",
    "https://example.com/handling":
      "<main><h1>Our data practices</h1><h2>Data we collect</h2><p>We store your email address only when you subscribe to the newsletter.</p></main>",
  });
  const select = vi.fn(
    async (
      candidates: readonly { id: string; label: string; path: string }[],
    ) => candidates.map((c) => c.id),
  );
  const report = await scan(scanId, "example.com", select);
  expect(select.mock.calls[0][0].map((c) => c.path)).toEqual([
    "/choices",
    "/handling",
  ]);
  expect(
    report.evidence
      .filter((item) => item.kind === "declared_first_party")
      .every((item) => item.url?.endsWith("/handling")),
  ).toBe(true);
  expect(report.findings.some((f) => f.rule === "policy_available")).toBe(true);
});

it.each(["unknown ID", "provider error"])(
  "tries ordinary policy paths after a selector %s",
  async (state) => {
    mockPages({
      "https://example.com/": '<a href="/practices">Our data practices</a>',
      "https://example.com/privacy":
        "<h1>Privacy policy</h1><p>We process inquiries.</p>",
    });
    const select = vi.fn(async () => {
      if (state === "provider error") throw new Error("unavailable");
      return ["https://outside.test/privacy"];
    });
    const report = await scan(scanId, "example.com", select);
    expect(select).toHaveBeenCalledOnce();
    expect(report.findings.some((f) => f.rule === "policy_available")).toBe(
      true,
    );
    expect(request.mock.calls.map(([url]) => url.href)).not.toContain(
      "https://outside.test/privacy",
    );
  },
);

it("cites linked cookie and retention policy passages on the verified official policy origin", async () => {
  const cookie =
    "Session cookies remember your selected language until you close your browser.";
  const retention =
    "We delete contact details within thirty days after the inquiry is closed.";
  const policy = "https://policies.google.com/";
  mockPages({
    "https://google.com/": "<main>Search</main>",
    [policy + "privacy?hl=en"]:
      '<h1>Privacy policy</h1><p>We process inquiries.</p><a href="/cookies?hl=en">Cookie policy</a><a href="/retention">Retention policy</a>',
    [policy + "cookies?hl=en"]:
      "<h1>Cookie policy</h1><main><p>" + cookie + "</p></main>",
    [policy + "retention"]:
      "<h1>Retention policy</h1><main><p>" + retention + "</p></main>",
  });
  const report = await scan(scanId, "google.com");
  for (const [url, excerpt, title] of [
    [policy + "cookies?hl=en", cookie, "Cookie policy"],
    [policy + "retention", retention, "Retention policy"],
  ]) {
    expect(report.evidence).toContainEqual(
      expect.objectContaining({
        url,
        excerpt,
        kind: "declared_first_party",
        observation: expect.objectContaining({
          type: "policy_section",
          heading: title,
        }),
      }),
    );
  }
  expect(report.findings.map((f) => f.rule)).toEqual(["policy_available"]);
});

it("rejects a supplemental redirect off the verified policy origin and a cookie settings page", async () => {
  mockPages({
    "https://example.com/": '<a href="/privacy">Privacy policy</a>',
    "https://example.com/privacy":
      '<h1>Privacy policy</h1><p>We process inquiries.</p><a href="/settings">Cookie policy</a><a href="/retention">Retention policy</a>',
    "https://example.com/settings":
      "<h1>Cookie settings</h1><p>Choose whether you accept optional cookies on this website.</p>",
    "https://example.com/retention": {
      location: "https://outside.test/retention",
    },
  });
  const report = await scan(scanId, "example.com");
  expect(
    report.evidence
      .filter((item) => item.kind === "declared_first_party")
      .map((item) => item.url),
  ).toEqual(["https://example.com/privacy"]);
  expect(request.mock.calls.map(([url]) => url.hostname)).not.toContain(
    "outside.test",
  );
});

it("stops before requesting an unrelated homepage redirect", async () => {
  mockResponse(301, { location: "https://example.net/" });
  await expect(scan(scanId, "example.com")).rejects.toThrow(
    "Redirect outside scan scope",
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it("stores one citation when two links resolve to the same policy", async () => {
  mockResponse(
    200,
    { "content-type": "text/html" },
    `
    <a href="/privacy">Privacy policy</a>
    <a href="/datenschutz">Datenschutz</a>
  `,
  );
  const policy = "<h2>Ihre Rechte</h2><p>Sie können Auskunft verlangen.</p>";
  mockResponse(404, {});
  mockResponse(404, {});
  mockResponse(200, { "content-type": "text/html" }, policy);
  mockResponse(301, { location: "/privacy" });
  mockResponse(200, { "content-type": "text/html" }, policy);

  const report = await scan(scanId, "example.com");
  expect(
    report.evidence
      .filter(({ kind }) => kind === "declared_first_party")
      .map(({ id }) => id),
  ).toEqual(["document-1", "document-1-section-1"]);
});

it("retrieves a sitemap-only privacy page and skips an off-origin sitemap", async () => {
  mockResponse(200, { "content-type": "text/html" }, "<main>Welcome</main>");
  mockResponse(
    200,
    { "content-type": "text/plain" },
    "Sitemap: https://example.net/sitemap.xml",
  );
  mockResponse(
    200,
    { "content-type": "application/xml" },
    "<sitemapindex><sitemap><loc>https://example.com/pages.xml</loc></sitemap></sitemapindex>",
  );
  mockResponse(
    200,
    { "content-type": "application/xml" },
    "<urlset><url><loc>https://example.com/legal/privacy-policy</loc></url></urlset>",
  );
  mockResponse(
    200,
    { "content-type": "text/html" },
    "<main><h1>Privacy policy</h1><p>We process inquiries.</p></main>",
  );
  const report = await scan(scanId, "example.com");
  expect(report.findings).toContainEqual(
    expect.objectContaining({ rule: "policy_available" }),
  );
  expect(report.evidence).toContainEqual(
    expect.objectContaining({
      url: "https://example.com/legal/privacy-policy",
      kind: "declared_first_party",
    }),
  );
  expect(request.mock.calls.map(([url]) => url.hostname)).not.toContain(
    "example.net",
  );
});

it("checks common same-origin privacy addresses without accepting a generic response", async () => {
  mockResponse(200, { "content-type": "text/html" }, "<main>Welcome</main>");
  mockResponse(404, {});
  mockResponse(404, {});
  mockResponse(200, { "content-type": "text/html" }, "<h1>Welcome</h1>");
  mockResponse(
    200,
    { "content-type": "text/html" },
    "<main><h1>Privacy policy</h1><p>We process inquiries.</p></main>",
  );
  const report = await scan(scanId, "example.com");
  expect(report.findings).toContainEqual(
    expect.objectContaining({ rule: "policy_available" }),
  );
  expect(
    report.evidence.filter(({ kind }) => kind === "declared_first_party"),
  ).toMatchObject([{ url: "https://example.com/privacy-policy" }]);
  expect(request.mock.calls.map(([url]) => url.pathname)).not.toContain(
    "/datenschutz",
  );
});
