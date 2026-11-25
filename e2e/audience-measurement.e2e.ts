import { expect, test } from "@playwright/test";

const origin = process.env.DATADEAL_UMAMI_ORIGIN;
const website = process.env.DATADEAL_UMAMI_WEBSITE_ID;
test.skip(
  !origin || !website,
  "Requires a test server configured with a dedicated Umami origin and website ID.",
);

test("public pageviews honor explicit measurement consent across navigation and revocation", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const requests: {
    path: string;
    body: unknown;
    cookie?: string;
    referer?: string;
  }[] = [];
  await context.addCookies([
    { name: "measurement-test-cookie", value: "unused", url: origin! },
  ]);
  await context.route(new URL(origin!).origin + "/**", async (route) => {
    const request = route.request();
    const headers = await request.allHeaders();
    if (request.method() !== "OPTIONS") {
      requests.push({
        path: new URL(request.url()).pathname,
        body: request.postDataJSON(),
        cookie: headers.cookie,
        referer: headers.referer,
      });
    }
    await route.fulfill({
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.goto(
    "/report/private-lookup.example?email=private%40example.org#evidence-1",
  );
  await page.getByRole("button", { name: "Reject All", exact: true }).click();
  const privacy = page
    .getByRole("button", { name: "Privacy settings", exact: true })
    .last();
  async function toggleMeasurement() {
    await privacy.click();
    const dialog = page.getByRole("dialog", {
      name: "Privacy Settings",
      exact: true,
    });
    await dialog
      .getByRole("switch", { name: "Analytics", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Save Settings", exact: true })
      .click();
    await expect(dialog).toBeHidden();
  }
  expect(requests).toHaveLength(0);
  await toggleMeasurement();
  await expect.poll(() => requests.length).toBe(1);
  await toggleMeasurement(); // Withdraw, then accept again on the same page.
  await toggleMeasurement();
  await page.evaluate(() =>
    history.replaceState(null, "", "?lookup=another.example#another-evidence"),
  );
  await page.locator("footer").getByRole("link", { name: "API docs" }).click();
  await expect(page).toHaveURL(/\/developers$/);
  await expect.poll(() => requests.length).toBe(2);
  await toggleMeasurement();
  await page
    .locator("footer")
    .getByRole("link", { name: "Terms", exact: true })
    .click();
  await expect(page).toHaveURL(/\/terms$/);
  await toggleMeasurement();
  await expect.poll(() => requests.length).toBe(3);
  await page.goto("/account/billing?return=private-account");
  await page.locator("footer").waitFor();
  await page
    .locator("footer")
    .getByRole("link", { name: "Privacy", exact: true })
    .click();
  await expect.poll(() => requests.length).toBe(4);
  expect(requests).toEqual(
    ["/report", "/developers", "/terms", "/privacy"].map((url) => ({
      path: "/api/send",
      body: {
        type: "event",
        payload: { website, hostname: new URL(page.url()).hostname, url },
      },
      cookie: undefined,
      referer: undefined,
    })),
  );
});
