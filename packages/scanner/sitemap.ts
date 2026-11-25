import { load, type CheerioAPI } from "cheerio";
import { cleanDocumentQuery } from "./language";
import {
  dedicatedDocumentHost,
  publicDocumentUrl,
} from "./public-document-url";

const privacyPath =
  /^(?:privacy(?:[-_]?(?:policy|notice|statement))?|datenschutz(?:[-_]?(?:erkl(?:ä|ae|a)rung|hinweise))?)$/i;
const legalPath =
  /^(?:cookies?(?:[-_](?:policy|notice))?|terms(?:[-_]of[-_](?:service|use))?|impressum)$/i;
const documentSection = /(?:legal|policy|policies|pages)/i;
const hubLabel =
  /^(?:legal(?: information| notices?| cent(?:er|re)| hub)?|legal\s*(?:&|and)\s*privacy|privacy (?:cent(?:er|re)|hub)|rechtliches|rechtliche (?:hinweise|informationen)|datenschutzcenter)$/i;
const otherLabel =
  /^(?:cookie policy|cookie notice|terms(?: of (?:service|use))?|impressum)$/i;
const possiblePolicy =
  /privac|personal[-_\s]+(?:information|data)|data[-_\s]+(?:protection|practices)|datenschutz|personenbezogen|confidentialit|privacidad/i;
function withoutFileLabel(text: string) {
  return text
    .replace(/\s*\(PDF(?:\s*[,·–-]\s*\d+(?:[.,]\d+)?\s*[KM]B)?\)\s*$/i, "")
    .trim();
}
export function processingDocumentKind(text: string) {
  const label = withoutFileLabel(text)
    .replace(/[-_‐‑–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(?:(?:our|list of|liste der|unsere) )?(?:sub ?processors?|unterauftragsverarbeiter|unterauftragnehmer)(?: list| liste)?$/i.test(
      label,
    )
  )
    return "subprocessors" as const;
  if (
    /^(?:(?:our|unser) )?(?:data processing (?:agreement|addendum|terms)|auftragsverarbeitungsvertrag|vertrag (?:zur|über die) auftragsverarbeitung|dpa|avv)(?:\s*\((?:dpa|avv)\))?$/i.test(
      label,
    )
  )
    return "dpa" as const;
}
export type DocumentKind =
  "privacy" | "other" | "hub" | "candidate" | "dpa" | "subprocessors";
export type DocumentLink = { url: string; label: string; kind: DocumentKind };
const privacyLabel =
  /(?:privacy(?: policy| notice| statement)?|datenschutz(?:erklärung|hinweise|richtlinie)?)/i;
const cookieLabel = /(?:cookies?|cookie policy|cookie-richtlinie)/i;
const labelJoin = /\s*(?:and|und|&|\/)\s*/i;
const privacyLink = new RegExp(
  `^(?:${privacyLabel.source}(?:${labelJoin.source}${cookieLabel.source})?|${cookieLabel.source}${labelJoin.source}${privacyLabel.source})$`,
  "i",
);

export function isPrivacyLinkLabel(text: string) {
  return privacyLink.test(withoutFileLabel(text));
}

export function isPrivacyHeading(text: string) {
  return /(?:^|[\s|:–—-])(?:privacy policy|privacy notice|privacy statement|privacy (?:and|&) cookies|datenschutzerklärung|datenschutzrichtlinie|datenschutzhinweise|datenschutz)(?:$|[\s|:–—-])/i.test(
    text.trim(),
  );
}

function documentLink(
  raw: string,
  base: URL,
  labels: string[],
  fromHomepage = false,
): DocumentLink | undefined {
  if (!raw || raw.startsWith("#")) return;
  const url = URL.parse(raw, base);
  if (!url || url.username || url.password) return;
  const dedicated = url.origin !== base.origin;
  if (
    dedicated &&
    (!fromHomepage ||
      !dedicatedDocumentHost(url, base) ||
      !publicDocumentUrl(raw, base))
  )
    return;
  const originalQuery = url.search;
  cleanDocumentQuery(url);
  url.hash = "";
  const part = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  let slug: string;
  try {
    slug = decodeURIComponent(part).replace(/\.(?:html?|pdf)$/i, "");
  } catch {
    return;
  }
  const label = labels.find(Boolean) ?? slug;
  const segments = [...labels, slug.replace(/[-_]+/g, " ")];
  let kind: DocumentKind;
  if (
    segments.some((text) =>
      /\b(?:settings|preferences|einstellungen|news|blog)\b/i.test(text),
    )
  )
    return;
  const processing = segments.map(processingDocumentKind).find(Boolean);
  if (processing && url.search !== originalQuery) return;
  if (processing) kind = processing;
  else if (labels.some(isPrivacyLinkLabel)) kind = "privacy";
  else if (segments.some((text) => hubLabel.test(text))) kind = "hub";
  else if (
    privacyPath.test(slug) &&
    (!labels.length ||
      labels.some((label) =>
        /^(?:read more|learn more|mehr erfahren)$/i.test(label),
      ))
  )
    kind = "privacy";
  else if (
    labels.some((text) => otherLabel.test(text)) ||
    (!labels.length && legalPath.test(slug))
  )
    kind = "other";
  else if (segments.some((text) => possiblePolicy.test(text)))
    kind = "candidate";
  else return;
  // Crossing origins needs an explicit, unambiguous publisher link. A sitemap,
  // guessed slug, or AI-nominated link alone does not establish attribution.
  if (
    dedicated &&
    !(
      (kind === "privacy" && labels.some(isPrivacyLinkLabel)) ||
      ((kind === "dpa" || kind === "subprocessors") &&
        labels.some((label) => processingDocumentKind(label) === kind))
    )
  )
    return;
  return { url: url.href, label: label.slice(0, 160), kind };
}

export function linkedDocuments(
  $: CheerioAPI,
  base: URL,
  fromHomepage = false,
) {
  const found: DocumentLink[] = [];
  for (const element of $("a[href]").toArray()) {
    const anchor = $(element);
    const text = anchor.text().trim();
    const labels = [
      text || anchor.find("img[alt]").first().attr("alt"),
      anchor.attr("aria-label"),
      anchor.attr("title"),
    ]
      .map((text) => text?.replace(/\s+/g, " ").trim() ?? "")
      .filter(Boolean);
    const link = documentLink(
      anchor.attr("href")?.trim() ?? "",
      base,
      labels,
      fromHomepage,
    );
    if (link) found.push(link);
  }
  return found;
}

export async function discoverSitemap(
  homepage: URL,
  fetchText: (url: URL, format: "xml" | "text") => Promise<string>,
) {
  const candidates = new Map<string, DocumentLink>();
  const contentUrls = new Set<string>();
  let discoveryLimited = false;
  const seen = new Set<string>();
  const sameOrigin = (value: string) => {
    const url = URL.parse(value.trim(), homepage);
    if (!url || url.origin !== homepage.origin || url.username || url.password)
      return undefined;
    url.hash = "";
    cleanDocumentQuery(url);
    return url;
  };
  const read = (url: URL, format: "xml" | "text") =>
    fetchText(url, format).catch(() => "");
  const defaultMap = new URL("/sitemap.xml", homepage);
  const [robots, defaultXML] = await Promise.all([
    read(new URL("/robots.txt", homepage), "text"),
    read(defaultMap, "xml"),
  ]);
  const declaredMaps = Array.from(
    robots.matchAll(/^\s*sitemap:\s*(\S+)/gim),
    ([, value]) => sameOrigin(value),
  ).filter((url): url is URL => Boolean(url) && url?.href !== defaultMap.href);
  const declared = declaredMaps.slice(0, 2);
  if (declared.length < declaredMaps.length) discoveryLimited = true;

  function collect(xml: string) {
    const $ = load(xml, { xml: true });
    for (const node of $("urlset > url > loc").toArray()) {
      const raw = $(node).text().trim();
      const url = sameOrigin(raw);
      if (!url) continue;
      // Keep the original URL for the content-page filter, including its query.
      contentUrls.add(raw);
      const link = documentLink(raw, homepage, []);
      if (
        link &&
        (candidates.size < 30 ||
          (link.kind === "privacy" && candidates.size < 40))
      )
        candidates.set(url.href, link);
    }
    return $("sitemapindex > sitemap > loc")
      .toArray()
      .map((node) => sameOrigin($(node).text()))
      .filter((url): url is URL => url !== undefined);
  }

  seen.add(defaultMap.href);
  const children = collect(defaultXML);
  const explicitXML = await Promise.all(
    declared.map(async (url) => {
      if (seen.has(url.href)) return "";
      seen.add(url.href);
      return read(url, "xml");
    }),
  );
  const explicit = explicitXML.flatMap(collect);
  const childMaps = [...children, ...explicit.flat()]
    .sort(
      (a, b) =>
        Number(documentSection.test(b.pathname)) -
        Number(documentSection.test(a.pathname)),
    )
    .filter((url) => !seen.has(url.href) && Boolean(seen.add(url.href)));
  const next = childMaps.slice(0, 3);
  if (next.length < childMaps.length) discoveryLimited = true;
  const nested = await Promise.all(next.map((url) => read(url, "xml")));
  for (const xml of nested) {
    if (collect(xml).some((url) => !seen.has(url.href)))
      discoveryLimited = true;
  }
  const readableMap = (xml: string) =>
    /<(?:urlset|sitemapindex)(?:\s|>)/i.test(xml);
  if (
    ![defaultXML, ...explicitXML].some(readableMap) ||
    [...explicitXML, ...nested].some((xml) => !readableMap(xml))
  )
    discoveryLimited = true;
  return {
    documents: [...candidates.values()],
    contentUrls: [...contentUrls],
    discoveryLimited,
  };
}
