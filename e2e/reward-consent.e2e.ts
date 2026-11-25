import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const domain = process.env.DATADEAL_REWARDED_AD_TEST_DOMAIN;
test.skip(
  !domain,
  "Requires a local domain with a locked advanced report and sample ads",
);
const report = "/report/" + domain;
const publisher = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";

type VideoOutcome =
  | "empty"
  | "no_request"
  | "no_response"
  | "not_ready"
  | "unsupported"
  | "playable";

// One publisher service dispatches events to both the banner and the video.
// Keep slot identity and every listener so the tests catch cross-slot mixups.
async function mockPublisher(page: Page, outcome: VideoOutcome) {
  let loads = 0;
  await page.route(publisher, (route) => {
    loads++;
    return route.fulfill({
      contentType: "application/javascript",
      body: `
        const outcome = ${JSON.stringify(outcome)};
        const queue = window.googletag.cmd;
        const displaySlot = { addService() {} };
        const listeners = new Map();
        const service = {
          addEventListener(name, fn) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(fn);
          },
          removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }
        };
        function emit(name, event) {
          for (const fn of listeners.get(name) ?? []) fn(event);
        }
        Object.assign(window.googletag, {
          apiReady: true, cmd: { push: fn => fn() },
          enums: { OutOfPageFormat: { REWARDED: 1 } },
          defineSlot: () => displaySlot,
          defineOutOfPageSlot: () => outcome === "unsupported" ? null : { addService() {} },
          pubads: () => service, enableServices() {}, destroySlots() {},
          display(slot) {
            if (slot === displaySlot) {
              emit("slotRenderEnded", {slot, isEmpty:false});
              document.body.dataset.bannerRendered = "true";
              return;
            }
            document.body.dataset.videoDisplayCalled = "true";
            // Concurrent events on the banner must never advance the video state.
            emit("slotRequested", {slot:displaySlot});
            emit("slotResponseReceived", {slot:displaySlot});
            emit("slotRenderEnded", {slot:displaySlot,isEmpty:false});
            if (outcome === "no_request") return;
            emit("slotRequested", {slot});
            if (outcome === "no_response") return;
            emit("slotResponseReceived", {slot});
            emit("slotRenderEnded", {slot,isEmpty:outcome === "empty"});
            if (outcome !== "playable") return;
            emit("rewardedSlotReady", {slot, makeRewardedVisible() {
              window.addEventListener("test-ad-ended", ({detail}) => {
                if (detail === "completed") emit("rewardedSlotGranted", {slot});
                emit("rewardedSlotClosed", {slot});
              }, {once:true});
              return true;
            }});
          }
        });
        queue.forEach(fn => fn());`,
    });
  });
  return () => loads;
}

const videoFailures = {
  empty: "Google returned an empty ad slot.",
  no_request: "did not confirm sending a video request",
  no_response: "did not confirm a response in time",
  not_ready: "video did not become ready to play",
  unsupported: "Rewarded ads are unavailable in this browser.",
} as const;

test("shows a labeled sample graph and keeps the fictional report separate from access options", async ({
  page,
}) => {
  await page.goto(report);
  const reject = page.getByRole("button", { name: "Reject All", exact: true });
  await page.addLocatorHandler(reject, () => reject.click());
  const preview = page.getByRole("region", { name: "Advanced report preview" });
  await expect(
    preview.getByText("Example data flow", { exact: true }),
  ).toBeVisible();
  const explore = preview.getByRole("button", {
    name: /Explore the example/,
  });
  await expect(explore).toContainText("Fictional data");
  await expect(explore).toHaveAttribute("aria-expanded", "false");
  await explore.click();
  const sample = preview.locator(".report-preview-backdrop");
  await expect(sample).toBeVisible();
  await expect(sample.locator("h4")).toHaveText([
    "Consent comparison",
    "Providers and evidence",
    "Scan history",
    "Example policy change",
  ]);
  await expect(sample).toContainText("We keep booking details for one year.");
  await expect(sample).toContainText("We keep booking details for 30 days.");
  await expect(sample.locator(".preview-timeline svg").first()).toBeVisible();
  await expect(sample).toContainText("First-party host");
  await expect(sample).toContainText("Policy excerpt");
  await expect(sample).not.toContainText(domain!);
  await expect(
    preview.getByRole("link", { name: "View Pro plans" }),
  ).toHaveAttribute("href", "/pricing");
  await explore.click();
  await expect(sample).toBeHidden();
});

test("distinguishes a publisher script that never initialized from an empty video response", async ({
  page,
}) => {
  let loaderRequests = 0;
  await page.route(publisher, (route) => {
    loaderRequests++;
    return route.fulfill({ contentType: "text/javascript", body: "" });
  });
  await page.goto(report, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Accept All", exact: true }).click();
  await expect.poll(() => loaderRequests).toBe(1);
  await page.clock.install();
  const offer = page.getByRole("button", { name: "Watch an ad to unlock" });
  await offer.click();
  await expect(
    page.getByRole("button", { name: "Loading video…" }),
  ).toBeVisible();
  // The reward queued its own callback on the existing, uninitialized tag.
  await page.waitForFunction(() => {
    const tag = Reflect.get(window, "googletag");
    return Array.isArray(tag?.cmd) && tag.cmd.length >= 2;
  });
  await page.clock.fastForward(21_000);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "A video request could not be confirmed." }),
  ).toBeVisible();
  expect(loaderRequests).toBe(1);
});

for (const outcome of Object.keys(
  videoFailures,
) as (keyof typeof videoFailures)[]) {
  test(
    "explains the observed Google video state: " + outcome,
    async ({ page }) => {
      const loaderRequests = await mockPublisher(page, outcome);
      await page.goto(report, { waitUntil: "domcontentloaded" });
      await page
        .getByRole("button", { name: "Accept All", exact: true })
        .click();
      const body = page.locator("body");
      await expect(body).toHaveAttribute("data-banner-rendered", "true");
      expect(loaderRequests()).toBe(1);
      await page.clock.install();
      const offer = page.getByRole("button", { name: "Watch an ad to unlock" });
      await offer.click();
      if (outcome !== "unsupported") {
        await expect(body).toHaveAttribute("data-video-display-called", "true");
        await page.clock.fastForward(21000);
      }
      await expect(
        page.getByRole("status").filter({ hasText: videoFailures[outcome] }),
      ).toBeVisible();
      await expect(offer).toHaveCount(0);
      expect(loaderRequests()).toBe(1);
    },
  );
}

test("updates the reward option for fresh and saved advertising preferences", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  let requests = 0;
  await page.route(publisher, (route) => {
    requests++;
    return route.abort("blockedbyclient");
  });
  await page.goto(report);
  await expect(
    page.getByRole("button", { name: "Review advertising consent" }),
  ).toBeVisible();
  await expect(page.locator("a[data-branding]")).toHaveCount(0);
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Accept All", exact: true }).click();
  const offer = page.getByRole("button", { name: "Watch an ad to unlock" });
  await expect(offer).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(offer).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("link", { name: "API docs", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/developers$/, { timeout: 15_000 });
  await page.goBack();
  await expect(offer).toBeVisible();
  await page
    .getByRole("button", { name: "Privacy settings", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("a[data-branding]")).toHaveCount(0);
  // c15t reloads the document after persisting a revoked category.
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    dialog.getByRole("button", { name: "Reject All", exact: true }).click(),
  ]);
  await expect(
    page.getByRole("button", { name: "Review advertising consent" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(offer).toHaveCount(0);
  const state = await page.context().storageState();
  const returning = await browser.newContext({ baseURL, storageState: state });
  returning.setDefaultTimeout(10_000);
  try {
    const saved = await returning.newPage();
    let savedRequests = 0;
    await saved.route(publisher, (route) => {
      savedRequests++;
      return route.abort("blockedbyclient");
    });
    await saved.goto(report, { waitUntil: "domcontentloaded" });
    await expect(
      saved.getByRole("button", { name: "Accept All", exact: true }),
    ).toHaveCount(0);
    await saved
      .getByRole("button", { name: "Review advertising consent" })
      .click();
    expect(savedRequests).toBe(0);
    await saved
      .getByRole("dialog")
      .getByRole("button", { name: "Accept All", exact: true })
      .click();
    const savedOffer = saved.getByRole("button", {
      name: "Watch an ad to unlock",
    });
    await savedOffer.click();
    await expect(
      saved.getByText("The Google test ad script could not load."),
    ).toBeVisible();
    await expect(savedOffer).toHaveCount(0);
    await expect(
      saved.getByRole("heading", {
        name: "Where your data flows",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await returning.close();
  }
});

for (const allowLimited of [false, true]) {
  test(`remembers a GPC visitor's ${allowLimited ? "grant" : "refusal"} of limited Google ads`, async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await page.setExtraHTTPHeaders({ "Sec-GPC": "1" });
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "globalPrivacyControl", { value: true }),
    );
    let standardRequests = 0;
    let limitedRequests = 0;
    await page.route(publisher, (route) => {
      standardRequests++;
      return route.abort("blockedbyclient");
    });
    await page.route(
      "https://pagead2.googlesyndication.com/tag/js/gpt.js",
      (route) => {
        limitedRequests++;
        return route.abort("blockedbyclient");
      },
    );
    await page.goto(report, { waitUntil: "domcontentloaded" });
    const funding = page.getByRole("dialog", {
      name: "Help fund the next scan",
    });
    await page.addLocatorHandler(funding, () =>
      funding.getByRole("button", { name: "Close", exact: true }).click(),
    );
    const banner = page.getByText("Optional privacy settings", { exact: true });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    expect(standardRequests + limitedRequests).toBe(0);
    await page.getByRole("button", { name: "Customize", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Privacy Settings",
      exact: true,
    });
    const limited = dialog.getByRole("switch", {
      name: "Limited Google ads",
      exact: true,
    });
    await expect(limited).not.toBeChecked();
    await expect(
      dialog.getByRole("switch", { name: "Marketing", exact: true }),
    ).toHaveCount(0);
    if (allowLimited)
      await dialog
        .getByRole("button", { name: "Accept All", exact: true })
        .click();
    else {
      await dialog
        .getByRole("switch", { name: "Analytics", exact: true })
        .check();
      await dialog
        .getByRole("button", { name: "Save Settings", exact: true })
        .click();
    }
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () =>
        (await context.cookies()).some((cookie) => cookie.name === "c15t"),
      )
      .toBe(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "Privacy settings", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("switch", { name: "Analytics", exact: true }),
    ).toBeChecked();
    await expect(limited).toBeChecked({ checked: allowLimited });
    await expect(
      dialog.getByRole("switch", { name: "Marketing", exact: true }),
    ).toHaveCount(0);
    await expect(banner).toHaveCount(0);
    expect(standardRequests).toBe(0);
    if (!allowLimited) expect(limitedRequests).toBe(0);
    await page.goto("/advertising-disclosure", {
      waitUntil: "domcontentloaded",
    });
    const status = page.locator("#browser-privacy [aria-live]");
    if (allowLimited) {
      await expect(status).toContainText("You’ve allowed limited Google ads");
      await page
        .getByRole("button", { name: "Privacy settings", exact: true })
        .click();
      await Promise.all([
        page.waitForEvent("domcontentloaded"),
        dialog.getByRole("button", { name: "Reject All", exact: true }).click(),
      ]);
    }
    await expect(status).toContainText("Personalized advertising is off");
    const previousLimitedRequests = limitedRequests;
    await page.goto(report, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Watch an ad to unlock" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Review limited ad settings", exact: true })
      .click();
    await expect(limited).not.toBeChecked();
    await expect(banner).toHaveCount(0);
    expect(limitedRequests).toBe(previousLimitedRequests);
    expect(standardRequests).toBe(0);
  });
}
test("a guest opts in once, can close without a grant, and can retry a completed unlock", async ({
  page,
  context,
}) => {
  const graph = page.getByRole("heading", {
    name: "Where your data flows",
    exact: true,
  });
  const offer = page.getByRole("button", { name: "Watch an ad to unlock" });
  const grantUrl = "**/api/v1/rewards/local-sample";
  const completions: string[] = [];
  // Drop the first server response after it commits. Retrying must recover the same grant.
  await page.route(grantUrl, async (route) => {
    const body = route.request().postDataJSON();
    completions.push(body.completionId);
    if (completions.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(204);
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await mockPublisher(page, "playable");
  await page.goto(report);
  await page.getByRole("button", { name: "Accept All", exact: true }).click();
  await expect(graph).toHaveCount(0);
  await offer.click();
  await expect(page.getByText("The Google sample ad is open.")).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("test-ad-ended")),
  );
  await expect(
    page.getByText(/closed before a reward was granted/),
  ).toBeVisible();
  expect(completions).toHaveLength(0);

  await offer.click();
  await expect(page.getByText("The Google sample ad is open.")).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("test-ad-ended", { detail: "completed" }),
    ),
  );
  const retry = page.getByRole("button", { name: "Retry unlock" });
  await expect(retry).toBeVisible();
  // route.fetch() shares storage with the browser. Model a response lost before Set-Cookie.
  await context.clearCookies({ name: /^dd-test-reward-/ });
  await retry.click();
  await expect(graph).toBeVisible({ timeout: 20_000 });
  await expect(offer).toHaveCount(0);
  await page.reload();
  await expect(graph).toBeVisible();
  expect(completions).toHaveLength(2);
  expect(completions[0]).toBe(completions[1]);
  const grants = (await context.cookies()).filter((cookie) =>
    cookie.name.startsWith("dd-test-reward-"),
  );
  expect(grants).toHaveLength(1);
  expect(grants[0].httpOnly).toBe(true);
  expect(grants[0].expires - Date.now() / 1000).toBeGreaterThan(86_300);
});

test("an older guest grant follows the current report only on its own domain", async ({
  context,
  page,
  baseURL,
}) => {
  const previousScan = process.env.DATADEAL_REWARD_TEST_PREVIOUS_SCAN;
  const otherDomain = process.env.DATADEAL_REWARD_TEST_OTHER_DOMAIN;
  test.skip(
    !previousScan || !otherDomain,
    "Requires an older eligible scan and a second eligible domain",
  );
  const graph = page.getByRole("heading", {
    name: "Where your data flows",
    exact: true,
  });
  const grant = (host: string, completionId: string) =>
    context.request.post("/api/v1/rewards/local-sample", {
      headers: { Origin: new URL(baseURL!).origin },
      data: { host, scanId: previousScan, completionId },
    });
  await page.goto(report);
  await expect(graph).toHaveCount(0);
  const completionId = randomUUID();
  expect((await grant(otherDomain!, completionId)).status()).toBe(404);
  const accepted = await Promise.all([
    grant(domain!, completionId),
    grant(domain!, completionId),
  ]);
  expect(accepted.map((response) => response.status())).toEqual([204, 204]);
  await page.reload();
  await expect(graph).toBeVisible();
  await page.goto("/report/" + otherDomain);
  await expect(graph).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "One-domain access" }),
  ).toBeVisible();
});
