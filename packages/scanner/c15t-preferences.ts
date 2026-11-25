import type { CheerioAPI } from "cheerio";
import { getDomainWithoutSuffix } from "tldts";

// Match a single inventory entry. A generic mention of the consent platform
// elsewhere on a policy page cannot explain an observed browser item.
export function c15tPreferenceSection(page: CheerioAPI, url: URL) {
  const site = getDomainWithoutSuffix(url.hostname, {
    allowPrivateDomains: true,
  });
  if (!site) return;
  for (const node of page("main dl,article dl,[role=main] dl")
    .toArray()
    .slice(0, 32)) {
    const list = page(node);
    if (
      list.parents("nav,footer,aside,[hidden],template").length ||
      list.find("dl,script,form,[hidden]").length
    )
      continue;
    const fields = new Map<string, string>();
    const words: string[] = [];
    for (const item of list.find("dt").toArray()) {
      const term = page(item);
      const title = term.text().trim();
      const value = term.next("dd").text().replace(/\s+/gu, " ").trim();
      if (!value || fields.has(title.toLowerCase())) {
        fields.clear();
        break;
      }
      fields.set(title.toLowerCase(), value);
      words.push(title, value);
    }
    const excerpt = words.join(" ");
    if (excerpt.replace(/\s/gu, "") !== list.text().replace(/\s/gu, ""))
      continue;
    const provider = fields
      .get("provider")
      ?.toLowerCase()
      .split(/\s*[/,&+]\s*/);
    if (
      provider?.length !== 2 ||
      !provider.includes("c15t") ||
      !provider.includes(site.toLowerCase()) ||
      !/^first[- ]party cookies? and local\s?storage\.?$/i.test(
        fields.get("storage") ?? "",
      ) ||
      !/^(?:(?:apply|store|save) and )?remember (?:your|the visitor[’']s) (?:privacy|consent|cookie) (?:choices|preferences)\.?$/i.test(
        fields.get("purpose") ?? "",
      ) ||
      excerpt.length > 500 ||
      /https?:\/\/|[^\s@]+@[^\s@]+|[\w-]{48,}/u.test(excerpt)
    )
      continue;
    return { heading: "Privacy preferences", excerpt };
  }
}
