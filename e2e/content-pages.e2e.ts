import { expect, test } from "@playwright/test";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { scanReport, type ScanReport } from "../packages/contracts";
import { measureContentPages } from "../apps/worker/consent-observation";
import { configuredContentPageLimit } from "../packages/scanner/content-pages";

test("attributes an article-only recipient to its real URL and scenario", async ({
  playwright,
}) => {
  test.setTimeout(110_000);
  const paths = ["/about", "/projects", "/contact", "/services", "/story"];
  const server = createServer((request, response) => {
    if (paths.includes(request.url ?? "")) {
      const story = request.url === "/story";
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><body><h1>Article</h1>
        <script>sessionStorage.setItem('unknown-private-key', 'private-web-value');</script>
        ${story ? `<img src="http://example.org:${port}/illustration">` : ""}
        <div role="dialog"><p>Cookies</p>
          <button onclick="this.parentElement.remove()">Reject all cookies</button>
          <button onclick="document.cookie='_fbp=fb.1.1700000000000.654321; Max-Age=3600; SameSite=Lax'; document.cookie='cw_conversation=private-chat-thread; Max-Age=3600; SameSite=Lax'; localStorage.setItem('_gcl_ls','private-ad-value'); localStorage.setItem('permutive-id','private-sdk-id'); localStorage.setItem('permutive-session','private-session'); ${story ? `fetch('http://example.org:${port}/measure?gclid=test');` : ""} this.parentElement.remove()">Accept all cookies</button>
        </div>`);
    } else response.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test server");
  const port = address.port;
  const homepage = new URL(`http://example.com:${port}/`);
  const browser = await playwright.chromium.launch({
    args: [
      "--no-proxy-server",
      "--host-resolver-rules=MAP example.com 127.0.0.1, MAP example.org 127.0.0.1",
    ],
  });
  try {
    const report: ScanReport = {
      id: randomUUID(),
      domain: "example.com",
      completedAt: new Date().toISOString(),
      demo: false,
      partial: true,
      evidence: [],
      findings: [],
      pageSample: {
        discovered: paths.length,
        discoveryLimited: false,
        limit: configuredContentPageLimit("5"),
        pages: paths.map((path) => ({
          url: new URL(path, homepage).href,
          source: "sitemap",
          coverage: {
            default: "untested",
            accepted: "untested",
            rejected: "untested",
          },
        })),
      },
    };
    await measureContentPages(browser, report, homepage, async () => true);
    expect(scanReport.safeParse(report).success).toBe(true);
    for (const page of report.pageSample!.pages)
      expect(page.coverage).toEqual({
        default: "measured",
        rejected: "measured",
        accepted: "measured",
      });
    expect(report.evidence).toHaveLength(15);
    expect(
      new Set(report.evidence.map((item) => new URL(item.url!).pathname)),
    ).toEqual(new Set(paths));
    for (const item of report.evidence) {
      const story = item.url === new URL("/story", homepage).href;
      expect(item.observation).toMatchObject({
        type: "browser_content_page",
        externalDomains: story ? ["example.org"] : [],
        cookies: item.consentScenario === "accepted" ? 2 : 0,
      });
      if (item.observation?.type !== "browser_content_page")
        throw new Error("Missing page visit");
      const storage = item.observation.storageSummary!;
      expect(storage.end.web?.session).toEqual({
        total: 1,
        inspected: 1,
        categories: ["unclassified"],
      });
      if (item.consentScenario !== "default") {
        expect(storage.beforeChoice?.cookies.total).toBe(0);
        expect(storage.beforeChoice?.web?.local.categories).toEqual([]);
      } else expect(storage.beforeChoice).toBeUndefined();
      if (item.consentScenario === "accepted") {
        expect(storage.end.cookies.recognized).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "_fbp",
              scope: "same_site",
              persistent: true,
              valueShape: "browser_ad_id_format",
            }),
            expect.objectContaining({
              name: "Chatwoot conversation",
              persistent: true,
            }),
          ]),
        );
        expect(storage.end.web?.local.categories).toEqual([
          "advertising",
          "permutive_visitor_id",
          "session",
        ]);
      } else {
        expect(storage.end.cookies.recognized).toEqual([]);
        expect(storage.end.web?.local.total).toBe(0);
      }
      if (story && item.consentScenario === "accepted")
        expect(item.observation).toMatchObject({
          afterChoice: { acceptedAll: true },
          network: [
            expect.objectContaining({
              targetDomain: "example.org",
              fieldCategories: ["advertising_id"],
            }),
          ],
        });
    }
    expect(JSON.stringify(report)).not.toMatch(
      /unknown-private-key|private-web-value|private-ad-value|private-chat-thread|private-sdk-id|private-session|cw_conversation|permutive-id|permutive-session|1700000000000|654321/,
    );
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
