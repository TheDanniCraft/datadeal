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
  // Without a consent management platform, local sample ads load directly.
  await page.goto(report, { waitUntil: "domcontentloaded" });
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

// A minimal IAB TCF API, as Google's consent message would expose it.
async function stubTcf(page: Page, purposeOne: boolean) {
  await page.addInitScript((granted) => {
    Reflect.set(
      window,
      "__tcfapi",
      (
        command: string,
        _version: number,
        callback: (data: object, success: boolean) => void,
      ) => {
        if (command !== "addEventListener") return;
        callback(
          {
            eventStatus: "tcloaded",
            gdprApplies: true,
            listenerId: 1,
            purpose: { consents: { 1: granted } },
          },
          true,
        );
      },
    );
  }, purposeOne);
}

for (const granted of [false, true])
  test(`follows the TCF purpose 1 choice for rewarded sample ads: ${granted ? "granted" : "refused"}`, async ({
    page,
  }) => {
    let requests = 0;
    await page.route(publisher, (route) => {
      requests++;
      return route.abort("blockedbyclient");
    });
    await stubTcf(page, granted);
    await page.goto(report);
    const offer = page.getByRole("button", { name: "Watch an ad to unlock" });
    if (granted) await expect(offer).toBeVisible();
    else {
      // Without the AdSense tag, the settings control links to the privacy page.
      await expect(
        page.getByRole("link", { name: "Review advertising consent" }),
      ).toHaveAttribute("href", "/privacy#reports");
      await expect(offer).toHaveCount(0);
      expect(requests).toBe(0);
    }
  });

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
