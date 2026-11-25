import { defineConfig } from "@playwright/test";

const existingServer = process.env.DATADEAL_TEST_URL;
const authOutbox = process.env.DATADEAL_AUTH_TEST_MAIL_FILE;
const adDomain = process.env.DATADEAL_AD_TEST_DOMAIN;
const rewardDomain = process.env.DATADEAL_REWARDED_AD_TEST_DOMAIN;
const partialDomain = process.env.DATADEAL_PARTIAL_TEST_DOMAIN;
const ratedDomain = process.env.DATADEAL_TEST_PUBLISHED_RATED_DOMAIN;
const requestScan = process.env.DATADEAL_TEST_SCAN_REQUEST === "true";
const testDatabase = process.env.DATADEAL_TEST_DATABASE_URL;
const selfAssessment = Boolean(process.env.DATADEAL_SELF_ASSESSMENT_DOMAIN);
const testPort = selfAssessment ? 3197 : 3100;
const testOrigin = "http://localhost:" + testPort;
const needsDatabase = Boolean(
  authOutbox ||
  adDomain ||
  rewardDomain ||
  partialDomain ||
  ratedDomain ||
  requestScan,
);

if (!existingServer && needsDatabase && !testDatabase) {
  throw new Error(
    "Set DATADEAL_TEST_DATABASE_URL for database-backed browser tests",
  );
}

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/playwright",
  testMatch: "**/*.e2e.ts",
  workers: authOutbox ? 1 : undefined,
  use: { baseURL: existingServer ?? testOrigin },
  webServer: existingServer
    ? undefined
    : {
        command: "bun --no-env-file run --cwd apps/web dev --port " + testPort,
        url: testOrigin,
        env: {
          DATADEAL_BROWSER_TEST: "true",
          DATADEAL_BROWSER_TEST_RUNNER: selfAssessment
            ? "self-assessment"
            : "playwright",
          DATADEAL_DEMO: selfAssessment ? "false" : "true",
          DATABASE_URL: needsDatabase ? testDatabase! : "",
          DATADEAL_GOOGLE_AD_UNIT:
            !selfAssessment && adDomain ? "/123456/test-report" : "",
          DATADEAL_LOCAL_SAMPLE_ADS: rewardDomain
            ? "true"
            : (process.env.DATADEAL_LOCAL_SAMPLE_ADS ?? "false"),
          DATADEAL_GOOGLE_LIMITED_AD_UNIT: selfAssessment
            ? ""
            : (process.env.DATADEAL_GOOGLE_LIMITED_AD_UNIT ?? ""),
          ...(authOutbox && {
            APP_ORIGIN: testOrigin,
            DATADEAL_MAIL_MODE: "local",
            DATADEAL_LOCAL_MAIL_FILE: authOutbox,
          }),
        },
        timeout: 90000,
      },
});
