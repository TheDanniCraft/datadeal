import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
} from "@playwright/test";
import { observeConsentWithCoverage } from "../apps/worker/consent-observation";

test("compares identifiers only on explicit opt-in within an isolated browser visit", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const fixtureBrowser = {
    isConnected: () => browser.isConnected(),
    newContext: async (options: BrowserContextOptions) => {
      const context = await browser.newContext(options);
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === "www.facebook.com")
          return route.fulfill({
            status: 200,
            contentType: "image/gif",
            body: "",
          });
        if (url.hostname !== "www.example.org") return route.abort();
        return route.fulfill({
          contentType: "text/html",
          body: `<title>Example</title>
          <script>
          document.cookie="_fbp=fb.1.1720000000000.123456789;Secure;Path=/;Max-Age=86400";
          function choose(){document.querySelector("section").remove();new Image().src="https://www.facebook.com/tr/?id=1234567&ev=PageView&fbp=fb.1.1720000000000.123456789";}
          </script><section role="dialog"><p>Optional cookies</p><button onclick="choose()">Reject all</button><button onclick="choose()">Accept all</button></section>`,
        });
      });
      return context;
    },
  } as Browser;
  const origin = new URL("https://www.example.org/");
  for (const enabled of [false, true]) {
    const result = enabled
      ? await observeConsentWithCoverage(
          fixtureBrowser,
          origin,
          undefined,
          true,
        )
      : await observeConsentWithCoverage(fixtureBrowser, origin);
    expect(result.coverage.rejected).toBe("measured");
    const rejected = result.observations.find(
      (row) => row.scenario === "rejected",
    )!;
    const group = rejected.network.find(
      (group) => group.signature === "meta_pixel_event",
    )!;
    expect(rejected.capture.identifierComparisonEnabled).toBe(enabled);
    expect(group).toMatchObject({
      responses: 1,
      initiator: "tested_top_level",
      phase: "after_choice",
    });
    expect(group.matchedStorage).toBe(enabled ? "fbp_cookie" : undefined);
    expect(JSON.stringify(result)).not.toContain("1720000000000");
  }
});
