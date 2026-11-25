import type { CheerioAPI } from "cheerio";

// Language only. A country-specific locale can switch the applicable legal terms.
export const scanLanguage = "en";
const languageKey = /^(?:hl|lang|language|locale)$/i;
const regionKey = /^(?:country|region|jurisdiction)$/i;
const languageTag = /^[a-z]{2,3}(?:[-_][a-z\d]{2,8})?$/i;

export function cleanDocumentQuery(url: URL) {
  for (const [key, value] of [...url.searchParams]) {
    if (
      !(languageKey.test(key) && languageTag.test(value)) &&
      !(regionKey.test(key) && /^[a-z]{2,3}$/i.test(value))
    ) {
      url.searchParams.delete(key);
    }
  }
}

export function pageLanguage(page: CheerioAPI) {
  return (page("html").attr("lang") ?? "")
    .trim()
    .toLowerCase()
    .replace("_", "-");
}

function policyPath(url: URL, lang: string) {
  const parts = url.pathname.toLowerCase().split("/").filter(Boolean);
  const language = lang.split("-")[0];
  return parts
    .map((part) => {
      if (part === language) return "";
      if (
        language &&
        part.startsWith(language + "-") &&
        /^[a-z]{2,3}-[a-z]{2}$/i.test(part)
      )
        return part.split("-")[1];
      if (
        /^(?:datenschutz(?:erklärung|erklaerung|richtlinie)?|privacy(?:[-_](?:policy|notice|statement))?)(?:\.html?)?$/i.test(
          part,
        )
      )
        return "privacy";
      return part;
    })
    .filter(Boolean)
    .join("/");
}

export function samePolicyLocale(from: URL, to: URL, originalLanguage: string) {
  if (
    to.origin !== from.origin ||
    to.username ||
    to.password ||
    to.protocol !== "https:"
  )
    return false;
  const safe = new URL(to);
  cleanDocumentQuery(safe);
  if ([...to.searchParams].length !== [...safe.searchParams].length)
    return false;
  for (const [key, value] of to.searchParams) {
    if (languageKey.test(key)) {
      const lang = value.toLowerCase().replace("_", "-");
      const region = originalLanguage.split("-")[1];
      if (lang !== "en" && !(region && lang === "en-" + region)) return false;
    }
  }
  const region = (url: URL) =>
    [...url.searchParams]
      .filter(([key]) => regionKey.test(key))
      .map(([key, value]) => key.toLowerCase() + "=" + value.toLowerCase())
      .sort()
      .join("&");
  return (
    region(from) === region(to) &&
    (from.pathname === to.pathname ||
      policyPath(from, originalLanguage) === policyPath(to, "en"))
  );
}

export function englishPolicyAlternate(page: CheerioAPI, current: URL) {
  const original = pageLanguage(page);
  if (/^en(?:-|$)/i.test(original)) return;
  const originalRegion = original.split("-")[1];
  for (const node of page(
    "link[rel~='alternate'][hreflang][href], a[href]",
  ).toArray()) {
    const element = page(node);
    const isAnchor = element.is("a");
    if (isAnchor && !/^english$/i.test(element.text().trim())) continue;
    const lang = (element.attr("hreflang") ?? (isAnchor ? "en" : ""))
      .toLowerCase()
      .replace("_", "-");
    if (lang !== "en" && !(originalRegion && lang === "en-" + originalRegion))
      continue;
    const candidate = URL.parse(element.attr("href") ?? "", current);
    if (!candidate || !samePolicyLocale(current, candidate, original)) continue;
    candidate.hash = "";
    if (candidate.href !== current.href) return candidate;
  }
}
