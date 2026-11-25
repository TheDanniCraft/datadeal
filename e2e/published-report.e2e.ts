import { viewEvidenceInReport } from "./report-citation";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const domain = process.env.DATADEAL_PARTIAL_TEST_DOMAIN;
const ratedDomain = process.env.DATADEAL_TEST_PUBLISHED_RATED_DOMAIN;
const advancedEmail = process.env.DATADEAL_ADVANCED_TEST_EMAIL;
const outbox = process.env.DATADEAL_AUTH_TEST_MAIL_FILE;
const resourceHost = process.env.DATADEAL_RESOURCE_TEST_HOST;
const dnsAlias = process.env.DATADEAL_TEST_DNS_ALIAS;
const policyUrl = process.env.DATADEAL_POLICY_TEST_URL;
const browserEvidence = process.env.DATADEAL_TEST_BROWSER_EVIDENCE === "true";
const compareChoices = process.env.DATADEAL_TEST_CONSENT_CHOICES === "true";
const choiceCounts = (process.env.DATADEAL_TEST_CONSENT_COUNTS ?? "1,2").split(
  ",",
);
const browserDestination = process.env.DATADEAL_TEST_BROWSER_DESTINATION;
const respondingDestination = process.env.DATADEAL_TEST_BROWSER_RESPONSE;
const expectedDestinations =
  process.env.DATADEAL_TEST_BROWSER_DESTINATION_COUNT;

test("waits for the scan button to be interactive and queues the first request", async ({
  page,
}) => {
  test.skip(
    process.env.DATADEAL_TEST_SCAN_REQUEST !== "true",
    "Requires an isolated scan queue",
  );
  const host = `scan-readiness-${randomUUID()}.example.com`;
  let releaseScripts: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route("**/_next/static/**/*.js", async (route) => {
    await scriptsReady;
    await route.continue();
  });
  const button = page.getByRole("button", { name: "Request a scan" });
  try {
    await page.goto("/report/" + host, { waitUntil: "commit" });
    await expect(button).toBeDisabled();
  } finally {
    releaseScripts!();
  }
  const reject = page.getByRole("button", {
    name: /reject all|reject optional/i,
  });
  await reject.click();
  await expect(button).toBeEnabled();
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/domains/" + host) &&
        response.request().method() === "POST",
    ),
    button.click(),
  ]);
  expect(response.status()).toBe(202);
  await expect(
    page.getByRole("heading", { name: "Scan in progress" }),
  ).toBeVisible();
});

async function expectPublishedGuestSummary(page: Page) {
  const summary = page.getByRole("region", {
    name: /^(AI analysis|Scan summary)$/,
  });
  await expect(summary).toBeVisible();
  await expect(summary.locator("p").first()).toContainText(/\S/);
  await expect(summary).not.toContainText(
    /starting (?:score|from)|(?:^|\s)[+−]\d+\b|\b\d+\s*\/\s*100\b|\b\d+\s*[+−-]\s*\d+\s*=\s*\d+\b/i,
  );
  await expect(
    summary.getByRole("region", {
      name: "Advanced report preview",
      includeHidden: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("Sample data", { exact: true })).toHaveCount(0);
}

async function signInForAdvancedReport(page: Page) {
  if (!advancedEmail || !outbox)
    throw new Error("Configure a local Pro account and test mail outbox");
  await page.goto("/account");
  await page.getByLabel("Email address").fill(advancedEmail);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Your sign-in link is in the local outbox."),
  ).toBeVisible();
  await page.goto((await readFile(outbox, "utf8")).trim());
  await page.goto("/report/" + domain);
}

test("compares methodology versions without replacing the archived rating", async ({
  page,
}) => {
  test.skip(
    !domain ||
      process.env.DATADEAL_TEST_RATED_HISTORY !== "true" ||
      !advancedEmail ||
      !outbox,
    "Requires two rated snapshots and a local Pro account",
  );
  await page.goto("/report/" + domain);
  await page
    .getByRole("button", { name: /reject all|reject optional/i })
    .click();
  await signInForAdvancedReport(page);
  const history = page.locator("#history");
  await expect(
    history.getByText(/some scans used different scoring rules/i),
  ).toBeVisible();
  await expect(history.getByText("70/100 · Mixed")).toBeVisible();
  await expect(history.getByText("75/100 · Good")).toBeVisible();
  await history.getByRole("link", { name: "View scan" }).click();
  await expect(
    page.getByRole("meter", { name: "DataDeal privacy score" }),
  ).toHaveAttribute("aria-valuenow", "75");
  await history.getByRole("link", { name: "View latest scan" }).click();
  await expect(
    page.getByRole("meter", { name: "DataDeal privacy score" }),
  ).toHaveAttribute("aria-valuenow", "70");
});

test("the archived DanniCraft summary cites the confirmed accept-all visit and its policy", async ({
  page,
}) => {
  test.skip(
    process.env.DATADEAL_TEST_DANNICRAFT_SUMMARY !== "true",
    "Requires the archived November 25 DanniCraft scan",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    "/report/thedannicraft.de?scan=508c1c7d-5f04-42ef-b256-b2fb206580ac",
  );
  const reject = page.getByRole("button", {
    name: /reject all|reject optional/i,
  });
  await page.addLocatorHandler(reject, () => reject.click());
  const rating = page.getByRole("region", {
    name: "Privacy rating",
    exact: true,
  });
  await expect(rating).toContainText("Unrated");
  await expect(rating.getByRole("meter")).toHaveCount(0);
  const summary = page.getByRole("region", {
    name: /^(AI analysis|Scan summary)$/,
  });
  await expect(summary).not.toContainText(
    /(?:no|zero|0) cookies|no (?:web|browser) storage|before (?:a|the) choice/i,
  );
  const accepted = summary.locator(
    'a[href="#evidence-browser-consent-accepted"]',
  );
  await expect(accepted).toContainText(
    /after accepting all.*homepage.*(?:one|1) cookie.*(?:one|1) (?:item in local storage|local storage entr)/i,
  );
  await expect(
    summary.locator('a[href*="browser-consent-default"]'),
  ).toHaveCount(0);
  for (const [citation, pattern] of [
    [accepted, /cookie/i],
    [
      summary.getByRole("link", {
        name: /inquiry.*Chatwoot|Chatwoot.*inquiry/i,
      }),
      /Chatwoot/i,
    ],
    [
      summary.getByRole("link", {
        name: /Morgen.*booking information|booking.*Morgen/i,
      }),
      /Morgen/i,
    ],
  ] as const) {
    const fragment = await citation.getAttribute("href");
    expect(fragment).toMatch(
      /^#evidence-(?:browser-consent-accepted|document-\d+-section-\d+)$/,
    );
    await citation.press("Enter");
    const dialog = page.getByRole("dialog");
    const quote = await citation.getAttribute("data-citation-quote");
    if (quote) await expect(dialog.locator("mark")).toHaveText(quote);
    else await expect(dialog.locator("mark")).toContainText(pattern);
    await expect(dialog.locator("a[target='_blank']")).toHaveAttribute(
      "href",
      /^https?:\/\//,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(citation).toBeFocused();
    await citation.click();
    await viewEvidenceInReport(page);
    await expect(page.locator(fragment!)).toBeInViewport();
    await expect(page.locator(fragment!)).toContainText(pattern);
  }
  const documents = page.getByRole("link", {
    name: /Storage (?:&|and) Cookies.*legal\/cookies/i,
  });
  await documents.press("Enter");
  const reader = page.getByRole("dialog");
  await expect(
    reader.getByRole("heading", { name: "Storage & Cookies", exact: true }),
  ).toBeVisible();
  await expect(
    reader
      .getByRole("article")
      .getByRole("heading", { name: "What is stored in your browser" }),
  ).toBeVisible();
  await expect(
    reader.getByRole("link", { name: "Open original document" }),
  ).toHaveAttribute("href", "https://thedannicraft.de/legal/cookies");
  await reader.getByRole("button", { name: "Close evidence" }).press("Enter");
  await expect(documents).toBeFocused();
  if (compareChoices) {
    const visits = page
      .getByRole("heading", { name: "Consent visits", exact: true })
      .locator("..");
    for (const [scenario, label] of [
      ["default", "Default visit"],
      ["rejected", "Optional consent rejected"],
      ["accepted", "Optional consent accepted"],
    ]) {
      await expect(visits.getByText(label, { exact: true })).toBeVisible();
      await expect(
        visits.locator(`a[href="#evidence-browser-consent-${scenario}"]`),
      ).toBeVisible();
    }
  }
});

test("the archived BILD headline cites accepted homepage totals separately from a sampled page", async ({
  page,
}) => {
  test.skip(
    ratedDomain !== "bild.de",
    "Requires the archived November 25 BILD scan",
  );
  await page.goto("/report/bild.de?scan=13bdb3c8-f0db-4a5c-8b2c-c703ac2b5b8c");
  const reject = page.getByRole("button", {
    name: /reject all|reject optional/i,
  });
  await page.addLocatorHandler(reject, () => reject.click());
  const rating = page.getByRole("region", {
    name: "Privacy rating",
    exact: true,
  });
  await expect(rating).toContainText("After accepting all");
  await expect(rating.getByRole("meter")).toHaveAttribute(
    "aria-valuenow",
    "70",
  );
  const summary = page.getByRole("region", {
    name: /^(AI analysis|Scan summary)$/,
  });
  const accepted = summary.locator(
    'a[href="#evidence-browser-consent-accepted"]',
  );
  await expect(accepted).toContainText(
    /37 cookies.*41 items in local storage.*6 items in session storage/i,
  );
  await expect(
    summary.locator('a[href="#evidence-browser-page-3-accepted"]'),
  ).toContainText(/sampled page.*permutive\.app/i);
  await expect(summary.locator('a[href*="consent-default"]')).toHaveCount(0);
  await accepted.click();
  await expect(page.getByRole("dialog").locator("mark")).toContainText(
    /37 cookies|cookies at end.{0,8}37/i,
  );
});

test("keeps calculation details collapsed on a published rated guest report", async ({
  page,
}) => {
  test.skip(!ratedDomain, "Requires a published rated scan on the test server");
  const response = await page.request.get(`/api/v1/domains/${ratedDomain}`);
  await expect(response).toBeOK();
  const { report } = await response.json();
  expect(report).toMatchObject({ demo: false, score: expect.any(Number) });
  await page.goto(`/report/${ratedDomain}`);
  const reject = page.getByRole("button", {
    name: /reject all|reject optional/i,
  });
  await page.addLocatorHandler(reject, () => reject.click());
  await expect(
    page.getByRole("meter", { name: "DataDeal privacy score" }),
  ).toHaveAttribute("aria-valuenow", String(report.score));
  await expectPublishedGuestSummary(page);

  if (ratedDomain === "bild.de") {
    const summary = page.getByRole("region", {
      name: /^(AI analysis|Scan summary)$/,
    });
    for (const [label, fragment, excerpt] of [
      [
        /policy.*third-party advertising/i,
        /^#evidence-document-/,
        /werbe|advertis/i,
      ],
      [
        /permutive\.app.*event.*identifier/i,
        /^#evidence-browser-(?:page|network)-/,
        /identifier|advertising ID|email field/i,
      ],
    ] as const) {
      const link = summary.getByRole("link", { name: label });
      const target = await link.getAttribute("href");
      expect(target).toMatch(fragment);
      await link.click();
      await viewEvidenceInReport(page);
      const source = page.locator(target!);
      await expect(source).toBeInViewport();
      await expect(source).toContainText(excerpt);
    }
  }

  const breakdown = page.getByRole("button", {
    name: "How this score was calculated",
  });
  const calculation = page
    .getByRole("region", { name: "Score calculation", exact: true })
    .getByText(/^After accepting all � /);
  await expect(breakdown).toHaveAttribute("aria-expanded", "false");
  await expect(calculation).toBeHidden();
  await breakdown.click();
  await expect(breakdown).toHaveAttribute("aria-expanded", "true");
  await expect(calculation).toBeVisible();
  await expect(calculation).toContainText(/after accepting all/i);
  await breakdown.click();
  await expect(breakdown).toHaveAttribute("aria-expanded", "false");
  await expect(calculation).toBeHidden();
});

test("shows the retry interval when scan requests are throttled", async ({
  page,
}) => {
  test.skip(!domain, "Requires a stored partial scan on the local server");
  await page.route("**/api/v1/domains/" + domain, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 429,
      headers: { "Retry-After": "120" },
      json: { code: "domain_cooldown" },
    });
  });
  await page.goto("/report/" + domain);
  await page
    .getByRole("button", { name: /reject all|reject optional/i })
    .click();
  await page
    .getByRole("button", {
      name: /run browser scan|request a (new )?scan|retry scan/i,
    })
    .click();
  await expect(
    page.getByText("Try again in about 2 minutes.", { exact: true }),
  ).toBeVisible();
});

test("publishes a partial scan without a score and exposes its evidence", async ({
  page,
}) => {
  test.skip(!domain, "Requires a stored partial scan on the local server");
  const response = await page.request.get(`/api/v1/domains/${domain}`);
  await expect(response).toBeOK();
  expect(await response.json()).toMatchObject({
    domain,
    state: "partially_completed",
    report: { demo: false, partial: true, score: null, grade: "Unrated" },
  });

  await page.goto(`/report/${domain}`);
  await page
    .getByRole("button", { name: /reject all|reject optional/i })
    .click();
  await expect(page.getByRole("heading", { name: domain })).toBeVisible();
  await expectPublishedGuestSummary(page);
  await expect(
    page.getByRole("meter", { name: "DataDeal privacy score" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "How this score was calculated" }),
  ).toHaveCount(0);
  if (process.env.DATADEAL_SCREENSHOTS === "true") {
    const originalViewport = page.viewportSize();
    const stamp = Date.now();
    for (const [width, height] of [
      [1920, 1080],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({
        path: `test-results/published-${domain}-${stamp}-${width}.png`,
      });
    }
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  if (!browserEvidence && domain === "thedannicraft.de") {
    await expect(
      page.getByText("Browser scan pending", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Privacy rating" }),
    ).toHaveCount(0);
    const citation = page.getByRole("link", {
      name: "View excerpt for Contact form",
    });
    const target = await citation.getAttribute("href");
    await citation.click();
    await viewEvidenceInReport(page);
    await expect(page.locator(target!)).toContainText("self-hosted Chatwoot");
    return;
  }
  await expect(
    page.getByRole("region", { name: "Privacy rating" }).getByRole("heading", {
      name: "Unrated",
    }),
  ).toBeVisible();
  await expect(page.getByText("Starting score", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Sources", exact: true }),
  ).toBeVisible();
  if (!advancedEmail || !outbox) return;
  await signInForAdvancedReport(page);
  await expect(
    page.locator("#history").getByText("Unrated", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .locator("#history")
      .getByText(/Methodology \d+\.\d+\.\d+/)
      .first(),
  ).toBeVisible();
  if (process.env.DATADEAL_TEST_POLICY_SUMMARY === "true") {
    const summary = page.getByRole("region", {
      name: /^(AI analysis|Scan summary)$/,
    });
    await expect(summary.locator("q")).toBeVisible();
    const citation = summary.getByRole("link", { name: "View policy excerpt" });
    const target = await citation.getAttribute("href");
    expect(target).toMatch(/^#evidence-document-\d+-section-\d+$/);
    await citation.click();
    await viewEvidenceInReport(page);
    await expect(page.locator(target!)).toBeInViewport();
  }
  if (browserEvidence) {
    const source = page
      .getByRole("link", {
        name: /this visit attempted \d+ HTTP requests/i,
      })
      .and(page.locator('a[href="#evidence-browser-consent-default"]'));
    await source.click();
    await viewEvidenceInReport(page);
    await expect(
      page.locator("#evidence-browser-consent-default"),
    ).toBeInViewport();
  } else {
    await expect(
      page.getByText(
        "This report has no browser measurements for consent choices.",
      ),
    ).toBeVisible();
  }
  if (compareChoices) {
    if (process.env.DATADEAL_TEST_BROWSER_REJECT_FINDING === "true") {
      const finding = page.getByRole("button", {
        name: /browser interaction with a reject control observed/i,
      });
      await finding.click();
      await page
        .getByRole("link", { name: "Source browser-consent-rejected" })
        .click();
      await viewEvidenceInReport(page);
      await expect(
        page.locator("#evidence-browser-consent-rejected"),
      ).toBeInViewport();
    }
    for (const [choice, label, count] of [
      ["rejected", "Optional consent rejected", choiceCounts[0]],
      ["accepted", "Optional consent accepted", choiceCounts[1]],
    ] as const) {
      const evidenceId = `#evidence-browser-consent-${choice}`;
      const row = page
        .locator(".consent-grid > div")
        .filter({ hasText: label });
      await expect(row).toContainText(
        `Requests from the click to the end of observation: ${count}.`,
      );
      await row.locator(`a[href="${evidenceId}"]`).click();
      await viewEvidenceInReport(page);
      const evidence = page.locator(evidenceId);
      await expect(evidence).toBeInViewport();
      await evidence.locator("summary").click();
      await expect(
        evidence.getByText(
          `Requests from the consent click to the end of observation: ${count}.`,
          { exact: false },
        ),
      ).toBeVisible();
    }
  }
  if (browserDestination) {
    const flow = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "Where your data flows",
        exact: true,
      }),
    });
    const node = flow.getByRole("button", {
      name: browserDestination,
      exact: true,
    });
    await node.click();
    await expect(node).toHaveAttribute("aria-pressed", "true");
    await expect(
      flow.getByText(/the browser attempted a request/i).first(),
    ).toBeVisible();
    await flow
      .getByRole("link", { name: "Source browser-consent-default" })
      .click();
    await viewEvidenceInReport(page);
    await expect(
      page.locator("#evidence-browser-consent-default"),
    ).toBeInViewport();
  }
  if (expectedDestinations) {
    await expect(
      page.getByRole("region", { name: /^(AI analysis|Scan summary)$/ }),
    ).toContainText(
      `During the default visit, the browser attempted requests to ${expectedDestinations} external`,
    );
  }
  if (respondingDestination) {
    const node = page.getByRole("button", {
      name: respondingDestination,
      exact: true,
    });
    await node.click();
    await expect(
      page
        .locator('[aria-live="polite"]')
        .filter({ hasText: /the browser observed an HTTP response/i }),
    ).toBeVisible();
    const evidence = page.locator("#evidence-browser-consent-default");
    await expect(
      evidence.getByText(`${respondingDestination} · HTTP response observed`, {
        exact: true,
      }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "Evidence", exact: true }),
  ).toBeVisible();
  const evidence = page.locator('li[id^="evidence-"]').first();
  await expect(
    evidence.getByText(/^Retrieved \d{4}-\d{2}-\d{2} UTC$/),
  ).toBeVisible();

  if (resourceHost) {
    const inventory = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "Detected services and infrastructure",
        exact: true,
      }),
    });
    await expect(
      inventory.getByText(resourceHost, { exact: true }),
    ).toBeVisible();
    await inventory.getByRole("link", { name: "View source evidence" }).click();
    await viewEvidenceInReport(page);
    await expect(
      page.locator("#evidence-homepage-external-resources"),
    ).toBeInViewport();
  }

  if (dnsAlias) {
    await expect(page.getByText(dnsAlias, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "View DNS evidence" }).click();
    await viewEvidenceInReport(page);
    await expect(page.locator("#evidence-homepage-dns-cname")).toBeInViewport();
  }

  if (policyUrl) {
    await expect(
      page.getByRole("region", { name: /^(AI analysis|Scan summary)$/ }),
    ).toContainText("The scan retrieved a privacy policy.");
    const finding = page.getByRole("button", {
      name: /privacy documentation available/i,
    });
    await finding.click();
    const citation = page.getByRole("link", { name: "Source document-1" });
    await citation.click();
    await viewEvidenceInReport(page);
    const source = page.locator("#evidence-document-1");
    await expect(source).toBeInViewport();
    await expect(source.locator("a")).toHaveAttribute("href", policyUrl);
    const sectionHeading = process.env.DATADEAL_TEST_POLICY_SECTION;
    if (sectionHeading) {
      const topic = page.getByRole("link", {
        name: sectionHeading,
        exact: true,
      });
      const target = await topic.getAttribute("href");
      expect(target).toMatch(/^#evidence-document-\d+-section-\d+$/);
      await topic.click();
      await viewEvidenceInReport(page);
      await expect(page.locator(target!)).toBeInViewport();
      const section = page.locator(target!);
      await expect(
        section.getByText(/^Retrieved \d{4}-\d{2}-\d{2} UTC$/),
      ).toBeVisible();
    }
  }
});
