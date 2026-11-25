import {
  contentPageLimit,
  maxContentPages,
  type ScanReport,
} from "@datadeal/contracts";
import type { CheerioAPI } from "cheerio";

const defaultPageLimit = 3;

export function configuredContentPageLimit(value?: string) {
  if (value === undefined) return defaultPageLimit;
  const parsed = contentPageLimit.safeParse(Number(value));
  if (!/^[1-9]\d*$/.test(value) || !parsed.success)
    throw new Error(
      `CONTENT_PAGE_LIMIT must be a whole number between 1 and ${maxContentPages}`,
    );
  return parsed.data;
}
const excludedSegment =
  /(?:^|[\s/_.-])(?:admin|api|auth|login|logout|sign[-_]?in|sign[-_]?up|account|password|token|register|unsubscribe|abmelden|anmelden|checkout|cart|warenkorb|kaufen|purchase|delete|remove|confirm|activate|oauth|reset|export|download|redirect|privacy|datenschutz|impressum|legal|terms|cookie[-_]?policy|dpa|avv|data[-_]?processing[-_]?(?:agreement|addendum)|sub[-_]?processors?|auftragsverarbeitungsvertrag|unterauftragsverarbeiter|sitemap)(?:$|[\s/_.-])/i;

type PageSample = NonNullable<ScanReport["pageSample"]>;

export function contentPageSample(
  homepage: URL,
  page: CheerioAPI,
  sitemapUrls: readonly string[],
  discoveryLimited: boolean,
  pageLimit = defaultPageLimit,
): PageSample {
  contentPageLimit.parse(pageLimit);
  const candidates = new Map<
    string,
    { source: "sitemap" | "homepage_link"; priority: number; group: string }
  >();
  function add(
    raw: string,
    source: "sitemap" | "homepage_link",
    featured: boolean,
  ) {
    if (!raw || raw.startsWith("#") || raw.length > 1200) return;
    const url = URL.parse(raw, homepage);
    if (
      !url ||
      url.origin !== homepage.origin ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.pathname === homepage.pathname ||
      /[%](?:2f|5c|25)/i.test(url.pathname)
    )
      return;
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return;
    }
    if (
      excludedSegment.test(path) ||
      /[@\\;=:\x00-\x1f]/.test(path) ||
      (/\.[\w-]{1,8}\/?$/i.test(path) && !/\.html?\/?$/i.test(path))
    )
      return;
    url.hash = "";
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) return;
    const slug = parts.at(-1)!;
    const article = /[-_].*[-_].*[-_]/.test(slug) || /\.html?$/i.test(slug);
    const prev = candidates.get(url.href);
    const fromSitemap = source === "sitemap" || prev?.source === "sitemap";
    const priority =
      3 * Number(featured) +
      5 * Number(article) +
      2 * Number(parts.length > 1) +
      4 * Number(fromSitemap) -
      3 * Number(/\/(?:video|mediathek|gallery|galerie)\//i.test(path));
    candidates.set(url.href, {
      source: prev?.source === "sitemap" ? "sitemap" : source,
      priority: Math.max(prev?.priority ?? 0, priority),
      group: parts[0],
    });
  }
  for (const url of sitemapUrls) add(url, "sitemap", false);
  for (const anchor of page("a[href]").toArray()) {
    const item = page(anchor);
    if (
      item.is("[download], [rel~='nofollow']") ||
      item.closest("[hidden], [aria-hidden='true']").length
    )
      continue;
    add(
      item.attr("href")!.trim(),
      "homepage_link",
      Boolean(item.closest("article").length),
    );
  }
  const ranked = [...candidates].sort((a, b) => b[1].priority - a[1].priority);
  const selected = new Set<string>();
  const groups = new Set<string>();
  for (const [url, item] of ranked) {
    if (groups.has(item.group)) continue;
    selected.add(url);
    groups.add(item.group);
    if (selected.size === pageLimit) break;
  }
  for (const [url] of ranked) {
    if (selected.size === pageLimit) break;
    selected.add(url);
  }
  return {
    discovered: candidates.size,
    discoveryLimited,
    limit: pageLimit,
    pages: [...selected].map((url) => ({
      url,
      source: candidates.get(url)!.source,
      coverage: {
        default: "untested",
        rejected: "untested",
        accepted: "untested",
      },
    })),
  };
}
