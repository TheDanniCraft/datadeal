import { afterEach, expect, it, vi } from "vitest";
vi.mock("./auth", () => ({ auth: null }));
vi.mock("./reports", () => ({ database: null }));
import { pointsRequest } from "./point-offer";

afterEach(() => vi.unstubAllEnvs());

const call = (origin?: string) =>
  pointsRequest(
    new Request("https://datadeal.example/api/v1/rewards/boost", {
      method: "POST",
      headers: origin ? { origin } : {},
    }),
  );

it("allows point spending from the configured origin once points are on", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ORIGIN", "https://datadeal.example");
  vi.stubEnv("DATADEAL_POINTS", "false");
  expect(call("https://datadeal.example")).toBe(404);
  vi.stubEnv("DATADEAL_POINTS", "true");
  expect(call("https://datadeal.example")).toBe(0);
  expect(call("https://elsewhere.example")).toBe(403);
  expect(call()).toBe(403);
  vi.stubEnv("APP_ORIGIN", "");
  expect(call("https://datadeal.example")).toBe(404);
});
