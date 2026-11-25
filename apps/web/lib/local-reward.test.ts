import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { ScanReport } from "@datadeal/contracts";
import { hasAdvancedSnapshotDetails } from "./browser-summary";
import {
  createLocalRewardHolder,
  hasLocalReward,
  localRewardHolder,
  signLocalReward,
} from "./local-reward";

afterEach(() => vi.unstubAllEnvs());

it("offers a guest unlock only for detail belonging to the offered snapshot", () => {
  const id = randomUUID();
  const date = new Date().toISOString();
  const visit = {
    id: "default",
    kind: "observed_technical",
    scanId: id,
    retrievedAt: date,
    consentScenario: "default",
    excerpt: "Measured homepage visit",
    observation: {
      type: "browser_consent_counts",
      requests: 2,
      cookies: 0,
      externalDomains: [],
    },
  } satisfies ScanReport["evidence"][number];
  const report: ScanReport = {
    id,
    domain: "example.org",
    completedAt: date,
    demo: false,
    partial: false,
    evidence: [visit],
    findings: [],
  };
  expect(hasAdvancedSnapshotDetails(report)).toBe(false);
  const external = {
    ...visit,
    observation: { ...visit.observation, externalDomains: ["outside.example"] },
  };
  expect(
    hasAdvancedSnapshotDetails({
      ...report,
      evidence: [visit, { ...external, scanId: randomUUID() }],
    }),
  ).toBe(false);
  expect(hasAdvancedSnapshotDetails({ ...report, evidence: [external] })).toBe(
    true,
  );
  expect(
    hasAdvancedSnapshotDetails({ ...report, demo: true, evidence: [external] }),
  ).toBe(false);
});

it("accepts only an unexpired development grant for the exact scan", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
  vi.stubEnv("DATABASE_URL", "postgresql://localhost/datadeal");
  const signed = signLocalReward("scan-one", Date.now() + 60_000);
  expect(hasLocalReward("scan-one", signed)).toBe(true);
  expect(hasLocalReward("scan-two", signed)).toBe(false);
  expect(
    hasLocalReward(
      "scan-one",
      signed.slice(0, -1) + (signed.endsWith("0") ? "1" : "0"),
    ),
  ).toBe(false);
  expect(
    hasLocalReward(
      "scan-one",
      signLocalReward("scan-one", Date.now() - 60_000),
    ),
  ).toBe(false);
  vi.stubEnv("NODE_ENV", "production");
  expect(hasLocalReward("scan-one", signed)).toBe(false);
});

it("isolates persisted sample holders by scan and local database", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
  vi.stubEnv("DATABASE_URL", "postgresql://127.0.0.1/datadeal");
  const completionId = randomUUID();
  const value = createLocalRewardHolder(completionId);
  expect(createLocalRewardHolder(completionId)).toEqual(value);
  expect(createLocalRewardHolder(randomUUID())).not.toEqual(value);
  const first = localRewardHolder("scan-one", value);
  expect(first).toMatchObject({
    kind: "guest",
    holderHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(localRewardHolder("scan-one", value)).toEqual(first);
  expect(localRewardHolder("scan-two", value)).not.toEqual(first);
  vi.stubEnv("DATABASE_URL", "postgresql://remote.example.com/datadeal");
  expect(localRewardHolder("scan-one", value)).toBeNull();
});
