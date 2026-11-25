import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const handoff = process.env.DATADEAL_REWARD_HANDOFF_TEST === "true";
const domain = process.env.DATADEAL_SELF_ASSESSMENT_DOMAIN;
const scanId = process.env.DATADEAL_REWARD_TEST_PREVIOUS_SCAN;
const outbox = process.env.DATADEAL_AUTH_TEST_MAIL_FILE;
test.skip(!handoff, "Run the disposable guest reward handoff harness.");

async function requestLink(page: Page, email: string, origin: string) {
  await page.goto("/account");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Your sign-in link is in the local outbox."),
  ).toBeVisible();
  const verification = new URL((await readFile(outbox!, "utf8")).trim());
  expect(verification.origin).toBe(origin);
  return verification.href;
}

async function expectAccount(
  context: BrowserContext,
  email: string,
  ownsScan: boolean,
) {
  const response = await context.request.get("/api/v1/account/export");
  await expect(response).toBeOK();
  const data = await response.json();
  expect(data.profile.email).toBe(email);
  expect(data.reportUnlocks).toEqual(ownsScan ? [{ domain, scanId }] : []);
  expect(data.proBilling).toEqual({ subscriptions: [], checkouts: [] });
  expect(data.apiCredits).toEqual({ balance: "0", entries: [] });
  expect(data.creemCredits).toMatchObject({
    state: "unlinked",
    balance: "0",
    entries: [],
  });
}

test("the verified magic link carries a guest's exact rewarded scan to its owner on another browser", async ({
  page: guest,
  context: guestBrowser,
  browser,
  baseURL,
}) => {
  test.setTimeout(150_000);
  if (
    !baseURL ||
    !domain ||
    !scanId ||
    !outbox ||
    !process.env.DATADEAL_TEST_DATABASE_URL
  )
    throw Error(
      "Configure the disposable database, two eligible snapshots and a local test outbox.",
    );
  const origin = new URL(baseURL).origin;
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(origin).hostname,
  );
  const ownerBrowser = await browser.newContext({ baseURL });
  const otherBrowser = await browser.newContext({ baseURL });
  const graph = (page: Page) =>
    page.getByRole("heading", { name: "Where your data flows", exact: true });
  const report = "/report/" + domain;
  const exact = report + "?scan=" + scanId;
  try {
    // This tests the account handoff after completion. Use the local rewarded
    // provider endpoint and keep all browser traffic on loopback.
    for (const ctx of [guestBrowser, ownerBrowser, otherBrowser])
      await ctx.route(/^https?:\/\//, (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
    const latest = await guest.request.get("/api/v1/domains/" + domain);
    await expect(latest).toBeOK();
    expect((await latest.json()).report.scanId).not.toBe(scanId);
    await guest.goto(exact);
    await expect(graph(guest)).toHaveCount(0);
    const grant = await guest.request.post("/api/v1/rewards/local-sample", {
      headers: { Origin: origin },
      data: { host: domain, scanId, completionId: randomUUID() },
    });
    expect(grant.status()).toBe(204);
    const cookie = (await guestBrowser.cookies()).find(
      (c) => c.name === "dd-test-reward-" + scanId,
    );
    expect(cookie?.httpOnly).toBe(true);
    const seconds = cookie!.expires - Date.now() / 1000;
    expect(seconds).toBeGreaterThan(86_300);
    expect(seconds).toBeLessThanOrEqual(86_401);
    await guest.goto(report);
    await expect(graph(guest)).toHaveCount(0);
    const originalReport = guest.getByRole("link", {
      name: "Open the earlier report you unlocked",
    });
    await expect(originalReport).toHaveAttribute("href", exact);
    await originalReport.click();
    await expect(graph(guest)).toBeVisible();
    const ownerEmail = "reward-owner-" + randomUUID() + "@example.test";
    const verify = await requestLink(guest, ownerEmail, origin);
    const owner = await ownerBrowser.newPage();
    expect(await ownerBrowser.cookies()).toEqual([]);
    await owner.goto(verify);
    await expectAccount(ownerBrowser, ownerEmail, true);
    expect(
      (await ownerBrowser.cookies()).some((c) =>
        c.name.startsWith("dd-test-reward-"),
      ),
    ).toBe(false);
    await owner.goto(report);
    await expect(graph(owner)).toHaveCount(0);
    const saved = owner.getByRole("link", {
      name: "Open the earlier report you unlocked",
    });
    await expect(saved).toHaveAttribute("href", exact);
    await saved.click();
    await expect(graph(owner)).toBeVisible();

    const other = await otherBrowser.newPage();
    const otherEmail = "reward-other-" + randomUUID() + "@example.test";
    await other.goto(await requestLink(other, otherEmail, origin));
    await expectAccount(otherBrowser, otherEmail, false);
    await other.goto(exact);
    await expect(graph(other)).toHaveCount(0);
    await expect(
      other.getByRole("heading", { name: "Advanced report", exact: true }),
    ).toBeVisible();
    // The anonymous grant remains usable on its original version after the account handoff.
    await guest.goto(report);
    await expect(graph(guest)).toHaveCount(0);
    await guest.goto(exact);
    await expect(graph(guest)).toBeVisible();
  } finally {
    await Promise.all([ownerBrowser.close(), otherBrowser.close()]);
  }
});
