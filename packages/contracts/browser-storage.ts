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

// Names are public to every visitor; values can identify a person. DataDeal
// keeps a masked name and a coarse description of the value, never the value.
export const storageNamePattern = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[\w.\-:$@|*~+]+$/);
export const storageValueSignal = z.strictObject({
  length: z.enum(["empty", "short", "medium", "long"]),
  shape: z.enum([
    "flag",
    "number",
    "timestamp",
    "uuid",
    "hex",
    "base64",
    "jwt",
    "json",
    "url",
    "text",
    "other",
  ]),
  identifierLike: z.boolean(),
});
export type StorageValueSignal = z.infer<typeof storageValueSignal>;
const flagWords =
  /^(?:true|false|yes|no|on|off|0|1|-1|null|undefined|dark|light|system|auto|accepted?|denied|granted|rejected?|all|none|necessary|essential|de|en|fr|es|it|nl|pl|de-de|en-us|en-gb)$/i;

/** Replaces installation- or visitor-specific runs inside a storage name. */
export function maskStorageName(name: string): string {
  const masked = name
    .replace(
      /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi,
      "*",
    )
    .replace(/[A-Za-z0-9]{16,}/g, (run) =>
      /\d/.test(run) && /[A-Za-z]/.test(run) ? "*" : run,
    )
    .replace(/[0-9a-f]{8,}/gi, (run) => (/\d/.test(run) ? "*" : run))
    .replace(/\d{5,}/g, "*")
    .replace(/[^\w.\-:$@|*~+]/g, "~")
    .replace(/\*{2,}/g, "*")
    .slice(0, 80);
  return masked || "~";
}

function entropy(text: string) {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Describes a cookie or storage value without retaining any of it. */
export function describeStorageValue(raw: string): StorageValueSignal {
  let value = raw.trim();
  try {
    if (/%[0-9a-f]{2}/i.test(value)) value = decodeURIComponent(value);
  } catch {
    // Keep the original text when it is not valid percent-encoding.
  }
  value = value.replace(/^"(.*)"$/s, "$1");
  const length =
    value.length === 0
      ? "empty"
      : value.length <= 8
        ? "short"
        : value.length <= 32
          ? "medium"
          : "long";
  const shape: StorageValueSignal["shape"] = !value
    ? "other"
    : flagWords.test(value)
      ? "flag"
      : /^\d{10}(?:\d{3})?$/.test(value)
        ? "timestamp"
        : /^-?\d+(?:\.\d+)?$/.test(value)
          ? "number"
          : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                value,
              )
            ? "uuid"
            : /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(value)
              ? "jwt"
              : /^[[{]/.test(value)
                ? "json"
                : /^https?:\/\//i.test(value)
                  ? "url"
                  : /^[0-9a-f]+$/i.test(value)
                    ? "hex"
                    : /^[A-Za-z0-9+/_-]+={0,2}$/.test(value)
                      ? "base64"
                      : /^[\p{L} ,.'-]+$/u.test(value)
                        ? "text"
                        : "other";
  // A long random-looking token is the typical shape of a visitor ID. Short
  // values, plain words and timestamps usually store a preference or a time.
  const tokens = value.match(/[A-Za-z0-9_-]{16,}/g) ?? [];
  const digitRuns = value.match(/\d{8,}/g) ?? [];
  const identifierLike =
    shape === "uuid" ||
    // e.g. GA1.1.<random>.<first-seen time> or fb.1.<time>.<random>
    (digitRuns.length >= 2 && shape !== "json") ||
    shape === "jwt" ||
    tokens.some((token) => /\d/.test(token) && entropy(token) >= 3.2) ||
    (shape === "json" &&
      /"(?:[a-z_]*id|uid|user|visitor|device|client)"\s*:\s*"[^"]{12,}"/i.test(
        value,
      ));
  return { length, shape, identifierLike };
}
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
const storageKey = z.strictObject({
  name: storageNamePattern,
  value: storageValueSignal,
});
const store = z
  .strictObject({
    total: count,
    inspected,
    categories: z.array(keyCategories).max(keyCategories.options.length),
    keys: z.array(storageKey).max(storageInspectionLimit).optional(),
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
      // Every inspected cookie by masked name, including recognized ones.
      named: z
        .array(
          z.strictObject({
            name: storageNamePattern,
            scope: cookieScope,
            site: cookieSite.optional(),
            expiry: cookieExpiry.optional(),
            persistent: z.boolean(),
            secure: z.boolean(),
            httpOnly: z.boolean(),
            sameSite: z.enum(["Lax", "Strict", "None"]),
            value: storageValueSignal,
          }),
        )
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
