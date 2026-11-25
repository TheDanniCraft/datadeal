import { expect, test } from "vitest";
import type { Evidence } from "./index";
import { buildStorageInventory } from "./storage-inventory";

const id = "11111111-1111-4111-8111-111111111111";
const idLike = {
  length: "long",
  shape: "other",
  identifierLike: true,
} as const;
const flag = { length: "short", shape: "flag", identifierLike: false } as const;
const cookie = (
  name: string,
  value: typeof idLike | typeof flag,
  site = "shop.example",
) => ({
  name,
  scope:
    site === "shop.example"
      ? ("same_site" as const)
      : ("outside_site" as const),
  site,
  persistent: true,
  expiry: "within_year" as const,
  secure: true,
  httpOnly: false,
  sameSite: "Lax" as const,
  value,
});
const snapshot = (
  named: ReturnType<typeof cookie>[],
  keys: { name: string; value: typeof idLike }[] = [],
) => ({
  cookies: {
    total: named.length,
    inspected: named.length,
    recognized: [],
    named,
  },
  web: {
    local: { total: keys.length, inspected: keys.length, categories: [], keys },
    session: { total: 0, inspected: 0, categories: [], keys: [] },
  },
});

function visit(
  scenario: "default" | "rejected" | "accepted",
  before: ReturnType<typeof snapshot>,
  end: ReturnType<typeof snapshot>,
  beforeDomains: string[],
  afterDomains: string[],
): Evidence {
  return {
    id: "browser-consent-" + scenario,
    kind: "observed_technical",
    url: "https://shop.example/",
    excerpt: "visit",
    retrievedAt: "2026-11-25T10:00:00.000Z",
    scanId: id,
    consentScenario: scenario,
    observation: {
      type: "browser_consent_counts",
      finalPageKnown: true,
      requests: 40,
      cookies: end.cookies.total,
      externalDomains: beforeDomains,
      storageSummary: { beforeChoice: before, end },
      afterChoice: {
        requests: 20,
        externalDomains: afterDomains,
        acceptedAll: scenario === "accepted",
      },
    },
  } as Evidence;
}

test("builds one value-free row per unique item and recipient with phases", () => {
  const consent = cookie("c15t", flag);
  const before = snapshot([consent]);
  const accepted = snapshot(
    [
      consent,
      cookie("_ga", idLike),
      cookie("_fbp", idLike),
      cookie("theme", flag),
    ],
    [{ name: "cw_conversation", value: idLike }],
  );
  const metaFields: Evidence = {
    id: "browser-fields-accepted-1",
    kind: "observed_technical",
    excerpt: "fields",
    retrievedAt: "2026-11-25T10:00:00.000Z",
    scanId: id,
    consentScenario: "accepted",
    observation: {
      type: "browser_request_fields",
      targetDomain: "www.facebook.com",
      scheme: "https",
      relation: "cross_site",
      method: "GET",
      phase: "after_choice",
      fieldCategories: ["page_url", "identifier", "event_name"],
      sources: ["query"],
      signature: "meta_pixel_event",
      matchedStorage: "fbp_cookie",
      attempts: 2,
      responses: 2,
    },
  } as Evidence;
  const inventory = buildStorageInventory({
    id,
    domain: "shop.example",
    evidence: [
      visit(
        "rejected",
        before,
        snapshot([consent]),
        ["cdn.example-cdn.net"],
        [],
      ),
      visit(
        "accepted",
        before,
        accepted,
        ["cdn.example-cdn.net"],
        ["www.google-analytics.com", "connect.facebook.net"],
      ),
      metaFields,
    ],
  });
  const byName = Object.fromEntries(inventory.storage.map((s) => [s.name, s]));
  expect(Object.keys(byName).sort()).toEqual([
    "_fbp",
    "_ga",
    "c15t",
    "cw_conversation",
    "theme",
  ]);
  expect(byName.c15t.phases).toEqual([
    "before_choice",
    "after_reject",
    "after_accept",
  ]);
  expect(byName._ga.phases).toEqual(["after_accept"]);
  expect(byName.cw_conversation).toMatchObject({
    mechanism: "local_storage",
    site: "shop.example",
  });
  const byDomain = Object.fromEntries(
    inventory.recipients.map((r) => [r.domain, r]),
  );
  expect(Object.keys(byDomain).sort()).toEqual([
    "example-cdn.net",
    "facebook.com",
    "facebook.net",
    "google-analytics.com",
  ]);
  expect(byDomain["example-cdn.net"].phases).toEqual(["before_choice"]);
  expect(byDomain["facebook.com"]).toMatchObject({
    phases: ["after_accept"],
    fields: ["identifier", "page_url", "event_name"],
    linkedIdentifier: true,
    answered: true,
  });
  expect(inventory.truncated).toBe(false);
  // Stable ids for the same input.
  expect(
    buildStorageInventory({
      id,
      domain: "shop.example",
      evidence: [metaFields],
    }).recipients[0].id,
  ).toBe(byDomain["facebook.com"].id);
});

test("ignores evidence from other scans and first-party recipients", () => {
  const inventory = buildStorageInventory({
    id,
    domain: "shop.example",
    evidence: [
      {
        ...visit(
          "accepted",
          snapshot([]),
          snapshot([]),
          ["static.shop.example"],
          [],
        ),
        scanId: id,
      },
      {
        ...visit(
          "accepted",
          snapshot([cookie("x", idLike)]),
          snapshot([]),
          ["ads.example"],
          [],
        ),
        scanId: "other",
      },
    ],
  });
  expect(inventory.storage).toEqual([]);
  expect(inventory.recipients).toEqual([]);
});

test("keeps a vendor event sent through a first-party proxy", () => {
  const proxy: Evidence = {
    id: "browser-fields-accepted-2",
    kind: "observed_technical",
    excerpt: "fields",
    retrievedAt: "2026-11-25T10:00:00.000Z",
    scanId: id,
    consentScenario: "accepted",
    observation: {
      type: "browser_request_fields",
      targetDomain: "shop.example",
      scheme: "https",
      relation: "same_origin",
      method: "POST",
      phase: "before_choice",
      fieldCategories: ["page_url", "event_name", "site_domain"],
      sources: ["json"],
      signature: "plausible_event",
      attempts: 1,
      responses: 1,
    },
  } as Evidence;
  const plain = {
    ...proxy,
    id: "x",
    observation: { ...proxy.observation!, signature: undefined },
  } as Evidence;
  const inventory = buildStorageInventory({
    id,
    domain: "shop.example",
    evidence: [proxy, plain],
  });
  expect(inventory.recipients).toHaveLength(1);
  expect(inventory.recipients[0]).toMatchObject({
    domain: "shop.example",
    via: { kind: "first_party_proxy", vendor: "plausible" },
    phases: ["before_choice"],
  });
});
