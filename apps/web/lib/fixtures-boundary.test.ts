import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([
  ["development", "false", false],
  ["development", "true", true],
  ["production", "true", false],
] as const)(
  "limits fixture lookup in %s with browser testing set to %s",
  async (mode, browserTest, expected) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATADEAL_DEMO", "true");
    vi.stubEnv("DATADEAL_BROWSER_TEST", browserTest);
    const { lookup } = await import("./reports");
    const { report, score } = await lookup("google.com");
    expect(Boolean(report?.demo)).toBe(expected);
    expect(Boolean(score)).toBe(expected);
  },
);
