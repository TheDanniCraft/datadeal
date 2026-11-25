import { getDomain } from "tldts";
import {
  describeStorageValue,
  maskStorageName,
  knownCookieName,
  isGoogleCookieFamily,
  storageInspectionLimit,
  webStorageSummary,
  type BrowserStorageSnapshot,
} from "@datadeal/contracts";

export {
  storageInspectionLimit,
  webStorageSummary,
  type BrowserStorageSnapshot,
};
type RecognizedCookie = BrowserStorageSnapshot["cookies"]["recognized"][number];
type UnclassifiedGroup = NonNullable<
  BrowserStorageSnapshot["cookies"]["unclassified"]
>[number];
type BrowserCookie = Pick<
  RecognizedCookie,
  "secure" | "httpOnly" | "sameSite"
> & {
  name: string;
  value: string;
  domain: string;
  expires: number;
};

export function summarizeBrowserCookies(
  cookies: BrowserCookie[],
  homepage: URL,
  now = Date.now() / 1000,
): BrowserStorageSnapshot["cookies"] {
  const site = getDomain(homepage.hostname, { allowPrivateDomains: true });
  const inspected = Math.min(cookies.length, storageInspectionLimit);
  const recognized: RecognizedCookie[] = [];
  const named: NonNullable<BrowserStorageSnapshot["cookies"]["named"]> = [];
  const unclassified = new Map<string, UnclassifiedGroup>();
  for (const cookie of cookies.slice(0, inspected)) {
    // Never retain installation-specific suffixes, unknown names or cookie values.
    // These display names represent documented conventions, never observed free text.
    let family = [
      "_ga_*",
      "Chatwoot conversation",
      "Permutive visitor ID",
    ].includes(cookie.name)
      ? ""
      : cookie.name;
    if (/^_ga_[A-Z0-9]{4,24}$/.test(family)) family = "_ga_*";
    if (family === "cw_conversation") family = "Chatwoot conversation";
    if (family === "permutive-id") family = "Permutive visitor ID";
    const hostname = cookie.domain.replace(/^\./, "").toLowerCase();
    // The default c15t choice cookie must be available to this origin. A
    // similarly named third-party or sibling-only cookie has no such meaning.
    if (
      family === "c15t" &&
      (cookie.httpOnly ||
        (hostname !== homepage.hostname &&
          !(
            cookie.domain.startsWith(".") &&
            homepage.hostname.endsWith("." + hostname)
          )))
    )
      family = "";
    const cookieSite = getDomain(hostname, { allowPrivateDomains: true });
    // These service-owned names are ambiguous on any other registrable site.
    if (
      (family === "YSC" || family === "VISITOR_INFO1_LIVE") &&
      cookieSite !== "youtube.com"
    )
      family = "";
    if (isGoogleCookieFamily(family) && cookieSite !== "google.com")
      family = "";
    if ((family === "datr" || family === "sb") && cookieSite !== "facebook.com")
      family = "";
    const name = knownCookieName.safeParse(family);
    const sameSite =
      hostname === homepage.hostname || Boolean(site && site === cookieSite);
    const descriptor: Omit<UnclassifiedGroup, "count"> = {
      ...(cookieSite && { site: cookieSite }),
      ...(cookie.expires > now && {
        expiry:
          cookie.expires - now <= 86400
            ? "within_day"
            : cookie.expires - now <= 30 * 86400
              ? "within_month"
              : cookie.expires - now <= 365 * 86400
                ? "within_year"
                : "over_year",
      }),
      scope: sameSite
        ? "same_site"
        : site && cookieSite
          ? "outside_site"
          : "unknown",
      persistent: cookie.expires > 0,
    };
    named.push({
      name: maskStorageName(cookie.name),
      ...descriptor,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      // Only a coarse description of the value leaves this function.
      value: describeStorageValue(cookie.value),
    });
    if (!name.success) {
      const key = JSON.stringify(descriptor);
      const group = unclassified.get(key);
      if (group) group.count++;
      else unclassified.set(key, { ...descriptor, count: 1 });
      continue;
    }
    const entry: RecognizedCookie = {
      name: name.data,
      ...descriptor,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
    };
    if (
      name.data === "_ga" &&
      /^GA[12]\.\d{1,2}\.\d{1,12}\.\d{1,12}$/.test(cookie.value)
    )
      entry.valueShape = "analytics_client_format";
    if (
      name.data === "_fbp" &&
      /^fb\.\d{1,2}\.\d{13}\.\d{1,20}$/.test(cookie.value)
    )
      entry.valueShape = "browser_ad_id_format";
    recognized.push(entry);
  }
  return {
    total: cookies.length,
    inspected,
    recognized,
    unclassified: [...unclassified.values()],
    named,
  };
}

export type WebStorageSample = { key: string; value: string };
export type WebStorageInspection = {
  summary: BrowserStorageSnapshot["web"];
  samples?: { local: WebStorageSample[]; session: WebStorageSample[] };
};

/**
 * Converts the in-page samples into masked names and value descriptions.
 * Raw values stay in worker memory and are never returned or stored.
 */
export function describeWebStorage(
  inspection: WebStorageInspection | undefined,
): BrowserStorageSnapshot["web"] {
  const summary = inspection?.summary;
  if (!summary) return;
  const describe = (rows: WebStorageSample[] = []) =>
    rows.slice(0, storageInspectionLimit).map(({ key, value }) => ({
      name: maskStorageName(key),
      value: describeStorageValue(value),
    }));
  return {
    local: { ...summary.local, keys: describe(inspection.samples?.local) },
    session: {
      ...summary.session,
      keys: describe(inspection.samples?.session),
    },
  };
}

// Executed in the top-level page. Values are truncated and returned only to
// the worker, which reduces them to coarse descriptions.
export function inspectWebStorage({
  expectedOrigin,
  limit,
}: {
  expectedOrigin: string;
  limit: number;
}): WebStorageInspection | undefined {
  if (location.origin !== expectedOrigin) return;
  try {
    const stores = [];
    const samples: { key: string; value: string }[][] = [];
    for (const storage of [window.localStorage, window.sessionStorage]) {
      const total = storage.length;
      const inspected = Math.min(limit, total);
      const categories = new Set<
        NonNullable<
          BrowserStorageSnapshot["web"]
        >["local"]["categories"][number]
      >();
      const rows: { key: string; value: string }[] = [];
      for (let i = 0; i < inspected; i++) {
        const key = storage.key(i);
        if (!key) continue;
        rows.push({
          key: key.slice(0, 200),
          value: (storage.getItem(key) ?? "").slice(0, 512),
        });
        // Default Google Conversion Linker and Mixpanel SDK persistence keys.
        if (key === "permutive-id" && storage === window.localStorage)
          categories.add("permutive_visitor_id");
        else if (key === "c15t" && storage === window.localStorage)
          categories.add("c15t_key");
        else if (key === "permutive-consent") categories.add("consent");
        else if (key === "permutive-session") categories.add("session");
        else if (key === "_gcl_ls") categories.add("advertising");
        else if (/^mp_[a-f\d]{32}_mixpanel$/i.test(key))
          categories.add("analytics");
        else if (key === "euconsent-v2" || key === "IABTCF_TCString")
          categories.add("consent");
        else categories.add("unclassified");
      }
      stores.push({ total, inspected, categories: [...categories].sort() });
      samples.push(rows);
    }
    return {
      summary: { local: stores[0], session: stores[1] },
      samples: { local: samples[0], session: samples[1] },
    };
  } catch {
    return;
  }
}
