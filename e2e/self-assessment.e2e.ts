import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { checkoutBinding, signature } from "../apps/web/lib/billing";
import { observeConsentWithCoverage } from "../apps/worker/consent-observation";
import { isReportOrigin } from "../packages/contracts/content-page";

const domain = process.env.DATADEAL_SELF_ASSESSMENT_DOMAIN;
const secret = process.env.DATADEAL_BILLING_TEST_SECRET;
const outbox = process.env.DATADEAL_AUTH_TEST_MAIL_FILE;
const product = process.env.CREEM_MONTHLY_PRODUCT;
const adDomain =
  /(^|\.)(adtrafficquality\.google|doubleclick\.net|googlesyndication\.com|googleadservices\.com|googletagservices\.com)$/;

async function measurePlan(
  browser: Browser,
  report: URL,
  cookies: Awaited<ReturnType<BrowserContext["cookies"]>>,
) {
  const publisher: {
    requests: number;
    firstRequestAt?: string;
    statuses: number[];
  }[] = [];
  // Preserve the worker's fresh contexts and capture settings. Only Pro starts
  // with a session, acquired from the disposable account outside these visits.
  const seededBrowser = new Proxy(browser, {
    get(target, property) {
      if (property !== "newContext")
        return Reflect.get(target, property, target);
      return async (options: Parameters<Browser["newContext"]>[0]) => {
        const context = await target.newContext(options);
        if (cookies.length) await context.addCookies(cookies);
        const tag: (typeof publisher)[number] = { requests: 0, statuses: [] };
        publisher.push(tag);
        function isPublisherTag(value: string) {
          const url = new URL(value);
          return (
            adDomain.test(url.hostname) && url.pathname === "/tag/js/gpt.js"
          );
        }
        context.on("request", (request) => {
          if (isPublisherTag(request.url())) {
            tag.firstRequestAt ??= new Date().toISOString();
            tag.requests++;
          }
        });
        context.on("response", (response) => {
          if (isPublisherTag(response.url()))
            tag.statuses.push(response.status());
        });
        return context;
      };
    },
  });
  const result = await observeConsentWithCoverage(seededBrowser, report);
  expect(result.coverage).toEqual({
    default: "measured",
    rejected: "measured",
    accepted: "measured",
  });
  return result.observations.map((visit, index) => ({
    ...visit,
    publisherTag: publisher[index],
  }));
}

test("measures the local DataDeal report before choice, after rejection and after acceptance for free and Pro", async ({
  browser,
  page,
  baseURL,
}, testInfo) => {
  test.skip(
    !domain,
    "Opt-in self-assessment requires a disposable local account and a saved report",
  );
  test.setTimeout(150000);
  if (
    !baseURL ||
    !secret ||
    !outbox ||
    !product ||
    process.env.CREEM_MODE !== "test" ||
    process.env.DATADEAL_LOCAL_SAMPLE_ADS !== "true" ||
    !process.env.DATADEAL_TEST_DATABASE_URL
  )
    throw new Error(
      "Use a disposable local database, local test outbox, test billing and Google's sample ads",
    );
  const origin = new URL(baseURL);
  for (const url of [origin, new URL(process.env.DATADEAL_TEST_DATABASE_URL)]) {
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(url.hostname);
  }
  const response = await page.request.get("/api/v1/domains/" + domain);
  await expect(response).toBeOK();
  const { report: snapshot } = await response.json();
  expect(snapshot.demo).toBe(false);
  const path = "/report/" + domain + "?scan=" + snapshot.scanId;
  const report = new URL(path, origin);
  await page.goto(report.href);
  await expect(
    page.getByRole("region", { name: /^(AI analysis|Scan summary)$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept All", exact: true }),
  ).toBeVisible();
  const freeBeforeChoice = await page.evaluate(async () => {
    // Return names only for known consent storage. Cookie values, account
    // tokens and any unexpected or visitor-specific keys stay in the browser.
    const consentKeys = new Set(["c15t-sid", "c15t"]);
    const cookies = await window.cookieStore.getAll();
    return {
      visibleConsentCookies: cookies
        .map((c) => c.name)
        .filter((name) => consentKeys.has(name)),
      visibleCookieCount: cookies.length,
      localConsentKeys: Object.keys(localStorage).filter((key) =>
        consentKeys.has(key),
      ),
      localKeyCount: localStorage.length,
    };
  });
  const policy = [];
  for (const path of ["/privacy", "/advertising-disclosure"]) {
    await page.goto(path);
    const paragraphs = await page.locator("main p").allTextContents();
    const excerpts = paragraphs
      .map((p) => p.trim())
      .filter((p) =>
        /advertis|\bads\b|ad-free|consent|Creem|sign you in/i.test(p),
      );
    expect(excerpts.length).toBeGreaterThan(0);
    policy.push({ path, excerpts });
  }

  const auth = await browser.newContext({ baseURL });
  try {
    await expect(
      await auth.request.post("/api/auth/sign-in/magic-link", {
        headers: { Origin: origin.origin },
        data: {
          email: "self-audit-" + randomUUID() + "@example.test",
          returnTo: "/account/billing",
        },
      }),
    ).toBeOK();
    const verify = new URL((await readFile(outbox, "utf8")).trim());
    expect(verify.origin).toBe(origin.origin);
    await expect(await auth.request.get(verify.href)).toBeOK();
    const { user } = await (
      await auth.request.get("/api/auth/get-session")
    ).json();
    const event = JSON.stringify({
      id: randomUUID(),
      eventType: "subscription.paid",
      created_at: Date.now(),
      object: {
        id: "sub_" + randomUUID(),
        product,
        customer: "cust_" + randomUUID(),
        mode: "test",
        current_period_end_date: new Date(Date.now() + 86400000).toISOString(),
        metadata: {
          datadeal_user: user.id,
          datadeal_binding: checkoutBinding(secret, user.id, product),
        },
      },
    });
    await expect(
      await auth.request.post("/api/v1/billing/creem", {
        data: event,
        headers: { "creem-signature": signature(secret, event) },
      }),
    ).toBeOK();
    const session = (await auth.cookies()).filter(
      (c) => c.name === "better-auth.session_token",
    );
    expect(session.length).toBe(1);
    const entitled = await auth.newPage();
    await entitled.goto(report.href);
    await expect(
      entitled.getByRole("link", { name: "Download report as JSON" }),
    ).toBeVisible();
    const free = await measurePlan(browser, report, []);
    const pro = await measurePlan(browser, report, session);
    const result = {
      measuredAt: new Date().toISOString(),
      origin: origin.origin,
      page: path,
      browser: browser.version(),
      scope:
        "Local development report with Google sample display inventory. The Pro session starts already signed in. No rewarded ad was requested.",
      scoring: {
        score: null,
        reason:
          "The public score requires a measured visit to the assessed HTTPS site. This capture covers a loopback report and sample inventory.",
      },
      policy,
      freeBeforeChoice,
      free,
      pro,
    };
    expect(isReportOrigin(origin.origin, "datadeal.app")).toBe(false);
    const artifact = testInfo.outputPath("datadeal-self-assessment.json");
    await writeFile(artifact, JSON.stringify(result, null, 2) + "\n");
    await testInfo.attach("DataDeal self-assessment", {
      path: artifact,
      contentType: "application/json",
    });
    for (const visit of [...free, ...pro]) {
      expect(new URL(visit.visitedUrl).pathname).toBe(report.pathname);
      if (visit.scenario === "accepted")
        expect(visit.afterChoice?.acceptedAll).toBe(true);
      expect(visit.storageSummary.end.web).toBeDefined();
    }
    for (const visit of [
      ...free.filter((v) => v.scenario !== "accepted"),
      ...pro,
    ]) {
      expect(visit.publisherTag.requests).toBe(0);
      expect(visit.externalDomains.filter((d) => adDomain.test(d))).toEqual([]);
    }
    const accepted = free.find((v) => v.scenario === "accepted")!;
    expect(accepted.publisherTag.requests).toBeGreaterThan(0);
    expect(
      Date.parse(accepted.publisherTag.firstRequestAt!),
    ).toBeGreaterThanOrEqual(
      Date.parse(accepted.capture.beforeChoiceSnapshotAt!),
    );
    expect(
      accepted.publisherTag.statuses.some(
        (status) => (status >= 200 && status < 300) || status === 304,
      ),
    ).toBe(true);
    expect(
      accepted.afterChoice?.externalDomains.some((d) => adDomain.test(d)),
    ).toBe(true);
  } finally {
    await auth.close();
  }
});
