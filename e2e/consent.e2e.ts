import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  observeConsent,
  observeConsentWithCoverage,
} from "../apps/worker/consent-observation";

test("excludes a successful HTTP challenge page from consent measurements", async ({
  browser,
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      "<title>Just a moment...</title><form id='challenge-form'>Verify you are human</form>",
    );
  }).listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test server port");
    const result = await observeConsentWithCoverage(
      browser,
      new URL("http://127.0.0.1:" + address.port),
    );
    expect(result.observations).toEqual([]);
    expect(result.coverage).toEqual({
      default: "inconclusive",
      rejected: "inconclusive",
      accepted: "inconclusive",
    });
  } finally {
    server.close();
  }
});

test("uses only cookie controls and excludes a blocked post-consent landing", async ({
  browser,
}) => {
  const clicked: string[] = [];
  const server = createServer((req, res) => {
    if (req.url === "/blocked") {
      clicked.push("accept");
      res.writeHead(429, { "Content-Type": "text/html" });
      res.end("<title>Please try again later</title>");
    } else if (req.url === "/rejected") {
      clicked.push("reject");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<title>Homepage</title>");
    } else if (req.url === "/invitations") {
      clicked.push("invitation");
      res.writeHead(204).end();
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<title>Example</title>
        <dialog open><p>Pending invitations</p><button onclick="fetch('/invitations')">Accept all</button><button onclick="fetch('/invitations')">Reject all</button></dialog>
        <section role="dialog"><p>Optional cookies</p>
        <button onclick="location.assign('/blocked')">Accept all</button><button onclick="location.assign('/rejected')">Reject all</button></section>`);
    }
  }).listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test port");
    const result = await observeConsentWithCoverage(
      browser,
      new URL("http://127.0.0.1:" + address.port),
    );
    expect(clicked).toEqual(["reject", "accept"]);
    expect(result.coverage).toEqual({
      default: "measured",
      rejected: "measured",
      accepted: "inconclusive",
    });
    expect(result.observations.map((o) => o.scenario)).toEqual([
      "default",
      "rejected",
    ]);
  } finally {
    server.close();
  }
});

test("recognizes a named consent region without pressing identical buttons in unrelated regions", async ({
  browser,
}) => {
  const actions: string[] = [];
  const server = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    if (request.url === "/") {
      const buttons = (group: string) =>
        ["Accept", "Reject"]
          .map(
            (action) =>
              `<button onclick="location.assign('/${group}-${action}')">${action} All</button>`,
          )
          .join("");
      response.end(`<title>Report</title>
        <section role="region" aria-label="Cookie recipes"><p>Our favorite cookies</p>${buttons("recipes")}</section>
        <section role="region" aria-label="Privacy settings"><p>Pending invitations</p>${buttons("invitations")}</section>
        <section role="region" aria-label="We value your privacy"><p>This site uses cookies to analyze site traffic.</p>${buttons("cookie")}</section>`);
    } else {
      if (/^\/(?:cookie|invitations|recipes)-/.test(request.url ?? ""))
        actions.push(request.url!);
      response.end("<title>Report</title>");
    }
  }).listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test port");
    const result = await observeConsentWithCoverage(
      browser,
      new URL("http://127.0.0.1:" + address.port),
    );
    expect(actions).toEqual(["/cookie-Reject", "/cookie-Accept"]);
    expect(result.coverage).toEqual({
      default: "measured",
      rejected: "measured",
      accepted: "measured",
    });
    expect(
      result.observations.find((row) => row.scenario === "accepted")
        ?.afterChoice?.acceptedAll,
    ).toBe(true);
  } finally {
    server.close();
  }
});

for (const mode of [
  "main page",
  "visible iframe",
  "ambiguous frames",
  "no controls",
] as const) {
  test(`observes explicit German cookie choices in the ${mode}`, async ({
    browser,
  }) => {
    const server = createServer((request, response) => {
      if (mode === "main page" && request.url === "/") {
        response.writeHead(302, { Location: "/landing?source=redirect#start" });
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (mode === "no controls") {
        response.end(
          "<!doctype html><title>Site without consent controls</title>",
        );
        return;
      }
      if (mode !== "main page" && request.url === "/") {
        response.end(`<!doctype html><html lang="de"><body>
        <iframe title="Hidden controls" src="/hidden" hidden></iframe>
        <iframe title="Cookie controls" src="/consent"></iframe>
        ${mode === "ambiguous frames" ? '<iframe title="Other controls" src="/consent"></iframe>' : ""}
      </body></html>`);
        return;
      }
      response.end(`<!doctype html><html lang="de"><body>
      <section id="consent">
        <button onclick="window.frameElement?.remove(); this.parentElement.remove()">Nur notwendige Cookies</button>
        <button onclick="document.cookie='optional=yes; SameSite=Lax'; window.frameElement?.remove(); this.parentElement.remove()">Alle Cookies akzeptieren</button>
      </section>
    </body></html>`);
    });
    server.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test server port");
      const { observations, coverage } = await observeConsentWithCoverage(
        browser,
        new URL("http://127.0.0.1:" + address.port),
      );
      const choiceOutcome =
        mode === "ambiguous frames"
          ? "inconclusive"
          : mode === "no controls"
            ? "control_unavailable"
            : "measured";
      expect(coverage).toEqual({
        default: "measured",
        rejected: choiceOutcome,
        accepted: choiceOutcome,
      });
      expect(
        observations.map(({ scenario, cookies }) => [scenario, cookies]),
      ).toEqual(
        choiceOutcome === "measured"
          ? [
              ["default", 0],
              ["rejected", 0],
              ["accepted", 1],
            ]
          : [["default", 0]],
      );
      for (const measurement of observations) {
        expect(measurement.requests).toBeGreaterThan(0);
        expect(measurement.visitedUrl).toBe(
          "http://127.0.0.1:" +
            address.port +
            (mode === "main page" ? "/landing" : "/"),
        );
      }
      expect(observations[0].afterChoice).toBeUndefined();
      if (choiceOutcome === "measured") {
        expect(observations[1].afterChoice).toBeDefined();
        expect(observations[2].afterChoice?.acceptedAll).toBe(true);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}

test("recognizes a late German accept-all notice separately from purchases and unrelated short controls", async ({
  browser,
}) => {
  const clicks: string[] = [];
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/clicked/")) {
      clicks.push(request.url.slice("/clicked/".length));
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (request.url === "/notice") {
      response.end(`<!doctype html><body>
        <div class="cmp-banner" hidden>
          <p>Mit Tracking und Cookies nutzen</p>
          <button onclick="fetch('/clicked/consent'); document.cookie='optional=yes'; this.parentElement.hidden=true">Alle akzeptieren</button>
          <button onclick="fetch('/clicked/subscribe')">Jetzt abonnieren</button>
        </div>
        <script>setTimeout(() => document.querySelector('.cmp-banner').hidden = false, 2250)</script>`);
    } else {
      response.end(`<!doctype html><body>
        <div role="dialog" aria-label="Einladungen">
          <button onclick="fetch('/clicked/invitations')">Alle akzeptieren</button>
          <button onclick="fetch('/clicked/invitations')">Alle ablehnen</button>
        </div>
        <iframe title="Datenschutzeinstellungen" src="/notice"></iframe>`);
    }
  });
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing port");
    const result = await observeConsentWithCoverage(
      browser,
      new URL("http://127.0.0.1:" + address.port),
    );
    expect(result.coverage).toEqual({
      default: "measured",
      rejected: "control_unavailable",
      accepted: "measured",
    });
    expect(result.observations.map((visit) => visit.cookies)).toEqual([0, 1]);
    expect(result.observations[1].afterChoice?.acceptedAll).toBe(true);
    expect(clicks).toEqual(["consent"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("rejects optional consent and reopens preferences after navigation", async ({
  page,
}) => {
  await page.goto("/");
  const reject = page.getByRole("button", {
    name: /reject all|reject optional/i,
  });
  await expect(reject).toBeVisible();
  await reject.click();
  await expect(reject).toBeHidden();
  await page.goto("/advertising-disclosure");
  await expect(reject).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "What remains free" }),
  ).toBeVisible();
  await page.getByText("Review your privacy settings", { exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/marketing|advertising/i).first(),
  ).toBeVisible();
  await dialog.getByRole("button", { name: /accept all/i }).click();
  await expect(dialog).toBeHidden();
});

const adTestDomain = process.env.DATADEAL_AD_TEST_DOMAIN;

test("keeps the report readable when the publisher script is blocked", async ({
  page,
}) => {
  test.skip(!adTestDomain, "Requires a stored report and a local ad unit");
  const publisherTag = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
  await page.route(publisherTag, (route) => route.abort("blockedbyclient"));
  await page.goto("/report/" + adTestDomain);
  const blocked = page.waitForEvent("requestfailed", {
    predicate: (request) => request.url() === publisherTag,
  });
  await page.getByRole("button", { name: /accept all/i }).click();
  await blocked;
  await expect(
    page.getByRole("complementary", { name: "Advertisement", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: /^(AI analysis|Scan summary)$/ }),
  ).toBeVisible();
  const notice = page.getByRole("dialog", { name: "Help fund the next scan" });
  await expect(notice).toContainText("The free report is still available");
  await notice.getByRole("button", { name: "Close", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("complementary", { name: "Partner advertisement" }),
  ).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Sources", exact: true }),
  ).toBeVisible();
  // A configured reward slot has its own opt-in and handles no fill independently.
  const offer = page.getByRole("button", { name: "Watch an ad to unlock" });
  if (await offer.isVisible()) {
    await offer.click();
    await expect(
      page.getByText("The Google test ad script could not load."),
    ).toBeVisible();
    await expect(offer).toHaveCount(0);
  }
});

test("loads the publisher tag only after advertising is accepted", async ({
  page,
}) => {
  test.skip(
    !adTestDomain,
    "Requires a stored non-fixture report and configured local ad unit",
  );
  const tagRequests: string[] = [];
  await page
    .context()
    .route(
      "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
      async (route) => {
        tagRequests.push(route.request().frame().url());
        await route.fulfill({
          contentType: "application/javascript",
          body: `
      const queue = window.googletag.cmd;
      queue.push = callback => callback();
      let render;
      const publisher = {
        addEventListener(_, callback) { render = callback; },
        removeEventListener() { render = undefined; },
      };
      Object.assign(window.googletag, {
        apiReady: true,
        defineSlot: () => ({ addService() {} }),
        pubads() { return publisher; },
        enableServices() {},
        display(slot) {
          const empty = location.search.includes("no-fill");
          if (!empty) document.body.dataset.adDisplayed = "true";
          else document.body.dataset.adEmpty = "true";
          render({ slot, isEmpty: empty });
        },
        destroySlots() { delete document.body.dataset.adDisplayed; },
      });
      queue.forEach(callback => callback());
    `,
        });
      },
    );
  await page.goto("/report/" + adTestDomain);
  const accept = page.getByRole("button", { name: /accept all/i });
  await expect(accept).toBeVisible();
  expect(tagRequests).toHaveLength(0);
  await accept.click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-ad-displayed",
    "true",
  );
  expect(tagRequests).toHaveLength(1);
  const emptyPage = await page.context().newPage();
  await emptyPage.goto("/report/" + adTestDomain + "?no-fill");
  await expect(emptyPage.locator("body")).toHaveAttribute(
    "data-ad-empty",
    "true",
  );
  await expect(
    emptyPage.getByRole("complementary", {
      name: "Advertisement",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    emptyPage.getByRole("dialog", { name: "Help fund the next scan" }),
  ).toHaveCount(0);
  await expect(
    emptyPage.getByRole("region", { name: /^(AI analysis|Scan summary)$/ }),
  ).toBeVisible();
  expect(tagRequests).toHaveLength(2);
  await emptyPage.close();
  await page.getByRole("button", { name: "Privacy settings" }).click();
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    page
      .getByRole("dialog")
      .getByRole("button", { name: /reject all/i })
      .click(),
  ]);
  await expect(
    page.getByRole("complementary", { name: "Advertisement", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-ad-displayed");
  expect(tagRequests).toHaveLength(2);
  const freshPage = await page.context().newPage();
  await freshPage.goto("/report/" + adTestDomain);
  await expect(
    freshPage.getByRole("heading", { name: adTestDomain }),
  ).toBeVisible();
  await expect(
    freshPage.getByRole("button", { name: /accept all/i }),
  ).toBeHidden();
  await expect(
    freshPage.getByRole("complementary", {
      name: "Advertisement",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(tagRequests).toHaveLength(2);
});

test("leaves the placement empty on a declined visit and requests limited GPT only after a specific GPC-compatible grant", async ({
  page,
}) => {
  test.skip(
    !process.env.DATADEAL_REWARDED_AD_TEST_DOMAIN,
    "Requires configured local sample ads",
  );
  await page.setExtraHTTPHeaders({ "Sec-GPC": "1" });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "globalPrivacyControl", {
      get: () => true,
    }),
  );
  const standard: string[] = [],
    limited: string[] = [],
    partnerNetwork: string[] = [];
  await page.route("https://securepubads.g.doubleclick.net/**", (r) => {
    standard.push(r.request().url());
    return r.abort();
  });
  await page.route("https://clipify.us/**", (r) => {
    partnerNetwork.push(r.request().url());
    return r.abort();
  });
  await page.route(
    "https://pagead2.googlesyndication.com/tag/js/gpt.js",
    (route) => {
      limited.push(route.request().url());
      return route.fulfill({
        contentType: "application/javascript",
        body: `
      const pending = window.googletag.cmd;
      let limited = false;
      const pub = {addEventListener(){},removeEventListener(){},setPrivacySettings(p){limited = p.limitedAds === true && p.restrictDataProcessing === true;}};
      Object.assign(window.googletag,{cmd:{push:f=>f()},apiReady:true,pubads:()=>pub,defineSlot:()=>({addService(){}}),enableServices(){},destroySlots(){},display(){document.body.dataset.googleMode=limited?'limited':'unexpected';}});
      pending.forEach(fn=>fn());`,
      });
    },
  );
  await page.goto("/report/" + process.env.DATADEAL_REWARDED_AD_TEST_DOMAIN);
  await page.getByRole("button", { name: "Reject All", exact: true }).click();
  const partner = page.getByRole("complementary", {
    name: "Partner advertisement",
  });
  await expect(partner).toHaveCount(0);
  expect(standard.length + limited.length + partnerNetwork.length).toBe(0);
  await page
    .getByRole("button", { name: "Privacy settings", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Accept All", exact: true })
    .click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-google-mode",
    "limited",
  );
  await expect(partner).toHaveCount(0);
  expect(limited).toHaveLength(1);
  expect(standard).toHaveLength(0);
  expect(partnerNetwork).toHaveLength(0);
});
test("offers first-visit GPC choices without an unconfigured Google ad option", async ({
  page,
  context,
}) => {
  test.skip(
    Boolean(
      process.env.DATADEAL_TEST_URL ||
      process.env.DATADEAL_REWARDED_AD_TEST_DOMAIN ||
      process.env.DATADEAL_GOOGLE_LIMITED_AD_UNIT ||
      process.env.DATADEAL_LOCAL_SAMPLE_ADS === "true",
    ),
    "Requires the isolated server without limited inventory",
  );
  await page.setExtraHTTPHeaders({ "Sec-GPC": "1" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const banner = page.getByText("Optional privacy settings", { exact: true });
  await expect(banner).toBeVisible();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  const settings = page.getByRole("dialog", {
    name: "Privacy Settings",
    exact: true,
  });
  await expect(
    settings.getByRole("switch", { name: "Analytics", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("switch", { name: /Marketing|Limited Google ads/ }),
  ).toHaveCount(0);
  await settings
    .getByRole("button", { name: "Reject All", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await context.cookies()).some((cookie) => cookie.name === "c15t"),
    )
    .toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Privacy settings", exact: true }),
  ).toBeVisible();
  await expect(banner).toHaveCount(0);
});
