import { expect, it } from "vitest";
import { evidence } from "@datadeal/contracts";
import { storageEvidence } from "./storage-evidence";

it("shows grouped observations and preserves the limits of an older snapshot", () => {
  const before = { total: 2, inspected: 1, recognized: [] };
  const row = evidence.parse({
    scanId: "b84e5b44-b30f-45a3-ab5a-15fc0cb7c089",
    id: "browser-consent-rejected",
    retrievedAt: "2026-11-25T12:00:00.000Z",
    kind: "observed_technical",
    consentScenario: "rejected",
    url: "https://example.com/",
    excerpt: "Storage capture.",
    observation: {
      type: "browser_consent_counts",
      freshContext: true,
      requests: 1,
      cookies: 3,
      externalDomains: [],
      storageSummary: {
        beforeChoice: { cookies: before },
        end: {
          cookies: {
            total: 3,
            inspected: 3,
            recognized: [],
            unclassified: [
              {
                scope: "same_site",
                site: "example.com",
                count: 2,
                persistent: false,
              },
              {
                scope: "outside_site",
                site: "example.org",
                count: 1,
                persistent: true,
                expiry: "over_year",
              },
            ],
          },
        },
      },
    },
  });
  const text = storageEvidence(row);
  expect(text).toContain(
    "Immediately before the choice, DataDeal inspected 1 of 2 cookies (no recognized family)",
  );
  expect(text).toContain(
    "2 unclassified session cookies (example.com, same-site)",
  );
  expect(text).toContain(
    "1 unclassified persistent cookie (example.org, outside-site, expires after a year)",
  );
  expect(text).not.toMatch(/advertis|tracking|recipient/i);
});
