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

const googleHosts =
  /^https:\/\/(?:[^/]+\.)?(?:googlesyndication\.com|doubleclick\.net|googletagservices\.com|fundingchoicesmessages\.google\.com|adtrafficquality\.google)\//;

test("loads no Google script and hides Privacy settings while AdSense is off", async ({
  page,
}) => {
  test.skip(
    process.env.DATADEAL_ADSENSE === "true",
    "Requires the server without AdSense",
  );
  const google: string[] = [];
  page.on("request", (request) => {
    if (googleHosts.test(request.url())) google.push(request.url());
  });
  for (const path of ["/", "/privacy", "/advertising-disclosure"]) {
    await page.goto(path);
    await expect(page.locator("footer")).toBeVisible();
    await expect(
      page
        .locator("footer")
        .getByRole("button", { name: "Privacy settings", exact: true }),
    ).toHaveCount(0);
  }
  await expect(
    page.locator("html[data-ads], script#datadeal-adsense"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Review your privacy settings" }),
  ).toHaveAttribute("href", "/privacy#reports");
  expect(google).toEqual([]);
});

test("opens Google's revocation message from Privacy settings", async ({
  page,
}) => {
  test.skip(
    process.env.DATADEAL_ADSENSE !== "true",
    "Requires a server with DATADEAL_ADSENSE=true",
  );
  await page.route(
    "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js**",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `
          window.googlefc = window.googlefc || {};
          window.googlefc.showRevocationMessage = () => {
            document.body.dataset.revocationShown = "true";
          };
          const queue = window.googlefc.callbackQueue || [];
          window.googlefc.callbackQueue = { push: (fn) => fn() };
          queue.forEach((fn) => fn());
        `,
      }),
  );
  await page.goto("/");
  await page
    .locator("footer")
    .getByRole("button", { name: "Privacy settings", exact: true })
    .click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-revocation-shown",
    "true",
  );
});

const adTestDomain = process.env.DATADEAL_AD_TEST_DOMAIN;

test("keeps the report readable when the sample publisher script is blocked", async ({
  page,
}) => {
  test.skip(!adTestDomain, "Requires a stored report and local sample ads");
  const publisherTag = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
  await page.route(publisherTag, (route) => route.abort("blockedbyclient"));
  const blocked = page.waitForEvent("requestfailed", {
    predicate: (request) => request.url() === publisherTag,
  });
  // Without a consent management platform, local sample ads load directly.
  await page.goto("/report/" + adTestDomain);
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
  await expect(notice).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Sources", exact: true }),
  ).toBeVisible();
});

const fakePublisherTag = `
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
`;

test("loads the sample publisher tag only with TCF consent and hides an empty slot", async ({
  page,
  context,
}) => {
  test.skip(!adTestDomain, "Requires a stored report and local sample ads");
  const tagRequests: string[] = [];
  await context.route(
    "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
    async (route) => {
      tagRequests.push(route.request().frame().url());
      await route.fulfill({
        contentType: "application/javascript",
        body: fakePublisherTag,
      });
    },
  );
  const refused = await context.newPage();
  // A minimal IAB TCF API without purpose 1 consent.
  await refused.addInitScript(() =>
    Reflect.set(
      window,
      "__tcfapi",
      (
        command: string,
        _version: number,
        callback: (data: object, success: boolean) => void,
      ) => {
        if (command === "addEventListener")
          callback(
            {
              eventStatus: "tcloaded",
              gdprApplies: true,
              listenerId: 1,
              purpose: { consents: { 1: false } },
            },
            true,
          );
      },
    ),
  );
  await refused.goto("/report/" + adTestDomain);
  await expect(
    refused.getByRole("region", { name: /^(AI analysis|Scan summary)$/ }),
  ).toBeVisible();
  await expect(
    refused.getByRole("complementary", { name: "Advertisement", exact: true }),
  ).toHaveCount(0);
  expect(tagRequests).toHaveLength(0);
  await refused.close();

  await page.goto("/report/" + adTestDomain);
  await expect(page.locator("body")).toHaveAttribute(
    "data-ad-displayed",
    "true",
  );
  expect(tagRequests).toHaveLength(1);
  const emptyPage = await context.newPage();
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
  await emptyPage.close();
});
