import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

const domain = process.env.DATADEAL_REWARDED_AD_TEST_DOMAIN;
const outbox = process.env.DATADEAL_AUTH_TEST_MAIL_FILE;
test.skip(
  !domain || !outbox,
  "Requires an eligible local report and an isolated Better Auth outbox.",
);

test("redeems a guest choice ticket after sign-in and spends earned points exactly once", async ({
  page,
  context: ctx,
  baseURL,
}) => {
  test.setTimeout(120000);
  const base = baseURL!;
  const post = (path: string, data: Record<string, unknown>) =>
    ctx.request.post(base + path, { headers: { Origin: base }, data });
  const consent = () =>
    page.getByRole("button", { name: "Accept All", exact: true }).click();
  const hydrate = () =>
    page.waitForFunction(() => {
      const el = document.querySelector("main button");
      return !el || Object.keys(el).some((k) => k.startsWith("__reactProps"));
    });
  await ctx.route("https://securepubads.g.doubleclick.net/tag/js/gpt.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `
const tag = window.googletag;
const queued = tag.cmd;
const listeners = new Map();
const publisher = {
  addEventListener(name, fn) { listeners.set(name, fn); },
  removeEventListener(name) { listeners.delete(name); }
};
Object.assign(tag, {
  apiReady: true,
  cmd: { push: callback => callback() },
  enums: { OutOfPageFormat: { REWARDED: 1 } },
  defineSlot: () => ({ addService() {} }),
  defineOutOfPageSlot: () => ({ rewarded: true, addService() {} }),
  destroySlots() {},
  pubads: () => publisher,
  enableServices() {},
  display(slot) {
    if (!slot.rewarded) return;
    listeners.get("rewardedSlotReady")?.({
      slot,
      makeRewardedVisible() {
        setTimeout(() => {
          listeners.get("rewardedSlotGranted")?.({slot});
          listeners.get("rewardedSlotClosed")?.({slot});
        }, 30);
        return true;
      }
    });
  }
});
queued.forEach(callback => callback());
`,
    }),
  );
  await page.goto(base + "/report/" + domain, {
    waitUntil: "domcontentloaded",
  });
  await hydrate();
  await consent();
  await page.getByText("Choose your reward", { exact: true }).click();
  await page.getByText("Choose after the ad", { exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "Choose after the ad" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Watch an ad, then choose" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose how to use your reward" }),
  ).toBeVisible({ timeout: 45000 });
  const ticket = page.url().split("/").pop()!;
  await page
    .getByRole("link", { name: "Sign in or create an account for a flight" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in to DataDeal" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Open report for 24 hours" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Sign in or create an account for a flight" })
    .click();
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("plane-" + randomUUID() + "@example.test");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Your sign-in link is in the local outbox."),
  ).toBeVisible();
  const link = (await readFile(outbox!, "utf8")).trim();
  await page.goto(link, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp("/rewards/" + ticket));
  await hydrate();
  await page.getByRole("button", { name: "Choose one flight" }).click();
  await expect(
    page.getByRole("button", { name: "Launch plane" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= 390),
  ).toBe(true);
  await page
    .getByRole("textbox", { name: "Automatic target in points" })
    .fill("1");
  await page.getByRole("button", { name: "Launch plane" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "1 point saved to your wallet" }),
  ).toBeVisible();

  const plane = page
    .getByRole("region", { name: "Flight status" })
    .locator("[data-active]");
  await expect(plane).toHaveCSS("animation-name", "none");
  const claims = await post("/api/v1/rewards/offers", {
    id: ticket,
    action: "open",
  });
  expect(claims.status()).toBe(409);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "1 point saved to your wallet" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open points wallet" }).click();
  await expect(
    page.getByRole("heading", { name: "Report points", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Flight banked", { exact: false })).toBeVisible();
  await page.goto(base + "/report/" + domain, {
    waitUntil: "domcontentloaded",
  });
  await hydrate();
  await page.getByText("Choose your reward", { exact: true }).click();
  await page.getByText("Save 50 report points", { exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "Save 50 report points" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Watch an ad for 50 points" }).click();
  await expect(
    page.getByRole("heading", { name: "50 points added" }),
  ).toBeVisible();
  await page.goto(base + "/report/" + domain, {
    waitUntil: "domcontentloaded",
  });
  await hydrate();
  await page.getByRole("button", { name: "Use report points" }).click();
  await page.getByRole("button", { name: "Unlock for 50 points" }).click();
  await expect(
    page.getByRole("heading", { name: "Where your data flows", exact: true }),
  ).toBeVisible();
  await page.goto(base + "/account/rewards", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("Report unlocked", { exact: false }),
  ).toBeVisible();
});
