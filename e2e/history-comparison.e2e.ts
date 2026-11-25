import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { scanReport } from "@datadeal/contracts";
import postgres from "../packages/database/node_modules/postgres";
import { changedScoreDrivers } from "../apps/web/lib/history";
import { compareVisitDestinations } from "../apps/web/lib/visit-history";

const enabled = process.env.DATADEAL_HISTORY_TEST === "true";
test.skip(
  !enabled,
  "Run e2e/run-self-assessment.ps1 -HistoryComparison with a pair of published reports.",
);

const host = "history-fixture.example";
function storedFixture(later: boolean) {
  const id = randomUUID();
  const date = later ? "2026-11-25" : "2026-11-24";
  const day = (time: string) => date + "T" + time + "Z";
  const outside = later ? "new-recipient.example" : "former-recipient.example";
  const reason = later
    ? "An advertising identifier reached an independent recipient."
    : "A requested support service used a conversation identifier.";
  const source = {
    scanId: id,
    kind: "observed_technical",
    url: `https://${host}/`,
    retrievedAt: day("09:00:12"),
    excerpt: "Signed-out browser visit.",
  };
  const visit = {
    type: "browser_consent_counts",
    finalPageKnown: true,
    freshContext: true,
    requests: 4,
    externalDomains: [outside],
    cookies: 1,
  };
  return scanReport.parse({
    id,
    domain: host,
    completedAt: day("09:01:00"),
    demo: false,
    partial: false,
    findings: [],
    consentCoverage: {
      default: "measured",
      rejected: "untested",
      accepted: "measured",
    },
    evidence: [
      {
        ...source,
        id: "browser-consent-default",
        consentScenario: "default",
        observation: visit,
      },
      {
        ...source,
        id: "browser-consent-accepted",
        consentScenario: "accepted",
        observation: {
          ...visit,
          afterChoice: {
            requests: 2,
            acceptedAll: true,
            externalDomains: [outside],
          },
          capture: {
            navigationStartedAt: day("09:00:00"),
            endSnapshotAt: day("09:00:10"),
            settleMs: 600,
          },
        },
      },
    ],
    acceptAllScoring: {
      methodologyVersion: "1.0.0",
      rulesRevision: "contextual-practices-4",
      score: later ? 50 : 85,
      grade: later ? "Concerning" : "Good",
      verdict: reason,
      confidence: "Moderate",
      adjustments: [],
      practiceAssessment: {
        coverage: "Fixture of two archived accept-all visits.",
        ratings: [
          {
            factId: "accepted-1",
            score: later ? 50 : 85,
            reason,
            evidenceIds: ["browser-consent-accepted"],
          },
        ],
      },
    },
  });
}

test("limits historical comparisons to Pro and opens evidence from the corresponding scan", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180000);
  const url = new URL(process.env.DATADEAL_TEST_DATABASE_URL!);
  const outbox = process.env.DATADEAL_AUTH_TEST_MAIL_FILE!;
  const realHost = process.env.DATADEAL_SELF_ASSESSMENT_DOMAIN!;
  expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  const db = postgres(url.href);
  const origin = new URL(baseURL!).origin;
  const guest = await browser.newContext({ baseURL });
  const pro = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  try {
    const [cluster] = await db`show data_directory`;
    expect(resolve(cluster.data_directory)).toBe(
      resolve(dirname(outbox), "data"),
    );
    for (const ctx of [guest, pro])
      await ctx.route(/^https?:\/\//, (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
    const before = storedFixture(false),
      after = storedFixture(true);
    await db.begin(async (tx) => {
      await tx`insert into domains(name) values(${host})`;
      for (const report of [before, after])
        await tx`insert into scans(id,domain,state,requested_at,report) values(${report.id},${host},'completed',${report.completedAt},${JSON.stringify(report)}::text::jsonb)`;
    });
    const path = "/report/" + host;
    async function checkProjection() {
      const html = await guest.request.get(path);
      await expect(html).toBeOK();
      expect(await html.text()).not.toContain("former-recipient.example");
      const payload = await guest.request.get("/api/v1/domains/" + host);
      expect(await payload.text()).not.toContain("former-recipient.example");
    }
    const pg = await guest.newPage();
    const pp = await pro.newPage();
    for (const page of [pg, pp]) {
      const reject = page.getByRole("button", {
        name: "Reject All",
        exact: true,
      });
      await page.addLocatorHandler(reject, () => reject.click());
    }
    await pg.goto(path);
    await expect(
      pg.getByRole("region", { name: "Advanced report preview" }),
    ).toBeVisible();
    await checkProjection();
    const grant = await guest.request.post("/api/v1/rewards/local-sample", {
      headers: { Origin: origin },
      data: { host, scanId: after.id, completionId: randomUUID() },
    });
    expect(grant.status()).toBe(204);
    await pg.reload();
    await expect(
      pg.getByRole("heading", { name: "Where your data flows", exact: true }),
    ).toBeVisible();
    await expect(
      pg.getByRole("button", { name: "What changed the score" }),
    ).toHaveCount(0);
    await expect(
      pg.getByRole("button", { name: "Connections after accepting all" }),
    ).toHaveCount(0);
    await checkProjection();

    const email = "history-pro-" + randomUUID() + "@example.test";
    await expect(
      await pro.request.post("/api/auth/sign-in/magic-link", {
        headers: { Origin: origin },
        data: { email, returnTo: "/account" },
      }),
    ).toBeOK();
    const verification = new URL((await readFile(outbox, "utf8")).trim());
    expect(verification.origin).toBe(origin);
    await expect(await pro.request.get(verification.href)).toBeOK();
    const { user } = await (
      await pro.request.get("/api/auth/get-session")
    ).json();
    expect(user.email).toBe(email);
    await db`insert into subscriptions(id,user_id,customer_id,product_id,status,access_until,event_time) values(${randomUUID()},${user.id},'history-fixture','history-fixture','active',now()+interval '1 hour',0)`;

    const real =
      await db`select report from scans where domain=${realHost} order by requested_at desc,id desc limit 2`;
    expect(real.length).toBe(2);
    const [now, then] = real.map((r) => scanReport.parse(r.report));
    await pp.goto("/report/" + realHost + "#history");
    const history = pp.locator("#history");
    const connections = history.getByRole("button", {
      name: "Connections after accepting all",
    });
    const scores = history.getByRole("button", {
      name: "What changed the score",
    });
    const destinations = compareVisitDestinations(then, now);
    if (destinations) {
      await connections.click();
      if (!destinations.earlierOnly.length && !destinations.laterOnly.length)
        await expect(history).toContainText(
          "The recorded destination lists matched.",
        );
      await expect(
        history.getByRole("link", { name: "Earlier browser visit" }),
      ).toHaveAttribute("href", destinations.previous.href);
    } else await expect(connections).toHaveCount(0);
    await expect(scores).toHaveCount(changedScoreDrivers(then, now) ? 1 : 0);
    const archived = history.getByRole("link", {
      name: "View scan",
      exact: true,
    });
    await expect(archived).toHaveAttribute("href", "?scan=" + then.id);
    await history.screenshot({
      path: info.outputPath("published-history-390.png"),
      animations: "disabled",
    });
    await archived.click();
    await expect(pp).toHaveURL(new RegExp("scan=" + then.id + "$"));
    await expect(
      pp.getByRole("link", { name: "View latest scan" }),
    ).toHaveAttribute("href", "/report/" + realHost);

    await pp.goto(path + "#history");
    await scores.click();
    await expect(history).toContainText(before.acceptAllScoring!.verdict);
    await expect(history).toContainText(after.acceptAllScoring!.verdict);
    await connections.click();
    await expect(history).toContainText("former-recipient.example");
    await expect(history).toContainText("new-recipient.example");
    await expect(
      history.getByRole("link", { name: "Earlier browser visit" }),
    ).toHaveAttribute(
      "href",
      path + "?scan=" + before.id + "#evidence-browser-consent-accepted",
    );
    await expect(
      history.getByRole("link", { name: "Later browser visit" }),
    ).toHaveAttribute("href", "#evidence-browser-consent-accepted");
    const proof = history
      .locator('[data-slot="disclosure"]')
      .filter({
        has: pp.getByRole("button", { name: "What changed the score" }),
      })
      .getByRole("link");
    await expect(proof.nth(0)).toHaveAttribute(
      "href",
      "?scan=" + before.id + "#evidence-browser-consent-accepted",
    );
    await expect(proof.nth(1)).toHaveAttribute(
      "href",
      "#evidence-browser-consent-accepted",
    );
    await history.screenshot({
      path: info.outputPath("history-comparison-390.png"),
      animations: "disabled",
    });
    await proof.first().click();
    await expect(pp).toHaveURL(
      new RegExp("scan=" + before.id + "#evidence-browser-consent-accepted$"),
    );
    await expect(
      pp.locator("#evidence-browser-consent-accepted"),
    ).toBeInViewport();
    expect(
      await pp.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    console.log(
      "Real report comparison",
      realHost,
      then.id,
      now.id,
      destinations
        ? "comparable destination lists"
        : "insufficient comparable destinations",
    );
  } finally {
    await Promise.all([guest.close(), pro.close(), db.end()]);
  }
});
