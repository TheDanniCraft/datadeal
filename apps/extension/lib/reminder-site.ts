import { parse } from "tldts";

// Built-in browser restrictions on content scripts. Enterprise policy may
// restrict additional sites, which the browser enforces at injection time.
const restrictedHosts = new Set(
  import.meta.env.FIREFOX
    ? [
        "accounts-static.cdn.mozilla.net",
        "accounts.firefox.com",
        "addons.cdn.mozilla.net",
        "addons.mozilla.org",
        "api.accounts.firefox.com",
        "content.cdn.mozilla.net",
        "discovery.addons.mozilla.org",
        "install.mozilla.org",
        "oauth.accounts.firefox.com",
        "profile.accounts.firefox.com",
        "support.mozilla.org",
        "sync.services.mozilla.com",
      ]
    : ["chrome.google.com", "chromewebstore.google.com"],
);

export function reminderSite(input: string | undefined) {
  if (!input || !URL.canParse(input)) return;
  const url = new URL(input);
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    host.includes("*") ||
    host.endsWith(".") ||
    restrictedHosts.has(host) ||
    host === "datadeal.app" ||
    host.endsWith(".datadeal.app")
  )
    return;
  const dns = parse(host, { allowPrivateDomains: true });
  if (dns.isIp || !dns.domain || (!dns.isIcann && !dns.isPrivate)) return;
  return {
    host,
    domain: dns.domain,
    pattern: url.origin + "/*",
    id: "form-reminder-" + host,
    preference: "formScore:" + host,
  };
}

// Browsers can also surface broader user-managed grants. Only an exact
// hostname permission corresponds to a DataDeal per-site opt-in.
export function exactReminderSites(origins: string[]) {
  return origins.flatMap((pattern) => {
    const site = reminderSite(pattern);
    return site?.pattern === pattern ? [site] : [];
  });
}
