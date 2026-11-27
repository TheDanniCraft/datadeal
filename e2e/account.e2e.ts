import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  checkoutBinding,
  creditPackBinding,
  signature,
} from "../apps/web/lib/billing";

const outbox = process.env.DATADEAL_AUTH_TEST_MAIL_FILE;
const watchDomain = process.env.DATADEAL_WATCH_TEST_DOMAIN;
const billingSecret = process.env.DATADEAL_BILLING_TEST_SECRET;
const graphRoot = process.env.DATADEAL_GRAPH_TEST_ROOT;
const graphProvider = process.env.DATADEAL_GRAPH_TEST_PROVIDER;
const historyDomain = process.env.DATADEAL_TEST_HISTORY_GAP_DOMAIN;
test.skip(!outbox, "Requires DataDeal's loopback development outbox");

test("canonicalizes local account documents while keeping API origin checks", async ({
  page,
  baseURL,
}) => {
  const target = new URL("/account?returnTo=/account/developer", baseURL);
  test.skip(!["localhost", "127.0.0.1"].includes(target.hostname));
  const alias = new URL(target.href);
  alias.hostname = target.hostname === "localhost" ? "127.0.0.1" : "localhost";
  await page.goto(alias.href);
  await expect(page).toHaveURL(target.href);
  const health = await page.request.get(alias.origin + "/api/ready", {
    headers: { Accept: "text/html" },
    maxRedirects: 0,
  });
  expect(health.status()).toBe(200);
  const rejected = await page.request.post(
    target.origin + "/api/auth/sign-in/magic-link",
    {
      data: { email: "alias@example.test" },
      headers: { Origin: alias.origin },
    },
  );
  expect(rejected.status()).toBe(403);
});

test("creates, rotates, and revokes an account API token without resurfacing secrets", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/account/developer");
  const reject = page.getByRole("button", {
    name: /reject all|reject optional/i,
  });
  await reject.click();
  await expect(reject).toBeHidden();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page
    .getByLabel("Email address")
    .fill(`developer-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Your sign-in link is in the local outbox."),
  ).toBeVisible();
  await page.goto((await readFile(outbox!, "utf8")).trim());
  await expect(page).toHaveURL(/\/account\/developer$/);
  await expect(page.getByRole("heading", { name: "Points" })).toBeVisible();
  await expect(page.getByText("No API point activity yet")).toBeVisible();
  await page.getByLabel("Token name").fill("Report reader");
  await page.getByRole("button", { name: "Create token" }).click();
  const reveal = page.getByRole("textbox", { name: "New API token" });
  await expect(reveal).toBeVisible();
  const original = await reveal.inputValue();
  expect(/^dd_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(original)).toBe(true);
  await page.reload();
  await expect(reveal).toHaveCount(0);
  await page.getByRole("button", { name: "Rotate Report reader" }).click();
  await expect(reveal).toBeVisible();
  const replacement = await reveal.inputValue();
  expect(
    replacement !== original &&
      replacement.split(".")[0] === original.split(".")[0],
  ).toBe(true);
  await page.getByRole("button", { name: "Revoke Report reader" }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  const metadata = await page.request.get("/api/v1/account/api-tokens");
  await expect(metadata).toBeOK();
  expect(metadata.headers()["cache-control"]).toContain("no-store");
  const body = await metadata.text();
  expect(
    !body.includes(original) &&
      !body.includes(replacement) &&
      !body.includes('"hash"'),
  ).toBe(true);
  // Scan tokens need points on (DATADEAL_POINTS or local sample ads).
  if (process.env.DATADEAL_POINTS === "true") {
    await page.getByLabel("Token name").fill("Scan requester");
    await page.getByRole("button", { name: "Create scan token" }).click();
    await expect(reveal).toBeVisible();
    const scanToken = await reveal.inputValue();
    await expect(
      page.getByText("scans:request", { exact: false }),
    ).toBeVisible();
    const scan = await page.request.post(
      "/api/v1/developer/scans/example.com",
      {
        headers: {
          Authorization: "Bearer " + scanToken,
          "Idempotency-Key": "e2e-empty-balance",
        },
      },
    );
    expect(scan.status()).toBe(402);
    const report = await page.request.get(
      "/api/v1/developer/reports/example.com",
      {
        headers: { Authorization: "Bearer " + scanToken },
      },
    );
    expect(report.status()).toBe(403);
  }
});

test("keeps unrated scans distinct from earlier ratings in Pro history", async ({
  page,
}) => {
  test.skip(!historyDomain, "Requires saved rated and unrated snapshots");
  test.setTimeout(60_000);
  await page.goto("/account");
  await page
    .getByRole("button", { name: /reject all|reject optional/i })
    .click();
  await page.getByLabel("Email address").fill("watch-smoke@example.test");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Your sign-in link is in the local outbox."),
  ).toBeVisible();
  await page.goto((await readFile(outbox!, "utf8")).trim());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/report/" + historyDomain);
  await expect(
    page.getByRole("meter", { name: "DataDeal privacy score" }),
  ).toHaveAttribute("aria-valuenow", "85");
  const history = page.locator("#history");
  const chart = history.getByRole("group", { name: "Privacy score over time" });
  await expect(
    chart.getByText(/Gaps mark scans without a comparable score/i),
  ).toBeVisible();
  await expect(chart.locator(".recharts-line-dot")).toHaveCount(2);
  await expect(history.getByText("85/100 · Good", { exact: true })).toHaveCount(
    2,
  );
  await page.getByRole("link", { name: "View newer scan" }).click();
  await expect(
    page.getByRole("heading", { name: "Unrated", exact: true }),
  ).toBeVisible();
  await history.getByRole("link", { name: "View latest scan" }).click();
  await expect(
    page.getByRole("meter", { name: "DataDeal privacy score" }),
  ).toHaveAttribute("aria-valuenow", "85");
});

test("expands a published provider and opens its cited scan evidence", async ({
  page,
}) => {
  test.skip(
    !graphRoot || !graphProvider,
    "Requires two connected published reports",
  );
  test.setTimeout(60_000);
  await page.goto("/account");
  await page
    .getByRole("button", { name: /reject all|reject optional/i })
    .click();
  await page.getByLabel("Email address").fill("watch-smoke@example.test");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Your sign-in link is in the local outbox."),
  ).toBeVisible();
  await page.goto((await readFile(outbox!, "utf8")).trim());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/report/" + graphRoot);
  const flow = page
    .getByRole("heading", { name: "Where your data flows" })
    .locator("..");
  const provider = flow.getByRole("button", {
    name: graphProvider,
    exact: true,
  });
  await expect(
    flow.getByRole("group", { name: "Website connection network" }),
  ).toBeVisible();
  for (let group = 0; group < 6 && !(await provider.isVisible()); group++) {
    await flow.getByRole("button", { name: /^\+\d+ connections$/ }).click();
  }
  await provider.click();
  await flow.getByRole("button", { name: "Expand provider scan" }).click();
  await expect(
    flow.getByText(graphProvider!, { exact: true }).first(),
  ).toBeVisible();
  if (graphProvider === "google.com") {
    await flow
      .getByRole("button", { name: "gstatic.com", exact: true })
      .click();
    await expect(
      flow.getByText(/same documented service ecosystem/i),
    ).toBeVisible();
    await expect(
      flow.getByRole("link", { name: "About Google service infrastructure" }),
    ).toBeVisible();
  }
  const evidence = flow.getByRole("link", { name: "View browser evidence" });
  const href = (await evidence.getAttribute("href"))!;
  expect(href).toContain(`/report/${graphProvider}?scan=`);
  await evidence.click();
  await expect(page.locator(href.slice(href.indexOf("#")))).toBeInViewport({
    timeout: 15_000,
  });
});

test("preserves a pending credit pack across sign-in and stops checking automatically", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const target = "/account/developer?order_id=ord_" + randomUUID();
  await page.goto(target);
  await page
    .getByRole("button", { name: /reject all|reject optional/i })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your point purchase" }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(target);
  await page
    .getByLabel("Email address")
    .fill("points-" + randomUUID() + "@example.test");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Your sign-in link is in the local outbox."),
  ).toBeVisible();
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/billing/return-status")
      requests++;
  });
  await page.goto((await readFile(outbox!, "utf8")).trim());
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
    target,
  );
  await expect(
    page.getByText("Waiting for checkout confirmation"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /buy .*points/i })).toHaveCount(
    0,
  );
  const retry = page.getByRole("button", { name: "Check again" });
  await expect(retry).toBeVisible({ timeout: 50_000 });
  expect(requests).toBe(5);
  await retry.click();
  await expect.poll(() => requests).toBe(6);
  await expect(page.getByText("Points added")).toHaveCount(0);
});

test("restores the exact credit pack across browsers and a delayed payment", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.DATADEAL_CREDIT_CHECKOUT_TEST !== "true" || !billingSecret,
    "Requires a disposable Customer Credits store",
  );
  const email = "buyer-" + randomUUID() + "@example.test";
  async function signIn(tab: typeof page) {
    await tab
      .getByRole("button", { name: /reject all|reject optional/i })
      .click();
    await tab.getByLabel("Email address").fill(email);
    await tab.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(
      tab.getByText("Your sign-in link is in the local outbox."),
    ).toBeVisible();
    await tab.goto((await readFile(outbox!, "utf8")).trim());
  }
  await page.goto("/account?returnTo=/account/developer");
  await signIn(page);
  const profile = (
    await (await page.request.get("/api/auth/get-session")).json()
  ).user;
  const product = "prod_credit_browser";
  await page.route("https://test-checkout.creem.io/**", (route) =>
    route.fulfill({ contentType: "text/plain", body: "Isolated test store" }),
  );
  await page.getByRole("button", { name: "Buy points", exact: true }).click();
  await page
    .getByRole("button", { name: /^Buy [\d,]+ points for /, exact: false })
    .click();
  await page.waitForURL("https://test-checkout.creem.io/**");
  const target = new URL(new URL(page.url()).searchParams.get("return")!);
  expect(target.origin).toBe(baseURL);
  expect(target.pathname).toMatch(
    /^\/account\/developer\/return\/[a-f0-9-]{36}$/,
  );
  const requestId = target.pathname.split("/").at(-1)!;
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  try {
    const tab = await context.newPage();
    await tab.goto(target.href);
    await expect(
      tab.getByRole("heading", { name: "Check your point purchase" }),
    ).toBeVisible();
    expect(new URL(tab.url()).searchParams.get("returnTo")).toBe(
      target.pathname,
    );
    await signIn(tab);
    await expect(tab).toHaveURL(target.href);
    await expect(
      tab.getByText("Waiting for checkout confirmation"),
    ).toBeVisible();
    await expect(
      tab.getByRole("button", { name: /buy .*points/i }),
    ).toHaveCount(0);
    const id = randomUUID();
    const event = JSON.stringify({
      id,
      eventType: "checkout.completed",
      created_at: Date.now(),
      object: {
        object: "checkout",
        status: "completed",
        mode: "sandbox",
        request_id: requestId,
        product: {
          id: product,
          billing_type: "onetime",
          currency: "EUR",
          price: 499,
        },
        customer: { id: "cust_" + id, email },
        order: {
          id: "ord_" + id,
          product,
          status: "paid",
          currency: "EUR",
          amount: 499,
          amount_paid: 499,
        },
        metadata: {
          datadeal_user: profile.id,
          datadeal_pack_credits: "25",
          datadeal_price_cents: "499",
          datadeal_binding: creditPackBinding(
            billingSecret!,
            profile.id,
            product,
            requestId,
            25,
            499,
          ),
        },
      },
    });
    const deliver = (sig: string) =>
      tab.request.post("/api/v1/billing/creem", {
        data: event,
        headers: { "creem-signature": sig },
      });
    expect((await deliver("invalid")).status()).toBe(401);
    await expect(await deliver(signature(billingSecret!, event))).toBeOK();
    await expect(await deliver(signature(billingSecret!, event))).toBeOK();
    await expect(tab.getByText("Points added")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      tab.getByText("2,500 points added to your balance."),
    ).toBeVisible();
    await expect(
      tab.getByRole("button", { name: /buy .*points/i }),
    ).toHaveCount(0);
    await testInfo.attach("credit-receipt-mobile", {
      body: await tab.screenshot(),
      contentType: "image/png",
    });
    const other = await tab.request.get(
      "/api/v1/billing/return-status?request_id=" + randomUUID(),
    );
    expect(await other.json()).toEqual({ status: "pending" });
    await tab.getByRole("link", { name: "View points" }).click();
    await expect(tab.getByText("Available balance")).toBeVisible();
    await expect(tab.getByText("2,500", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("grants and expires Pro through signed billing webhooks", async ({
  page,
}) => {
  test.skip(!billingSecret, "Requires isolated billing test settings");
  const connectionsEndpoint = "/api/v1/domains/example.com/connections";
  const guestConnections = await page.request.get(connectionsEndpoint);
  expect(guestConnections.status()).toBe(401);
  expect(guestConnections.headers()["cache-control"]).toContain("no-store");
  const subscriptionId = "sub_" + randomUUID();
  const returnPath = "/account/billing?subscription_id=" + subscriptionId;
  await page.goto("/account/billing");
  await expect(
    page.getByRole("heading", { name: "Sign in to view your membership" }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(
    "/account/billing",
  );
  await expect(
    page.getByRole("button", { name: /monthly|yearly/i }),
  ).toHaveCount(0);
  await page.goto(
    "/account/billing/return?subscription_id=" +
      subscriptionId +
      "&email=should-not-propagate",
  );
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(returnPath);
  await page.goto("/account/billing/return?checkout_id=ch_no_subscription_id");
  await page
    .getByRole("button", { name: /reject all|reject optional/i })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your Pro subscription" }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(
    "/account/billing/return?checkout_id=ch_no_subscription_id",
  );
  await expect(
    page.getByRole("button", { name: /monthly|yearly/i }),
  ).toHaveCount(0);
  await page
    .getByLabel("Email address")
    .fill(`billing-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Your sign-in link is in the local outbox."),
  ).toBeVisible();
  await page.goto((await readFile(outbox!, "utf8")).trim());
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
    "/account/billing/return?checkout_id=ch_no_subscription_id",
  );
  await expect(
    page.getByText("Waiting for checkout confirmation"),
  ).toBeVisible();
  const exported = await page.request.get("/api/v1/account/export");
  await expect(exported).toBeOK();
  const { profile } = await exported.json();
  let proPurchase: URL | undefined;
  if (process.env.DATADEAL_CREDIT_CHECKOUT_TEST === "true") {
    await page.goto("/account/billing");
    await expect(
      page.getByRole("heading", { name: "Your membership" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /monthly|yearly/i }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "View Pro plans" }).click();
    await page.route("https://test-checkout.creem.io/**", (route) =>
      route.fulfill({ contentType: "text/plain", body: "Isolated test store" }),
    );
    await page.getByRole("button", { name: /monthly/i }).click();
    await page.waitForURL("https://test-checkout.creem.io/**");
    proPurchase = new URL(new URL(page.url()).searchParams.get("return")!);
    expect(proPurchase.pathname).toMatch(
      /^\/account\/billing\/return\/[a-f0-9-]{36}$/,
    );
    await page.goto(proPurchase.href);
    await expect(
      page.getByText("Waiting for checkout confirmation"),
    ).toBeVisible();
  }
  expect((await page.request.get(connectionsEndpoint)).status()).toBe(403);
  const reportExport = await page.request.get(
    `/api/v1/domains/example.com/export?scan=${randomUUID()}`,
  );
  expect(reportExport.status()).toBe(403);
  const preferenceEndpoint = "/api/v1/account/privacy-profile";
  const deniedProfile = await page.request.put(preferenceEndpoint, {
    data: JSON.stringify("data_minimization"),
    headers: {
      Origin: new URL(page.url()).origin,
      "Content-Type": "application/json",
    },
  });
  expect(deniedProfile.status()).toBe(403);
  expect((await page.request.get(preferenceEndpoint)).status()).toBe(403);
  expect(reportExport.headers()["cache-control"]).toContain("no-store");
  const product = "datadeal-test-monthly";
  const event = {
    id: randomUUID(),
    eventType: "subscription.paid",
    created_at: Date.now(),
    object: {
      id: subscriptionId,
      product,
      customer: randomUUID(),
      mode: "test",
      current_period_end_date: new Date(Date.now() + 86_400_000).toISOString(),
      metadata: {
        datadeal_user: profile.id,
        datadeal_binding: checkoutBinding(billingSecret!, profile.id, product),
      },
    },
  };
  const post = async (body: string, webhookSignature: string) =>
    page.request.post("/api/v1/billing/creem", {
      data: body,
      headers: { "creem-signature": webhookSignature },
    });
  const paid = JSON.stringify(event);
  await page.goto("/account/billing/return");
  await expect(
    page.getByText("Waiting for checkout confirmation"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /monthly|yearly/i }),
  ).toHaveCount(0);
  expect((await post(paid, "invalid")).status()).toBe(401);
  expect((await post(paid, signature(billingSecret!, paid))).status()).toBe(
    200,
  );
  await expect(page.getByText(/Pro is active through/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("button", { name: /monthly|yearly/i }),
  ).toHaveCount(0);
  await page.goto(returnPath);
  await expect(page.getByText("Pro subscription confirmed")).toBeVisible({
    timeout: 20_000,
  });
  if (proPurchase) {
    await page.goto(proPurchase.href);
    await expect(
      page.getByText("Waiting for checkout confirmation"),
    ).toBeVisible();
    const requestId = proPurchase.pathname.split("/").at(-1)!;
    const orderId = "ord_" + randomUUID();
    const completion = JSON.stringify({
      id: randomUUID(),
      eventType: "checkout.completed",
      created_at: Date.now(),
      object: {
        object: "checkout",
        status: "completed",
        mode: "sandbox",
        id: "ch_" + requestId,
        request_id: requestId,
        product,
        customer: event.object.customer,
        subscription: subscriptionId,
        order: orderId,
        metadata: { ...event.object.metadata, datadeal_pro_request: requestId },
      },
    });
    expect(
      (await post(completion, signature(billingSecret!, completion))).status(),
    ).toBe(200);
    await expect(page.getByText("Pro subscription confirmed")).toBeVisible({
      timeout: 20_000,
    });
    for (const path of [
      "?order_id=" + orderId,
      "?checkout_id=ch_" + requestId,
    ]) {
      await page.goto("/account/billing" + path);
      await expect(page.getByText("Pro subscription confirmed")).toBeVisible();
      await expect(
        page.getByRole("button", { name: /monthly|yearly/i }),
      ).toHaveCount(0);
    }
    const download = await page.request.get("/api/v1/account/export");
    expect(download.headers()["cache-control"]).toContain("private, no-store");
    expect(download.headers()["content-disposition"]).toContain(
      "datadeal-account.json",
    );
    const accountData = await download.json();
    expect(accountData.proBilling.checkouts).toEqual([
      {
        requestId,
        checkoutId: "ch_" + requestId,
        orderId,
        subscriptionId,
        productId: product,
        mode: "test",
      },
    ]);
    expect(accountData.proBilling.subscriptions).toMatchObject([
      {
        subscriptionId,
        status: "active",
        productId: product,
        accessUntil: event.object.current_period_end_date,
      },
    ]);
    expect(accountData.reportUnlocks).toEqual([]);
  }
  await page.goto("/account/billing/return?subscription_id=sub_unrelated");
  await expect(
    page.getByText("Waiting for checkout confirmation"),
  ).toBeVisible();
  await expect(page.getByText("Pro subscription confirmed")).toHaveCount(0);
  await page.goto("/account/billing");
  const active = page.getByText(/Pro is active/);
  await expect(active).toBeVisible();
  expect((await page.request.get(connectionsEndpoint)).status()).toBe(404);
  const transitions: [string, RegExp, string?][] = [
    [
      "subscription.past_due",
      /Payment is past due. Pro access continues until/,
    ],
    ["subscription.paused", /Your Pro subscription is paused/, "paused"],
    ["subscription.expired", /waiting for renewal confirmation/, "active"],
    ["subscription.paid", /Pro is active through/, "active"],
    ["subscription.canceled", /Your subscription will not renew/],
    ["subscription.expired", /Your previous Pro subscription expired/],
  ];
  for (const [
    index,
    [eventType, message, providerStatus],
  ] of transitions.entries()) {
    const body = JSON.stringify({
      ...event,
      id: randomUUID(),
      eventType,
      object: { ...event.object, status: providerStatus },
      created_at: event.created_at + index + 1,
    });
    expect((await post(body, signature(billingSecret!, body))).status()).toBe(
      200,
    );
    await page.reload();
    await expect(page.getByText(message)).toBeVisible();
    if (
      eventType === "subscription.paused" ||
      (eventType === "subscription.expired" && providerStatus === "active")
    ) {
      await expect(
        page.getByRole("button", { name: "Manage subscription" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /monthly|yearly/i }),
      ).toHaveCount(0);
      const duplicate = await page.request.post("/api/v1/billing/checkout", {
        headers: { Origin: new URL(page.url()).origin },
        data: { plan: "monthly" },
      });
      expect(duplicate.status()).toBe(409);
      expect((await page.request.get(connectionsEndpoint)).status()).toBe(403);
    }
  }
  expect((await post(paid, signature(billingSecret!, paid))).status()).toBe(
    200,
  );
  await page.reload();
  await expect(active).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /monthly|yearly/i }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "View Pro plans" }).click();
  await expect(page.getByRole("button", { name: /monthly/i })).toBeVisible();
});

test("signs in once using a magic link and revokes the session on sign-out", async ({
  page,
  browser,
}) => {
  const email = "auth-" + randomUUID() + "@example.test";
  await page.goto("/account?returnTo=https%3A%2F%2Funrelated.example");
  await page.getByLabel("Email address").fill(email.toUpperCase());
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Your sign-in link is in the local outbox.",
  );
  const link = (await readFile(outbox!, "utf8")).trim();
  expect(new URL(link).origin).toBe(new URL(page.url()).origin);
  await page.goto(link);
  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByText("Signed in as " + email, { exact: true }),
  ).toBeVisible();

  const other = await browser.newPage();
  try {
    await other.goto(link);
    await expect(
      other.getByRole("button", { name: "Send sign-in link" }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Send sign-in link" }),
  ).toBeVisible();
});

test("opens a scheduled document change from the Library", async ({ page }) => {
  test.skip(!watchDomain, "Requires a scheduled alert in the test database");
  test.setTimeout(60_000);
  await page.goto("/account/library");
  await page
    .getByRole("button", { name: /reject all|reject optional/i })
    .click();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email address").fill("watch-smoke@example.test");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Your sign-in link is in the local outbox."),
  ).toBeVisible();
  await page.goto((await readFile(outbox!, "utf8")).trim());
  await page.goto("/account/library");
  await expect(page.getByText(/1 changed document/)).toBeVisible();
  await page.goto("/account");
  const privacyProfile = page.getByRole("region", { name: "Privacy profile" });
  await privacyProfile
    .getByRole("button", { name: /registration advice/i })
    .click();
  await page
    .getByRole("option", { name: "Share as little as possible" })
    .click();
  await privacyProfile
    .getByRole("button", { name: "Save privacy profile" })
    .click();
  await expect(privacyProfile.getByRole("status")).toHaveText(
    "Privacy profile saved.",
  );
  const account = await page.request.get("/api/v1/account/export");
  const synced = await page.request.get("/api/v1/account/privacy-profile");
  await expect(synced).toBeOK();
  expect(synced.headers()["cache-control"]).toContain("no-store");
  expect(await synced.json()).toBe("data_minimization");
  expect(await account.json()).toMatchObject({
    privacyProfile: "data_minimization",
  });
  await page.goto("/account/library");
  await page
    .getByRole("link", { name: "View" })
    .and(page.locator(`[href^="/report/${watchDomain}?scan="]`))
    .first()
    .click();
  await expect(page).toHaveURL(/\/report\/[^?]+\?scan=[a-f0-9-]+#history$/);
  await expect(
    page.getByText(/for your privacy profile, skip optional fields/i),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Document changes since the previous report",
    }),
  ).toBeVisible();
  if (process.env.DATADEAL_AD_TEST_DOMAIN === watchDomain) {
    let publisherRequests = 0;
    await page.route(
      "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
      (route) => {
        publisherRequests++;
        return route.abort();
      },
    );
    // Pro is ad-free: no ad placement and no Google consent controls.
    await page.reload();
    await expect(
      page.locator("footer").getByRole("button", { name: "Privacy settings" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("complementary", { name: "Advertisement" }),
    ).toHaveCount(0);
    expect(publisherRequests).toBe(0);
  }
  const reportExport = page.getByRole("link", {
    name: "Download report as JSON",
  });
  const exportUrl = await reportExport.getAttribute("href");
  expect(exportUrl).toMatch(/\/export\?scan=/);
  const download = await page.request.get(exportUrl!);
  await expect(download).toBeOK();
  expect(download.headers()["content-disposition"]).toContain("attachment");
  expect(await download.json()).toMatchObject({
    report: { domain: watchDomain, demo: false },
    score: { grade: "Unrated", score: null },
  });
  const guest = await page.context().browser()!.newContext();
  try {
    expect(
      (await guest.request.get(new URL(exportUrl!, page.url()).href)).status(),
    ).toBe(401);
  } finally {
    await guest.close();
  }
  await page.goto("/account/library");
  await expect(page.getByRole("heading", { name: "Changes" })).toBeVisible();
  await expect(page.getByText(watchDomain).first()).toBeVisible();
});

test("exports only the current account and deletes it after explicit email confirmation", async ({
  page,
}) => {
  const email = "delete-" + randomUUID() + "@example.test";
  const exportPath = "/api/v1/account/export";
  expect((await page.request.get(exportPath)).status()).toBe(401);
  await page.goto("/account");
  await page
    .getByRole("button", { name: /reject all|reject optional/i })
    .click();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Your sign-in link is in the local outbox."),
  ).toBeVisible();
  await page.goto((await readFile(outbox!, "utf8")).trim());
  await expect(page.getByText("Signed in as " + email)).toBeVisible();

  const exported = await page.request.get(exportPath);
  expect(exported.headers()["content-disposition"]).toContain("attachment");
  expect(exported.headers()["cache-control"]).toContain("no-store");
  const data = await exported.json();
  expect(data.profile.email).toBe(email);
  expect(data.sessions).toHaveLength(1);
  expect(data.sessions[0]).not.toHaveProperty("token");
  expect(data.apiCredits).toEqual({ balance: "0", entries: [] });

  await page.getByRole("button", { name: "Request account deletion" }).click();
  await expect(
    page.getByText(
      /Open the local outbox file .+ for your deletion confirmation link/,
    ),
  ).toBeVisible();
  const confirmation = (await readFile(outbox!, "utf8")).trim();
  await page.goto(confirmation);
  expect((await page.request.get(exportPath)).status()).toBe(200);
  await page
    .getByRole("button", { name: "Permanently delete my account" })
    .click();
  await expect(
    page.getByRole("button", { name: "Send sign-in link" }),
  ).toBeVisible();
  expect((await page.request.get(exportPath)).status()).toBe(401);
});

test("keeps the account on cancellation failure and stops late subscription payments after confirmed deletion", async ({
  page,
}) => {
  test.skip(
    !billingSecret || process.env.DATADEAL_ACCOUNT_CLOSURE_TEST !== "true",
    "Requires the isolated Creem cancellation fixture",
  );
  const email = "closure-" + randomUUID() + "@example.test";
  await page.goto("/account");
  await page
    .getByRole("button", { name: /reject all|reject optional/i })
    .click();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByText("Your sign-in link is in the local outbox."),
  ).toBeVisible();
  const openMail = async () =>
    page.goto((await readFile(outbox!, "utf8")).trim());
  await openMail();
  const profile = (
    await (await page.request.get("/api/v1/account/export")).json()
  ).profile;
  const paid = () =>
    JSON.stringify({
      id: randomUUID(),
      eventType: "subscription.paid",
      created_at: Date.now(),
      object: {
        id: "sub_closure_" + randomUUID(),
        mode: "test",
        customer: "cust_closure",
        product: "datadeal-test-monthly",
        current_period_end_date: new Date(Date.now() + 86400000).toISOString(),
        metadata: {
          datadeal_user: profile.id,
          datadeal_binding: checkoutBinding(
            billingSecret!,
            profile.id,
            "datadeal-test-monthly",
          ),
        },
      },
    });
  const deliver = (body: string) =>
    page.request.post("/api/v1/billing/creem", {
      data: body,
      headers: { "creem-signature": signature(billingSecret!, body) },
    });
  expect((await deliver(paid())).status()).toBe(200);
  const confirm = async () => {
    await page.goto("/account");
    await page
      .getByRole("button", { name: "Request account deletion" })
      .click();
    await expect(
      page.getByText(
        /Open the local outbox file .+ for your deletion confirmation link/,
      ),
    ).toBeVisible();
    await openMail();
    await page
      .getByRole("button", { name: "Permanently delete my account" })
      .click();
  };
  await confirm();
  await expect(
    page.getByRole("status").filter({ hasText: "Your account is still open." }),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/account/export")).status()).toBe(200);
  await confirm();
  await expect(
    page.getByRole("button", { name: "Send sign-in link" }),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/account/export")).status()).toBe(401);
  const late = paid();
  expect((await deliver(late)).status()).toBe(503);
  expect((await deliver(late)).status()).toBe(200);
  expect((await deliver(late)).status()).toBe(200);
});
