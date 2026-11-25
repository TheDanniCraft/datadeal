import type { Cheerio, CheerioAPI } from "cheerio";
import { publicDocumentUrl } from "./public-document-url";
type Element = ReturnType<ReturnType<CheerioAPI["root"]>["find"]>[number];

const advertising = /advertis|\bads\b|marketing|werb|vermarkt/iu;
const namesList =
  /(?:following|listed below|listed here|below are).{0,100}(?:partners?|providers?|vendors?|recipients?|third parties)|(?:partners?|providers?|vendors?|recipients?).{0,100}(?:below|following)|(?:nachfolgend|folgend|unten|anschließend).{0,80}(?:dritte[rn]?|partner|anbieter|empfänger)/iu;
const manager =
  /privacy[- ]manager|vendor (?:directory|list)|list of (?:our )?(?:ad(?:vertising)? )?(?:partners|vendors)|partnerliste|anbieterliste|liste der drittanbieter/iu;
const conditional =
  /(?:\bif\b|when|consent|if you|einwillig|zustimm|wenn sie)/iu;
const publicText = (value: string) =>
  !/\b[^\s@]+@[^\s@]+\.[^\s@]+|\b[A-Za-z0-9_-]{48,}\b/.test(value);
const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
export type AdvertisingList = {
  context: string;
  entries: { excerpt: string; url: string }[];
};
export type DirectoryLink = { excerpt: string; url: string };

function disclosureUrl(raw: string, base: URL) {
  const url = publicDocumentUrl(raw, base);
  if (
    !url ||
    url.search ||
    /[\s\\"<>]/u.test(decodeURIComponent(url.pathname)) ||
    url.href.length > 400
  )
    return;
  return url;
}

export function advertisingReferrals(
  $: CheerioAPI,
  nodes: Cheerio<Element>,
  heading: string,
  base: URL,
) {
  const lists: AdvertisingList[] = [],
    directories: DirectoryLink[] = [];
  const inSection = new Set(nodes.toArray());
  for (const node of nodes.filter("ul,ol").add(nodes.find("ul,ol")).toArray()) {
    if (lists.length >= 2) break;
    const list = $(node);
    if (list.parents("li,nav,footer,header,form,aside").length) continue;
    const intro = list.prev("p");
    if (!intro.length || (inSection.has(node) && !inSection.has(intro[0])))
      continue;
    const lead = clean(intro.text());
    if (!namesList.test(lead) || lead.length < 24 || lead.length > 1300)
      continue;
    const previous = intro.prev("p");
    const before = clean(previous.text());
    const includeBefore =
      (!inSection.has(node) || inSection.has(previous[0])) &&
      previous.length > 0 &&
      advertising.test(before) &&
      conditional.test(before) &&
      before.length <= 900;
    const context = includeBefore ? before + " " + lead : lead;
    if (
      !advertising.test(heading + " " + context) ||
      !publicText(context) ||
      context.length > 1800 ||
      /\b(?:do not|never|no longer|exclude[ds]?|examples? only|kein(?:e|en|er)? zusammenarbeit|nicht (?:mehr )?(?:nutzen|verwenden)|nur beispiele)\b/iu.test(
        context,
      )
    )
      continue;
    const entries: AdvertisingList["entries"] = [];
    for (const item of list.children("li").toArray().slice(0, 24)) {
      const entry = $(item),
        links = entry.find("a[href]");
      if (links.length !== 1 || entry.find("ul,ol,form").length) continue;
      const href = links.attr("href");
      if (!href || /^(?:javascript|file|data):/i.test(href)) continue;
      const url = disclosureUrl(href, base);
      const excerpt = clean(entry.text());
      const name = entry.clone();
      name.find("a").remove();
      // A naked policy URL or a navigation listing cannot identify a recipient.
      const anchorText = clean(links.text());
      const visibleName =
        clean(name.text()) ||
        (!/privacy|datenschutz|^https?:|click here|^hier$/i.test(anchorText)
          ? anchorText
          : "");
      if (
        !url ||
        url.origin === base.origin ||
        visibleName.length < 2 ||
        !publicText(excerpt) ||
        excerpt.length > 520
      )
        continue;
      entries.push({ excerpt, url: url.href });
      if (entries.length === 16) break;
    }
    if (entries.length) lists.push({ context, entries });
  }
  for (const anchor of nodes
    .filter("a[href]")
    .add(nodes.find("a[href]"))
    .toArray()) {
    const link = $(anchor),
      paragraph = link.closest("p,li,dd");
    const excerpt = clean(paragraph.text());
    if (
      link.parents("nav,header,footer,aside,form").length ||
      !manager.test(clean(link.text())) ||
      excerpt.length < 25 ||
      excerpt.length > 700 ||
      !publicText(excerpt) ||
      !/(third.part|vendor|provider|partner|advertis|empfänger|drittanbieter|werb)/iu.test(
        heading + " " + excerpt,
      )
    )
      continue;
    const url = disclosureUrl(link.attr("href") ?? "", base);
    if (
      url?.origin === base.origin &&
      url.href !== base.href &&
      !directories.some((x) => x.url === url.href)
    )
      directories.push({ excerpt, url: url.href });
    if (directories.length >= 2) break;
  }
  return { lists, directories };
}
