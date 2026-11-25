import type { CheerioAPI } from "cheerio";
import {
  googleCookieFamilies,
  isGoogleCookiePolicy,
} from "@datadeal/contracts";

type Topic = "cookies" | "retention";

function subject(text: string): Topic | undefined {
  if (
    /^(?:cookies?(?: (?:policy|notice|statement))?|cookie[- ]richtlinie|how (?:we use|[\p{L}\p{N} &.-]{1,50} uses) cookies)$/iu.test(
      text,
    )
  )
    return "cookies";
  if (
    /^(?:(?:data )?retention(?: (?:policy|notice|periods?))?|how (?:we retain|[\p{L}\p{N} &.-]{1,50} retains) (?:data|information)(?: we collect)?|speicherdauer|aufbewahrungsfristen)$/iu.test(
      text,
    )
  )
    return "retention";
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

// Preserve whole paragraphs for precise policy citations. The same cookie
// can have different declared uses under different headings (notably NID).
export function googleCookieSections($: CheerioAPI, url: URL) {
  const sections: { title: string; excerpt: string; topic: "purpose" }[] = [];
  if (!isGoogleCookiePolicy(url.href)) return sections;
  let heading = "";
  const content = $("main,[role=main]").first();
  for (const node of (content.length ? content : $("body"))
    .find("h2,p")
    .toArray()) {
    const item = $(node);
    if (item.closest("nav,header,footer,form").length) continue;
    const text = normalize(item.text());
    if (item.is("h2")) {
      heading = text;
      continue;
    }
    if (
      !heading ||
      heading.length > 100 ||
      text.length < 32 ||
      text.length > 1600
    )
      continue;
    if (
      !text
        .split(/[^\p{L}\p{N}_-]+/u)
        .some((word) => googleCookieFamilies.some((name) => word === name))
    )
      continue;
    sections.push({ title: heading, excerpt: text, topic: "purpose" });
    if (sections.length >= 12) break;
  }
  return sections;
}

export function supplementalDocuments($: CheerioAPI, documentUrl: URL) {
  const found: { url: URL; topic: Topic }[] = [];
  if (documentUrl.protocol !== "https:") return found;
  for (const anchor of $("a[href]").toArray()) {
    const a = $(anchor);
    const href = a.attr("href")?.trim();
    if (!href || href.startsWith("#")) continue;
    const url = URL.parse(href, documentUrl);
    if (
      !url ||
      url.origin !== documentUrl.origin ||
      url.username ||
      url.password ||
      url.pathname === documentUrl.pathname
    )
      continue;
    // Keep locale selectors, but never capture opaque query values in citations.
    if (
      [...url.searchParams].some(
        ([key, value]) =>
          !/^(?:hl|lang|locale)$/i.test(key) ||
          !/^[a-z]{2,3}(?:[-_][a-z\d]{2,8}){0,2}$/i.test(value),
      )
    )
      continue;
    url.hash = "";
    const labels = [
      a.text(),
      a.attr("aria-label") ?? "",
      a.attr("title") ?? "",
    ].map(normalize);
    let topic = labels.map(subject).find(Boolean);
    // Generic cross-references need a document-specific path as a second signal.
    if (
      !topic &&
      labels.some((label) =>
        /^(?:learn more|read more|mehr erfahren)$/i.test(label),
      )
    ) {
      const segment = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
      topic = subject(segment.replace(/\.html?$/i, "").replace(/[-_]/g, " "));
    }
    if (
      !topic ||
      found.some((item) => item.topic === topic || item.url.href === url.href)
    )
      continue;
    found.push({ url, topic });
    if (found.length === 2) break;
  }
  return found;
}

export function supplementalSection($: CheerioAPI, topic: Topic) {
  const heading = $("h1,title")
    .toArray()
    .map((node) => normalize($(node).text()).split(/\s+(?:[|–—-])\s+/)[0])
    .find((title) => subject(title) === topic);
  if (!heading) return;
  const content = $("main,[role=main]").first();
  const prose = (content.length ? content : $("body")).clone();
  prose.find("nav,footer,header,form,button,script,style").remove();
  const topicText =
    topic === "cookies"
      ? /\bcookies?\b/i
      : /\b(?:retention|retain(?:s|ed)?|deleted?|deletion|gespeichert|löschen|gelöscht|aufbewahr\p{L}*)\b/iu;
  const paragraph = prose
    .find("p,li,dd,td")
    .toArray()
    .find((node) => {
      const paragraph = $(node).clone();
      paragraph.find("a").remove();
      const text = normalize(paragraph.text());
      return text.length >= 32 && topicText.test(text);
    });
  if (!paragraph) return;
  return {
    title: heading,
    excerpt: normalize($(paragraph).text()).slice(0, 1600),
    ...(topic === "retention" ? { topic: "retention" as const } : {}),
  };
}
