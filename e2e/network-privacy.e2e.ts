import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analysisInput, selectAnalysisEvidence } from "../packages/ai";
import { requestFieldCollector } from "../apps/worker/request-fields";
import type { Evidence } from "../packages/contracts";

test("keeps raw contact and session values out of AI input from a fresh browser", async ({
  browser,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "datadeal-har-test-"));
  const path = join(directory, "synthetic.har");
  const context = await browser.newContext({
    recordHar: { path },
    serviceWorkers: "block",
  });
  const collector = requestFieldCollector(new URL("https://example.org/"));
  const address = "anonymous.fixture@example.invalid";
  const visitor = "synthetic-first-visit-session";
  try {
    await context.route("**/*", async (route) => {
      if (route.request().url() === "https://example.org/") {
        await route.fulfill({
          contentType: "text/html",
          headers: {
            "Set-Cookie": `visitor=${visitor}; Path=/; Secure; SameSite=Lax`,
          },
          body: "<!doctype html><title>Synthetic research page</title>",
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}",
        });
      }
    });
    context.on("request", (req) => collector.request(req, "before_choice"));
    context.on("response", (res) => collector.response(res.request()));
    expect(await context.cookies()).toEqual([]);
    const page = await context.newPage();
    await page.goto("https://example.org/");
    await page.evaluate(async (address) => {
      await fetch("/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { unrecognized_key: address } }),
      });
    }, address);
    await context.close();
    const raw = await readFile(path, "utf8");
    expect(raw.includes(address)).toBe(true);
    expect(raw.includes(visitor)).toBe(true);
    const evidence: Evidence[] = collector.results().map((observation, i) => ({
      id: `request-${i}`,
      kind: "observed_technical",
      scanId: "12300000-0000-4000-8000-000000000001",
      retrievedAt: new Date().toISOString(),
      excerpt: "Outgoing network fields",
      consentScenario: "default",
      observation,
    }));
    const modelInput = analysisInput(selectAnalysisEvidence(evidence));
    expect(modelInput).toHaveLength(1);
    expect(modelInput[0].browser).toMatchObject({
      fieldCategories: ["email_value"],
      relation: "same_origin",
      responses: 1,
    });
    const encoded = JSON.stringify(modelInput);
    for (const value of [address, visitor, "unrecognized_key"])
      expect(encoded.includes(value)).toBe(false);
  } finally {
    await context.close();
    await rm(path, { force: true });
    await rmdir(directory);
  }
});
