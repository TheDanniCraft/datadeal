import { expect, it } from "vitest";
import { browserStorageSnapshot, evidence } from "@datadeal/contracts";
import { buildPracticeEvidenceBundle } from "@datadeal/contracts/practice-evidence";
import { summarizeBrowserCookies } from "./browser-storage";

// Cookie names are public and kept (masked); values must never be retained.
const withoutNames = (value: unknown) =>
  JSON.stringify(value, (key, item) => (key === "name" ? undefined : item));

it("retains only bounded recognized cookie families, coarse flags and site scope", () => {
  const base = {
    name: "unknown-private-name",
    value: "private-cookie-value",
    domain: "tenant.github.io",
    expires: -1,
    secure: true,
    httpOnly: true,
    sameSite: "Strict" as const,
  };
  const ga = {
    ...base,
    name: "_ga",
    value: "GA1.1.123456.7654321",
    expires: 2_000_000_000,
  };
  const sibling = { ...base, name: "_ga_Q7DR12X", domain: ".other.github.io" };
  const records = [
    ga,
    sibling,
    ...Array(64).fill(base),
    { ...base, name: "_fbp" },
  ];
  const cookies = summarizeBrowserCookies(
    records,
    new URL("https://tenant.github.io"),
  );
  expect(cookies).toMatchObject({
    total: 67,
    inspected: 64,
    recognized: [
      {
        name: "_ga",
        scope: "same_site",
        persistent: true,
        secure: true,
        httpOnly: true,
        sameSite: "Strict",
        valueShape: "analytics_client_format",
      },
      { name: "_ga_*", scope: "outside_site", persistent: false },
    ],
  });
  const serialized = withoutNames(browserStorageSnapshot.parse({ cookies }));
  expect(serialized).not.toMatch(/Q7DR12X|private|123456|_fbp/);
  expect(cookies.recognized[1].site).toBe("other.github.io");
  expect(cookies.unclassified).toEqual([
    {
      site: "tenant.github.io",
      scope: "same_site",
      persistent: false,
      count: 62,
    },
  ]);
  expect(
    browserStorageSnapshot.safeParse({
      cookies: {
        ...cookies,
        recognized: [{ ...cookies.recognized[0], value: "private" }],
      },
    }).success,
  ).toBe(false);
});

it("preserves distinct value-free facts for unknown cookie lifetimes, sites and counts", () => {
  const base = {
    name: "private-name-123456",
    value: "secret-user-value",
    domain: "private-subdomain.shop.example.com",
    expires: -1,
    secure: true,
    httpOnly: false,
    sameSite: "Lax" as const,
  };
  const page = new URL("https://shop.example.com/");
  const now = 1700000000;
  const cookies = summarizeBrowserCookies(
    [
      base,
      { ...base, name: "private-name-2" },
      { ...base, expires: now + 120 },
      { ...base, expires: now + 86400 * 90, value: "private-expiry" },
      { ...base, domain: ".images.example.net", expires: now + 86400 * 90 },
    ],
    page,
    now,
  );
  expect(cookies.unclassified).toEqual([
    { scope: "same_site", site: "example.com", persistent: false, count: 2 },
    {
      scope: "same_site",
      site: "example.com",
      persistent: true,
      expiry: "within_day",
      count: 1,
    },
    {
      scope: "same_site",
      site: "example.com",
      persistent: true,
      expiry: "within_year",
      count: 1,
    },
    {
      scope: "outside_site",
      site: "example.net",
      persistent: true,
      expiry: "within_year",
      count: 1,
    },
  ]);
  const id = "b84e5b44-b30f-45a3-ab5a-15fc0cb7c089";
  function bundle(jar: typeof cookies, before?: typeof cookies) {
    const row = evidence.parse({
      scanId: id,
      id: "browser-consent-default",
      retrievedAt: "2026-11-25T12:00:00.000Z",
      kind: "observed_technical",
      consentScenario: "default",
      url: page.href,
      excerpt: "Browser snapshot.",
      observation: {
        type: "browser_consent_counts",
        freshContext: true,
        finalPageKnown: true,
        requests: 1,
        cookies: jar.total,
        externalDomains: [],
        storageSummary: {
          ...(before && { beforeChoice: { cookies: before } }),
          end: { cookies: jar },
        },
      },
    });
    return buildPracticeEvidenceBundle({ id, evidence: [row] });
  }
  const facts = bundle(cookies).practices;
  expect(facts.map((f) => f.storage?.count).sort()).toEqual([1, 1, 1, 2]);
  expect(new Set(facts.map((f) => f.factId)).size).toBe(4);
  expect(withoutNames([cookies, facts])).not.toMatch(
    /private|secret-user|123456|1700000/,
  );
  expect(
    bundle({ total: 5, inspected: 3, recognized: [] }).practices[0].storage,
  ).toMatchObject({
    family: "Unclassified cookie",
    scope: "unknown",
    lifetime: "unknown",
    count: 3,
  });
  const groups = cookies.unclassified!;
  const before = {
    total: 2,
    inspected: 2,
    recognized: [],
    unclassified: [groups[0]],
  };
  const persistentOnly = {
    total: 1,
    inspected: 1,
    recognized: [],
    unclassified: [groups[1]],
  };
  for (const { storage } of bundle(persistentOnly, before).practices) {
    expect(storage?.presentAt).toEqual([storage?.snapshot]);
  }
  expect(
    browserStorageSnapshot.safeParse({
      cookies: {
        ...cookies,
        unclassified: [{ ...groups[0], count: 5, value: "x" }],
      },
    }).success,
  ).toBe(false);
  expect(
    browserStorageSnapshot.safeParse({
      cookies: { ...cookies, unclassified: groups.slice(1) },
    }).success,
  ).toBe(false);
});

it("recognizes Meta cookie names only on facebook.com and drops private values and lookalike names", () => {
  const rows = [
    ".facebook.com",
    "www.facebook.com",
    "facebook.com.example.org",
  ].flatMap((domain) =>
    ["datr", "sb", "DATR", "datr_backup"].map((name) => ({
      domain,
      name,
      value: "private-cookie-value",
      expires: -1,
      secure: true,
      httpOnly: true,
      sameSite: "Lax" as const,
    })),
  );
  const jar = summarizeBrowserCookies(
    rows,
    new URL("https://www.facebook.com/"),
  );
  expect(jar.recognized.map((c) => [c.name, c.site, c.scope])).toEqual(
    ["datr", "sb", "datr", "sb"].map((name) => [
      name,
      "facebook.com",
      "same_site",
    ]),
  );
  expect(withoutNames(jar)).not.toMatch(
    /private-cookie-value|datr_backup|DATR/,
  );
});

it("only identifies YouTube cookie names on the documented service's registrable domain", () => {
  const rows = [
    "youtube.com",
    ".www.youtube.com",
    "youtube.com.example.net",
    "youtube.com.private.example.com",
  ].flatMap((domain) =>
    ["YSC", "VISITOR_INFO1_LIVE"].map((name) => ({
      name,
      domain,
      value: "private",
      expires: -1,
      secure: true,
      httpOnly: false,
      sameSite: "Lax" as const,
    })),
  );
  const cookies = summarizeBrowserCookies(
    rows,
    new URL("https://example.com/"),
  );
  expect(cookies.recognized.map((c) => [c.name, c.site])).toEqual([
    ["YSC", "youtube.com"],
    ["VISITOR_INFO1_LIVE", "youtube.com"],
    ["YSC", "youtube.com"],
    ["VISITOR_INFO1_LIVE", "youtube.com"],
  ]);
  expect(cookies.unclassified?.map((g) => [g.site, g.count])).toEqual([
    ["example.net", 2],
    ["example.com", 2],
  ]);
});

it("recognizes exact SDK cookie conventions while omitting private and lookalike names", () => {
  const names = [
    "cw_conversation",
    "permutive-id",
    "cw_user_PRIVATE",
    "cw_conversation_extra",
    "permutive-id-old",
    "visitor_id",
  ];
  const summary = summarizeBrowserCookies(
    names.map((name) => ({
      name,
      value: "a-private-opaque-identifier",
      domain: "www.example.com",
      expires: 2_000_000_000,
      secure: true,
      httpOnly: false,
      sameSite: "Lax",
    })),
    new URL("https://www.example.com/"),
  );
  expect(summary.recognized.map(({ name }) => name)).toEqual([
    "Chatwoot conversation",
    "Permutive visitor ID",
  ]);
  expect(withoutNames(summary)).not.toMatch(
    /cw_|permutive-id|PRIVATE|private-opaque/,
  );
});

it("recognizes exact Google service cookie names only for google.com and drops their values", () => {
  const rows = [
    ".google.com",
    "accounts.google.com",
    "google.com.example.net",
    "google.co.uk",
  ].flatMap((domain) =>
    ["AEC", "SOCS", "NID", "nid", "__Secure-ENID", "other-account"].map(
      (name) => ({
        name,
        domain,
        value: "test-sensitive",
        expires: -1,
        secure: true,
        httpOnly: true,
        sameSite: "Lax" as const,
      }),
    ),
  );
  const jar = summarizeBrowserCookies(rows, new URL("https://example.org/"));
  expect(jar.recognized.map((c) => [c.name, c.site, c.scope])).toEqual(
    ["AEC", "SOCS", "NID", "AEC", "SOCS", "NID"].map((name) => [
      name,
      "google.com",
      "outside_site",
    ]),
  );
  expect(jar.inspected).toBe(rows.length);
  expect(withoutNames(jar)).not.toMatch(
    /test-sensitive|other-account|__Secure-ENID/,
  );
});

it("keeps masked names and a value description for every inspected cookie", () => {
  const cookies = summarizeBrowserCookies(
    [
      {
        name: "wp_woocommerce_session_8f3a9b2c1d",
        value: "a8f9c2e1b7d64f3a9e0c71d2",
        domain: "shop.example",
        expires: 2_000_000_000,
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "theme",
        value: "dark",
        domain: "shop.example",
        expires: -1,
        secure: false,
        httpOnly: false,
        sameSite: "Lax",
      },
    ],
    new URL("https://shop.example/"),
    1_700_000_000,
  );
  expect(cookies.named).toEqual([
    expect.objectContaining({
      name: "wp_woocommerce_session_*",
      persistent: true,
      value: { length: "medium", shape: "hex", identifierLike: true },
    }),
    expect.objectContaining({
      name: "theme",
      persistent: false,
      value: { length: "short", shape: "flag", identifierLike: false },
    }),
  ]);
  expect(JSON.stringify(cookies)).not.toMatch(/a8f9c2e1|8f3a9b2c1d|"dark"/);
});
