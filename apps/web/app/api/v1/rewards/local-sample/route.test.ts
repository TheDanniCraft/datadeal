import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  createLocalRewardHolder,
  localRewardHolder,
} from "../../../../../lib/local-reward";
import { POST } from "./route";

const lookup = vi.hoisted(() => vi.fn(async () => false));
vi.mock("../../../../../lib/reports", () => ({
  database: { reservedReportOffer: lookup, archivedReports: async () => [] },
}));
vi.mock("../../../../../lib/auth", () => ({ auth: null }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("requires enabled sample inventory for new completions and preserves an existing guest holder when inventory closes", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DATABASE_URL", "postgres://localhost/example");
  vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(40));
  vi.stubEnv("DATADEAL_LOCAL_SAMPLE_ADS", "true");
  const completionId = randomUUID(),
    scanId = randomUUID();
  const value = createLocalRewardHolder(completionId);
  const holder = localRewardHolder(scanId, value);
  expect(holder).toBeTruthy();
  const origin = "http://localhost:3000";
  const submit = () =>
    POST(
      new Request(origin + "/api/v1/rewards/local-sample", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ host: "example.com", completionId, scanId }),
      }),
    );
  for (const setting of ["false", undefined]) {
    vi.stubEnv("DATADEAL_LOCAL_SAMPLE_ADS", setting);
    expect((await submit()).status).toBe(404);
    expect(lookup).not.toHaveBeenCalled();
    expect(localRewardHolder(scanId, value)).toEqual(holder);
  }
  vi.stubEnv("DATADEAL_LOCAL_SAMPLE_ADS", "true");
  await submit();
  expect(lookup).toHaveBeenCalledExactlyOnceWith(completionId);
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  expect((await submit()).status).toBe(404);
  expect(lookup).not.toHaveBeenCalled();
  expect(localRewardHolder(scanId, value)).toBeNull();
});
