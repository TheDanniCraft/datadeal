import { afterEach, expect, test, vi } from "vitest";
import { publicPageCategory, umamiConfig } from "./umami";

const website = "771f3e63-35df-4fa1-8724-b4809dab2d0f";
afterEach(() => vi.unstubAllEnvs());

test("Umami requires a configured origin and a website ID", () => {
  vi.stubEnv("DATADEAL_UMAMI_ORIGIN", "https://analytics.example");
  vi.stubEnv("DATADEAL_UMAMI_WEBSITE_ID", "");
  expect(umamiConfig()).toBeUndefined();
  vi.stubEnv("DATADEAL_UMAMI_WEBSITE_ID", website);
  expect(umamiConfig()).toEqual({
    endpoint: "https://analytics.example/api/send",
    websiteId: website,
  });
  for (const origin of [
    "",
    "http://analytics.example",
    "https://user@analytics.example",
    "https://analytics.example/prefix",
    "https://analytics.example/?key=secret",
    "https://analytics.example/#private",
  ]) {
    vi.stubEnv("DATADEAL_UMAMI_ORIGIN", origin);
    expect(umamiConfig()).toBeUndefined();
  }
  vi.stubEnv("DATADEAL_UMAMI_ORIGIN", "http://localhost:3012");
  vi.stubEnv("NODE_ENV", "development");
  expect(umamiConfig()?.endpoint).toBe("http://localhost:3012/api/send");
  vi.stubEnv("NODE_ENV", "production");
  expect(umamiConfig()).toBeUndefined();
});

test("only known public page categories are eligible", () => {
  expect(publicPageCategory("/report/private-lookup.example")).toBe("/report");
  expect(publicPageCategory("/methodology")).toBe("/methodology");
  for (const path of [
    "/account",
    "/account/billing/return/secret",
    "/api/auth/magic-link",
    "/rewards/secret",
    "/unrecognized",
    "/report/foo/evidence/private",
  ]) {
    expect(publicPageCategory(path)).toBeUndefined();
  }
});
