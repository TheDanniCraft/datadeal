import { expect, test } from "vitest";
import type { Evidence, ScanReport } from "@datadeal/contracts";
import { validateClassifications, type EvidenceAnalyzer } from "@datadeal/ai";
import { analyzeInventory } from "./inventory-analysis";

const scanId = "11111111-1111-4111-8111-111111111111";
function report(): ScanReport {
  return {
    id: scanId,
    domain: "thedannicraft.de",
    completedAt: "2026-11-25T10:00:00.000Z",
    demo: false,
    partial: false,
    findings: [],
    evidence: [
      {
        id: "browser-consent-accepted",
        kind: "observed_technical",
        url: "https://thedannicraft.de/",
        excerpt: "visit",
        retrievedAt: "2026-11-25T10:00:00.000Z",
        scanId,
        consentScenario: "accepted",
        observation: {
          type: "browser_consent_counts",
          finalPageKnown: true,
          requests: 10,
          cookies: 0,
          externalDomains: [],
          afterChoice: {
            requests: 4,
            externalDomains: ["booking.morgen.so"],
            acceptedAll: true,
          },
        },
      } as Evidence,
    ],
  } as ScanReport;
}

test("researches an unknown vendor and re-classifies with its policy", async () => {
  const calls: (readonly string[] | undefined)[] = [];
  const analyzer: EvidenceAnalyzer = {
    model: "test",
    analyze: async () => ({}) as never,
    async classifyInventory(inventory, evidence, itemIds) {
      calls.push(itemIds);
      const id = inventory.recipients[0].id;
      const vendor = evidence.find((e) => e.id.startsWith("vendor-policy"));
      return validateClassifications(
        {
          classifications: [
            vendor
              ? {
                  itemId: id,
                  purpose: "support",
                  controller: "processor",
                  vendor: "Morgen",
                  confidence: "moderate",
                  reason: "Booking widget that receives the details you enter.",
                  basis: "vendor_policy",
                  citation: {
                    evidenceId: vendor.id,
                    quote: "We process booking data",
                  },
                }
              : {
                  itemId: id,
                  purpose: "unknown",
                  controller: "unknown",
                  vendor: null,
                  confidence: "low",
                  reason: "Unclear.",
                  basis: "none",
                },
          ],
          research: [{ domain: "morgen.so" }],
        },
        inventory,
        evidence.filter((e) => e.observation?.type === "provider_policy"),
      );
    },
  };
  const target = report();
  const inventory = await analyzeInventory(
    analyzer,
    target,
    async (id, vendor, referring) => [
      {
        id: "vendor-policy-" + vendor + "-1",
        scanId: id,
        kind: "third_party_reference",
        url: "https://www.morgen.so/privacy",
        retrievedAt: "2026-11-25T10:00:00.000Z",
        excerpt: "We process booking data on behalf of the calendar owner.",
        observation: {
          type: "provider_policy",
          providerHost: vendor,
          referringEvidenceId: referring,
          heading: "Booking",
        },
      },
    ],
  );
  expect(calls).toHaveLength(2);
  expect(inventory?.research).toEqual([
    {
      domain: "morgen.so",
      status: "fetched",
      evidenceIds: ["vendor-policy-morgen.so-1"],
    },
  ]);
  expect(inventory?.classifications[0]).toMatchObject({
    purpose: "support",
    basis: "vendor_policy",
  });
  expect(target.evidence.map(({ id }) => id)).toContain(
    "vendor-policy-morgen.so-1",
  );
});
