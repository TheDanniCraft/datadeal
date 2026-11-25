import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const ratedHost = process.env.DATADEAL_TEST_PUBLISHED_RATED_DOMAIN;
const rewardHost = process.env.DATADEAL_REWARDED_AD_TEST_DOMAIN;
const headlineLabels = {
  default: "Before a choice",
  accepted: "After accepting all",
  rejected: "After rejecting optional consent",
} as const;

test("a free reader can inspect the headline calculation without receiving the other scenario", async ({
  page,
}) => {
  test.skip(!ratedHost, "Requires a stored rated report");
  const response = await page.request.get("/api/v1/domains/" + ratedHost);
  expect(response.ok()).toBe(true);
  const { report } = await response.json();
  expect(report.beforeChoiceRating).toBeUndefined();
  expect(report.acceptAllRating).toBeUndefined();
  expect(report.consentDifference).toBeUndefined();
  const label =
    headlineLabels[report.headlineScenario as keyof typeof headlineLabels];
  expect(label).toBe(headlineLabels.accepted);
  await page.goto("/report/" + ratedHost + "?scan=" + report.scanId);
  const reject = page.getByRole("button", { name: "Reject All", exact: true });
  await reject.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  if (await reject.isVisible()) await reject.click();
  const headline = page.getByRole("region", {
    name: "Privacy rating",
    exact: true,
  });
  await expect(headline).toContainText(label);
  await expect(headline.getByRole("meter")).toHaveAttribute(
    "aria-valuenow",
    String(report.score),
  );
  const summary = page.getByRole("region", {
    name: /^(AI analysis|Scan summary)$/,
  });
  const citations = summary.locator("a.summary-citation");
  await expect(citations.first()).toBeVisible();
  for (const citation of await citations.all()) {
    await expect(citation.locator("sup")).toHaveCount(1);
    await citation.click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.locator("mark"),
      (await citation.getAttribute("href")) ?? "citation",
    ).toBeVisible();
    if (await citation.getAttribute("data-citation-group")) {
      const sources = dialog
        .getByRole("group", { name: "Evidence for this statement" })
        .getByRole("button");
      expect(await sources.count()).toBeGreaterThan(1);
      await sources.nth(1).click();
      await expect(sources.nth(1)).toHaveAttribute("aria-pressed", "true");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
  await expect(
    page.getByRole("region", { name: "Ratings by consent choice" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("grid", {
      name: "Observed consent scenarios and end-of-visit measurements",
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "After the consent choice" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /^(Before a choice|After accepting all) calculation$/,
    }),
  ).toHaveCount(0);
  const toggle = page.getByRole("button", {
    name: "How this score was calculated",
    exact: true,
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("region", { name: "Score calculation", exact: true }),
  ).toContainText(label + " · ");
});

test("a persisted single-report unlock opens the measured scenarios, their evidence and available calculations", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(
    !rewardHost,
    "Requires local rewards and a stored report with measured consent visits",
  );
  const origin = new URL(baseURL!).origin;
  const { report } = await (
    await page.request.get("/api/v1/domains/" + rewardHost)
  ).json();
  const path = "/report/" + rewardHost + "?scan=" + report.scanId;
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const comparison = page.getByRole("region", {
    name: "Ratings by consent choice",
    exact: true,
  });
  await expect(comparison).toHaveCount(0);
  const grant = await context.request.post("/api/v1/rewards/local-sample", {
    headers: { Origin: origin },
    data: {
      host: rewardHost,
      scanId: report.scanId,
      completionId: randomUUID(),
    },
  });
  expect(grant.status()).toBe(204);
  await page.reload({ waitUntil: "domcontentloaded" });
  const reject = page.getByRole("button", { name: "Reject All", exact: true });
  await reject.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  if (await reject.isVisible()) await reject.click();
  await expect(comparison).toBeVisible();
  const options = [];
  const measuredScenarios = [];
  for (const scenario of ["accepted", "default", "rejected"] as const) {
    const title = comparison.getByRole("heading", {
      name: headlineLabels[scenario],
      exact: true,
    });
    if (!(await title.count())) continue;
    const row = title.locator("..");
    await expect(
      row.getByRole("link", {
        name: headlineLabels[scenario] + " visit evidence",
      }),
    ).toBeVisible();
    measuredScenarios.push(scenario);
    const match = (await row.innerText()).match(/(\d+)\/100/);
    if (match) options.push({ scenario, score: Number(match[1]) });
    else await expect(row).toContainText("Unrated");
  }
  expect(measuredScenarios).toEqual(
    expect.arrayContaining(["accepted", "default"]),
  );
  const expected = "accepted";
  expect(report.score).toBe(
    options.find((row) => row.scenario === expected)?.score,
  );
  expect(report.headlineScenario).toBe(expected);
  await expect(
    page.getByRole("region", { name: "Privacy rating", exact: true }),
  ).toContainText(headlineLabels[expected]);
  for (const { scenario } of options) {
    const label = headlineLabels[scenario];
    const button =
      scenario === expected
        ? "How this score was calculated"
        : label + " calculation";
    const region = scenario === expected ? "Score calculation" : button;
    const toggle = comparison.getByRole("button", {
      name: button,
      exact: true,
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      comparison.getByRole("region", { name: region, exact: true }),
    ).toContainText(label + " · ");
  }
  const accepted = comparison
    .getByRole("heading", { name: headlineLabels.accepted, exact: true })
    .locator("..");
  const citation = accepted.getByRole("link", {
    name: "After accepting all visit evidence",
  });
  await expect(citation).toHaveAttribute(
    "href",
    "#evidence-browser-consent-accepted",
  );
  await citation.click();
  await expect(page.getByRole("dialog")).toContainText(/consent|accept/i);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("grid", {
      name: "Observed consent scenarios and end-of-visit measurements",
    }),
  ).toBeVisible();
});
