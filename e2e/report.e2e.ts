import { viewEvidenceInReport } from "./report-citation";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  const reject = page.getByRole("button", {
    name: /reject all|reject optional/i,
  });
  await reject.click();
  await expect(reject).toBeHidden();
});

test("keeps pricing public and redirects guests who open account billing", async ({
  page,
}) => {
  test.skip(
    Boolean(
      process.env.DATADEAL_TEST_URL || process.env.DATADEAL_AUTH_TEST_MAIL_FILE,
    ),
    "Requires the isolated browser server without account services",
  );
  await page.goto("/pricing");
  await expect(
    page.getByRole("heading", { name: "One-domain unlock" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /When a rewarded ad is available, watch it to open one advanced report/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Pro checkout is currently unavailable."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "See subscription options" }),
  ).toHaveCount(0);
  await page.goto("/account/billing");
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(
    "/account/billing",
  );
  await expect(
    page.getByRole("heading", { name: "Sign in to view your membership" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /monthly|yearly/i }),
  ).toHaveCount(0);
});

for (const [width, height] of [
  [390, 844],
  [768, 1024],
  [1920, 1080],
]) {
  test(
    "finds a labeled report by keyboard at " + width + " pixels",
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      await page.goto("/");
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Skip to content" }),
      ).toBeFocused();
      await page
        .getByRole("textbox", { name: "Website domain" })
        .fill("google.com");
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: "google.com" }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/demo data|fictional evidence/i)).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("region", { name: "Privacy rating unavailable" }),
      ).toBeVisible();
      if (process.env.DATADEAL_SCREENSHOTS === "true") {
        await page.screenshot({
          path: "test-results/report-" + width + ".png",
        });
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    },
  );
}

test("shows explicit unavailable and partial outcomes", async ({ page }) => {
  await page.goto("/report/example.net");
  await expect(
    page.getByRole("heading", { name: "No report available" }),
  ).toBeVisible();
  await page.goto("/report/thedannicraft.de");
  await expect(
    page.getByRole("region", { name: "Privacy rating unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("meter")).toHaveCount(0);
});

test("reveals finding provenance on demand", async ({ page }) => {
  await page.goto("/report/example.org");
  const finding = page
    .getByRole("region", { name: "When you use this site" })
    .getByRole("link", {
      name: "Before you choose cookies — Default visit evidence",
    });
  await expect(finding).toHaveAttribute("aria-haspopup", "dialog");
  await finding.focus();
  await page.keyboard.press("Enter");
  await viewEvidenceInReport(page);
  await expect(
    page.locator("#evidence-example-visit-default"),
  ).toBeInViewport();
});

test("follows evidence-backed graph hops, stops a cycle, and restores the previous selection", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.DATADEAL_TEST_URL),
    "Requires the isolated fixture server",
  );
  const scanId = "00100000-0000-4000-8000-000000000007";
  const neighbors: Record<
    string,
    { label: string; observedEvidenceId: string }
  > = {
    "example.net": {
      label: "provider.example.com",
      observedEvidenceId: "first-hop",
    },
    "provider.example.com": {
      label: "example.org",
      observedEvidenceId: "second-hop",
    },
    "example.org": { label: "example.net", observedEvidenceId: "root-hop" },
  };
  await page.route("**/api/v1/domains/*/connections", (route) => {
    const domain = new URL(route.request().url()).pathname.split("/").at(-2)!;
    return route.fulfill({
      json: {
        domain,
        scanId,
        destinations: [neighbors[domain]],
        references:
          domain === "example.net"
            ? [
                {
                  domain: "other.example.com",
                  scanId,
                  evidenceId: "incoming-hop",
                },
              ]
            : [],
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/report/example.org");
  const flow = page
    .getByRole("heading", { name: "Where your data flows" })
    .locator("..");
  await flow.getByRole("button", { name: "example.net", exact: true }).click();
  const network = flow.getByRole("group", {
    name: "Website connection network",
  });
  await expect(
    flow.getByRole("list", { name: "Connection evidence" }),
  ).toContainText("Browser observation");
  await expect(
    network.getByRole("button", { name: "example.net" }),
  ).toHaveAccessibleDescription("Browser observation");
  const viewport = network.locator(".flow-viewport");
  await network.scrollIntoViewIfNeeded();
  const bounds = (await network.boundingBox())!;
  await page.mouse.move(bounds.x + 15, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 40, bounds.y + bounds.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(viewport).toHaveCSS("translate", "25px");
  const expand = flow.getByRole("button", { name: "Expand provider scan" });
  await expand.click();
  await expect(
    flow
      .getByRole("region", { name: "Other scans with this provider" })
      .getByRole("link", { name: "other.example.com" }),
  ).toHaveAttribute(
    "href",
    `/report/other.example.com?scan=${scanId}#evidence-incoming-hop`,
  );
  await expect(
    flow.getByRole("link", { name: "View browser evidence" }),
  ).toHaveAttribute(
    "href",
    `/report/example.net?scan=${scanId}#evidence-first-hop`,
  );
  await expand.click();
  await expect(flow.locator("[aria-label='Connection path']")).toContainText(
    "example.org → example.net → provider.example.com",
  );
  await expand.click();
  await expect(flow.getByRole("status")).toContainText(
    "already in the connection path",
  );
  await flow.getByRole("button", { name: "Back to example.net" }).click();
  await expect(
    flow.getByRole("link", { name: "View browser evidence" }),
  ).toHaveAttribute(
    "href",
    `/report/example.net?scan=${scanId}#evidence-first-hop`,
  );
  await flow.getByRole("button", { name: "Back to example.org" }).click();
  await expect(viewport).toHaveCSS("translate", "25px");
  await expect(
    flow.getByRole("button", { name: "example.net", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("attributes the preferred policy quote and links to its evidence", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.DATADEAL_TEST_URL),
    "Requires the isolated fixture server",
  );
  await page.goto("/report/example.org");
  const headline = page.getByRole("region", {
    name: "Privacy rating",
    exact: true,
  });
  await expect(headline).toContainText("Unrated");
  await expect(headline.getByRole("meter")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: /^(AI analysis|Scan summary)$/ }),
  ).toHaveCount(0);
  for (const [source, label, quote] of [
    [
      "example-collection",
      "Information we collect",
      "We collect your email address when you create an account.",
    ],
    [
      "example-sharing",
      "How we share information",
      "We share your address with our delivery provider.",
    ],
  ] as const) {
    const citation = page.getByRole("link", { name: label, exact: true });
    await expect(citation).toHaveAttribute("href", "#evidence-" + source);
    await citation.press("Enter");
    await expect(page.getByRole("dialog").locator("mark")).toHaveText(quote);
    await viewEvidenceInReport(page);
    await expect(page.locator("#evidence-" + source)).toBeInViewport();
  }
  const flow = page
    .getByRole("heading", { name: "Where your data flows" })
    .locator("..");
  await flow.getByRole("button", { name: "example.net" }).click();
  const visits = flow.getByRole("list", {
    name: "Visits where this destination appeared",
  });
  await expect(
    visits.getByRole("link", { name: "Default visit" }).locator(".."),
  ).toContainText("HTTP response observed");
  const rejected = visits.getByRole("link", { name: "Reject visit" });
  await expect(rejected.locator("..")).toContainText(
    "Request observed after the choice",
  );
  await rejected.click();
  await viewEvidenceInReport(page);
  await expect(
    page.locator("#evidence-example-visit-rejected"),
  ).toBeInViewport();
  const inventoryTrigger = page.getByRole("button", {
    name: "External domains observed in browser visits (1)",
  });
  await inventoryTrigger.click();
  await expect(inventoryTrigger).toHaveAttribute("aria-expanded", "true");
  const inventory = page.locator(
    `[id="${await inventoryTrigger.getAttribute("aria-controls")}"]`,
  );
  await expect(
    inventory.getByText("example.net", { exact: true }),
  ).toBeVisible();
  await expect(
    inventory.getByRole("link", { name: "Reject visit" }).locator(".."),
  ).toContainText("Request attempted");
  await expect(
    inventory.getByRole("link", { name: "Reject visit" }),
  ).toHaveAttribute("href", "#evidence-example-visit-rejected");
});

test("links a measured consent scenario to its evidence", async ({ page }) => {
  test.skip(Boolean(process.env.DATADEAL_TEST_URL), "Requires test evidence");
  await page.goto("/report/example.org");
  const comparison = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Consent comparison", exact: true }),
  });
  const source = comparison
    .getByRole("link", {
      name: "Default visit evidence",
    })
    .and(page.locator('a[href="#evidence-example-visit-default"]'));
  const target = await source.getAttribute("href");
  expect(target).toMatch(/^#evidence-/);
  await source.click();
  await viewEvidenceInReport(page);
  await expect(page.locator(target!)).toBeInViewport();
  await expect(
    comparison.getByText(
      "This scan has no confirmed result for this scenario.",
      {
        exact: true,
      },
    ),
  ).toHaveCount(0);
  const coverage = page.getByRole("button", { name: "Scan coverage" });
  await coverage.click();
  await expect(
    page.getByText("This scan has no confirmed result for this scenario.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("keeps a default-only fixture unrated and its visitor summary free of score arithmetic", async ({
  page,
}) => {
  await page.goto("/report/google.com");
  await expect(page.getByRole("meter")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Privacy rating unavailable" }),
  ).toBeVisible();
  const api = await page.request.get("/api/v1/domains/google.com");
  const { report } = await api.json();
  expect(report).toMatchObject({ demo: true, score: null, grade: "Unrated" });
  expect(report.headlineScenario).toBeUndefined();
  expect(report.visitorSummary).toEqual([]);
});
test("mobile header opens navigation and searches from the report", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/report/google.com");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.click();
  await expect(
    page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Developers" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Search websites" }).click();
  const search = page.getByRole("textbox", { name: "Website domain" });
  await expect(search).toBeFocused();
  await search.fill("bild.de");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "bild.de" })).toBeVisible();
  await expect(search).toHaveCount(0);
});

test("desktop header searches directly from the report", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/report/google.com");
  await expect(
    page.getByRole("button", { name: "Menu", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Search websites" }).click();
  const search = page.getByRole("textbox", { name: "Website domain" });
  await expect(search).toBeFocused();
  await search.fill("bild.de");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "bild.de" })).toBeVisible();
});

test("compares sites without a qualifying accept-all rating on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/report/example.org");
  await page
    .getByRole("button", { name: "Compare example.org with another website" })
    .click();
  await page.getByLabel("Website to compare").fill("thedannicraft.de");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Compare", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "example.org" })).toContainText(
    "Unrated",
  );
  await expect(
    page.getByRole("region", { name: "thedannicraft.de" }),
  ).toContainText("Unrated");
  await expect(
    page.getByRole("region", { name: "thedannicraft.de" }),
  ).toContainText("Partial scan");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  const invalid = await page.request.get(
    "/api/v1/compare?left=example.org&right=EXAMPLE.ORG",
  );
  expect(invalid.status()).toBe(400);
});

test("distinguishes an unrated report from an unscanned site in comparisons", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/compare?left=google.com&right=unscanned-audit.example.com");
  const rated = page.getByRole("region", { name: "google.com" });
  await expect(
    rated.getByRole("heading", { name: "google.com" }),
  ).toBeVisible();
  await expect(rated).toContainText("Unrated");
  const missing = page.getByRole("region", {
    name: "unscanned-audit.example.com",
  });
  await expect(missing).toContainText("No published report yet.");
  await missing.getByRole("link", { name: /Open scan request/ }).click();
  await expect(
    page.getByRole("heading", { name: "No report available" }),
  ).toBeVisible();
});

test("applies the saved Mouve theme in both system color modes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/report/google.com");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "mouve-light");
  const light = await html.evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--background"),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "mouve-dark");
  const dark = await html.evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--background"),
  );
  expect(light).toContain("95.5%");
  expect(dark).toContain("16%");
  if (process.env.DATADEAL_SCREENSHOTS === "true") {
    await page.screenshot({ path: "test-results/report-mouve-dark.png" });
  }
});
