import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const requireDatabase = createRequire(
  resolve("packages/database/package.json"),
);
const postgres = requireDatabase("postgres");
const testDatabase = process.env.DATADEAL_TEST_DATABASE_URL;

for (const width of [390, 1440]) {
  test(`keeps the latest scan stage on one line and remembers disclosure choices at ${width}px`, async ({
    page,
  }, info) => {
    test.skip(
      !testDatabase || process.env.DATADEAL_TEST_SCAN_REQUEST !== "true",
      "Requires an isolated scan queue",
    );
    test.setTimeout(90_000);
    const sql = postgres(testDatabase);
    const id = randomUUID();
    const domain = "progress-" + id + ".example.com";
    try {
      await sql`insert into domains (name) values (${domain})`;
      await sql`insert into scans (id, domain, state) values (${id}, ${domain}, 'fetching')`;
      await sql`insert into scan_jobs (scan_id, owner, lease_until, stages)
        values (${id}, ${randomUUID()}, now() + interval '5 minutes', array['homepage','sitemap'])`;
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/report/" + domain);
      const reject = page.getByRole("button", {
        name: /reject all|reject optional/i,
      });
      await page.addLocatorHandler(reject, () => reject.click());
      const trigger = page.getByRole("button", { name: /Scan progress/ });
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toContainText("Sitemap discovery");
      await expect(
        page.getByText("Homepage retrieval", { exact: true }),
      ).toHaveCount(0);
      const height = await trigger.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      await sql`update scan_jobs set stages = array_append(stages, 'policy') where scan_id = ${id}`;
      await expect(trigger).toContainText("Policy retrieval", {
        timeout: 20_000,
      });
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(
        await trigger.evaluate(
          (element) => element.getBoundingClientRect().height,
        ),
      ).toBe(height);
      expect(
        await trigger.evaluate(
          (element) => element.getBoundingClientRect().right,
        ),
      ).toBeLessThanOrEqual(width);
      await trigger.scrollIntoViewIfNeeded();
      if (await reject.isVisible()) await reject.click();
      await page.screenshot({ path: info.outputPath("collapsed.png") });
      await trigger.focus();
      await trigger.press("Enter");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(
        page.getByText("Homepage retrieval", { exact: true }),
      ).toBeVisible();
      await sql`update scan_jobs set stages = array_append(stages, 'browser') where scan_id = ${id}`;
      await expect(trigger).toContainText("Browser measurement", {
        timeout: 20_000,
      });
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(trigger).toBeFocused();
      await page.screenshot({ path: info.outputPath("expanded.png") });
      await trigger.press("Space");
      await sql`update scan_jobs set stages = array_append(stages, 'analysis') where scan_id = ${id}`;
      await expect(trigger).toContainText("Policy analysis", {
        timeout: 20_000,
      });
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(
        page.getByText("Homepage retrieval", { exact: true }),
      ).toHaveCount(0);
    } finally {
      await sql`delete from scans where id = ${id}`;
      await sql`delete from domains where name = ${domain}`;
      await sql.end();
    }
  });
}
