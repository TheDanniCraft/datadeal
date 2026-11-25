import { domain } from "@datadeal/contracts";
import { getDomain } from "tldts";
import { cleanDocumentQuery } from "./language";

export const privateText =
  /https?:\/\/|\b[^\s@]+@[^\s@]+\.[^\s@]+|\b[A-Za-z0-9_-]{48,}\b/;

/** Recognize a dedicated policy host under the site, excluding unrelated tenants. */
export function dedicatedDocumentHost(url: URL, homepage: URL) {
  const root = homepage.hostname.replace(/^www\./, "");
  const host = url.hostname;
  if (
    !["docs", "legal", "policies", "privacy", "trust"].some(
      (label) => host === label + "." + root,
    )
  )
    return false;
  const site = getDomain(root, { allowPrivateDomains: true });
  return Boolean(
    site && site === getDomain(host, { allowPrivateDomains: true }),
  );
}

export function publicDocumentUrl(raw: string, base: URL) {
  const url = URL.parse(raw, base);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !domain.safeParse(url.hostname).success ||
    /\.(?:localhost|local|internal)$/i.test(url.hostname) ||
    /\.(?:docx?|zip)$/i.test(url.pathname)
  )
    return;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return;
  }
  if (
    path.length > 600 ||
    privateText.test(path) ||
    /(?:^|\/)(?:api|admin|auth|account|login|logout|oauth|delete|confirm|activate|redirect|download)(?:\/|$)/i.test(
      path,
    )
  )
    return;
  const query = url.search;
  cleanDocumentQuery(url);
  if (query !== url.search) return;
  url.hash = "";
  return url;
}
