import { z } from "zod";

export const storageInspectionLimit = 64;
export const googleCookieFamilies = ["SOCS", "AEC", "NID"] as const;
export function isGoogleCookieFamily(
  name: string,
): name is (typeof googleCookieFamilies)[number] {
  return googleCookieFamilies.some((family) => family === name);
}
export function isGoogleCookiePolicy(url?: string) {
  const source = url && URL.parse(url);
  return Boolean(
    source &&
    source.origin === "https://policies.google.com" &&
    source.pathname.replace(/\/$/, "") === "/technologies/cookies",
  );
}
export const knownCookieName = z.enum([
  "_ga",
  "_ga_*",
  "_gid",
  "_gcl_au",
  "_fbp",
  "_fbc",
  "OptanonConsent",
  "c15t",
  "euconsent-v2",
  "__cf_bm",
  "PHPSESSID",
  "Chatwoot conversation",
  "Permutive visitor ID",
  "YSC",
  "VISITOR_INFO1_LIVE",
  ...googleCookieFamilies,
  "datr",
  "sb",
]);

const count = z.number().int().nonnegative();
const inspected = count.max(storageInspectionLimit);
const cookieScope = z.enum(["same_site", "outside_site", "unknown"]);
const cookieSite = z
  .string()
  .max(253)
  .regex(/^[a-z0-9.-]+$/);
const cookieExpiry = z.enum([
  "within_day",
  "within_month",
  "within_year",
  "over_year",
]);
const unclassifiedCookieGroup = z
  .strictObject({
    scope: cookieScope,
    site: cookieSite.optional(),
    persistent: z.boolean(),
    expiry: cookieExpiry.optional(),
    count: inspected.min(1),
  })
  .refine((group) => group.persistent || !group.expiry);
const keyCategories = z.enum([
  "analytics",
  "advertising",
  "permutive_visitor_id",
  "consent",
  "c15t_key",
  "session",
  "security",
  "unclassified",
]);
const store = z
  .strictObject({
    total: count,
    inspected,
    categories: z.array(keyCategories).max(keyCategories.options.length),
  })
  .refine(
    ({ total, inspected, categories }) =>
      inspected <= total && categories.length <= inspected,
  );
export const webStorageSummary = z.strictObject({
  local: store,
  session: store,
});
export const browserStorageSnapshot = z.strictObject({
  cookies: z
    .strictObject({
      total: count,
      inspected,
      recognized: z
        .array(
          z.strictObject({
            name: knownCookieName,
            scope: cookieScope,
            site: cookieSite.optional(),
            expiry: cookieExpiry.optional(),
            persistent: z.boolean(),
            secure: z.boolean(),
            httpOnly: z.boolean(),
            sameSite: z.enum(["Lax", "Strict", "None"]),
            valueShape: z
              .enum(["analytics_client_format", "browser_ad_id_format"])
              .optional(),
          }),
        )
        .max(storageInspectionLimit),
      unclassified: z
        .array(unclassifiedCookieGroup)
        .max(storageInspectionLimit)
        .optional(),
    })
    .refine(
      ({ total, inspected, recognized, unclassified }) =>
        inspected <= total &&
        recognized.length <= inspected &&
        (!unclassified ||
          (recognized.length +
            unclassified.reduce((sum, group) => sum + group.count, 0) ===
            inspected &&
            new Set(
              unclassified.map((group) =>
                JSON.stringify([
                  group.scope,
                  group.site,
                  group.persistent,
                  group.expiry,
                ]),
              ),
            ).size === unclassified.length)),
    ),
  web: webStorageSummary.optional(),
});
export const browserStorageSummary = z.strictObject({
  beforeChoice: browserStorageSnapshot.optional(),
  end: browserStorageSnapshot,
});
export type BrowserStorageSnapshot = z.infer<typeof browserStorageSnapshot>;
