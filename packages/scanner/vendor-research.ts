import type { CheerioAPI } from "cheerio";

const relevant =
  /cookie|local ?storage|session ?storage|identifier|kennung|tracking|analytics|analyse|advertis|werb|pixel|retention|speicherdauer|conversation|chat|widget|embed/i;
const blocks = "h1,h2,h3,h4,p,li,td,dt,dd";

/**
 * Picks short passages from a vendor's privacy or cookie page that can explain
 * storage items or data a recipient receives. Text is untrusted and is only
 * ever passed to the analyst as quoted source material.
 */
export function vendorPassages($: CheerioAPI, limit = 6) {
  $("script,style,noscript,nav,footer,header,form,svg").remove();
  const passages: { heading: string; excerpt: string }[] = [];
  let heading = "";
  for (const node of $(blocks).toArray()) {
    const tag = (node as { tagName?: string }).tagName?.toLowerCase() ?? "";
    const text = $(node).text().replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (/^h[1-4]$/.test(tag)) {
      heading = text.slice(0, 140);
      continue;
    }
    if (text.length < 40 || !relevant.test(text + " " + heading)) continue;
    if (passages.some((p) => p.excerpt === text.slice(0, 600))) continue;
    passages.push({
      heading: heading || "Policy",
      excerpt: text.slice(0, 600),
    });
    if (passages.length >= limit) break;
  }
  return passages;
}

export function vendorPolicyLinks($: CheerioAPI, base: URL) {
  const found = new Set<string>();
  for (const anchor of $("a[href]").toArray()) {
    const label = $(anchor).text().replace(/\s+/g, " ").trim();
    const href = $(anchor).attr("href") ?? "";
    if (
      !/privacy|datenschutz|cookie/i.test(label + " " + href) ||
      /login|signup|account/i.test(href)
    )
      continue;
    const url = URL.parse(href, base);
    if (!url || url.origin !== base.origin || url.search || url.username)
      continue;
    url.hash = "";
    found.add(url.href);
    if (found.size >= 2) break;
  }
  return [...found].map((href) => new URL(href));
}
