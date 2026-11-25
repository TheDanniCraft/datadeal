import { expect, test } from "@playwright/test";

for (const mode of ["keyboard", "touch", "scripts blocked"] as const) {
  test(`advertising questions and browser guidance open and close with ${mode}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      hasTouch: mode === "touch",
      javaScriptEnabled: mode !== "scripts blocked",
      viewport: { width: mode === "touch" ? 390 : 1280, height: 844 },
    });
    try {
      const page = await context.newPage();
      await page.goto("/advertising-disclosure");
      if (mode !== "scripts blocked") {
        const reject = page.getByRole("button", {
          name: "Reject All",
          exact: true,
        });
        await expect(reject).toBeVisible();
        await reject.click();
        await expect(reject).toBeHidden();
      }
      for (const [label, content] of [
        ["Why does DataDeal use advertising?", "Website scans"],
        [
          "How would advertising affect DataDeal’s own rating?",
          "same evidence rules",
        ],
      ]) {
        const trigger = page.getByText(label, { exact: true });
        const disclosure = trigger.locator("..");
        const answer = disclosure.locator("p").first();
        const toggle = () =>
          mode === "touch" ? trigger.tap() : trigger.press("Enter");
        await expect(answer).toBeHidden();
        await toggle();
        await expect(answer).toBeVisible();
        await expect(answer).toContainText(content);
        await toggle();
        await expect(answer).toBeHidden();
      }
      for (const [label, content] of [
        ["Firefox", "Tell websites not to sell or share my data"],
        ["Chrome", "eligible profiles in California"],
        ["Microsoft Edge", "Tracking prevention"],
        ["Safari on Mac", "Prevent cross-site tracking"],
      ]) {
        if (mode === "scripts blocked") {
          const heading = page.getByText(label, { exact: true });
          await heading.press("Enter");
          await expect(heading.locator("..").locator("p")).toContainText(
            content,
          );
          continue;
        }
        const tab = page.getByRole("tab", { name: label, exact: true });
        if (mode === "touch") await tab.tap();
        else if (label === "Firefox") await tab.focus();
        else await page.keyboard.press("ArrowRight");
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(
          page.getByRole("tabpanel", { name: label, exact: true }),
        ).toContainText(content);
      }
    } finally {
      await context.close();
    }
  });
}
