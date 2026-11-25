import { load, type CheerioAPI } from "cheerio";
import { cookieTableSections } from "./cookie-table";
import { extractPolicySections, isAppOnlyPolicy } from "./observations";
import {
  googleCookieSections,
  supplementalDocuments,
  supplementalSection,
} from "./supplemental";
import {
  dedicatedDocumentHost,
  publicDocumentUrl,
} from "./public-document-url";
import {
  englishPolicyAlternate,
  pageLanguage,
  samePolicyLocale,
} from "./language";
import {
  isPrivacyHeading,
  linkedDocuments,
  type DocumentLink,
} from "./sitemap";

export type SelectPrivacyDocuments = (
  candidates: readonly { id: string; label: string; path: string }[],
  signal: AbortSignal,
) => Promise<string[]>;

type DocumentPage = {
  url: URL;
  page: CheerioAPI;
  privacy: boolean;
  documentKind:
    | "privacy"
    | "cookies"
    | "terms"
    | "retention"
    | "imprint"
    | "contact"
    | "other";
  sections: Array<{
    title: string;
    excerpt: string;
    topic?: ReturnType<typeof extractPolicySections>[number]["topic"];
    providerHosts?: string[];
    providerPolicyUrls?: string[];
    providerContexts?: Record<string, string>;
    advertisingLists?: ReturnType<
      typeof extractPolicySections
    >[number]["advertisingLists"];
    directories?: ReturnType<
      typeof extractPolicySections
    >[number]["directories"];
  }>;
};
type FetchPage = (url: URL, scope: URL) => Promise<{ url: URL; html: string }>;

// A heading or link label alone also matches legal directories and placeholder pages.
const policyStatement =
  /\b(?:we (?:(?:do not|don['’]t|never) )?(?:collect|process|store|retain|delete|share|use|save|sell) (?:any )?(?:your|personal|contact|account|information|data|details|inquiries|cookies|local storage|session storage)|wir (?:verarbeiten|erheben|speichern|teilen|löschen) (?:ihre|personenbezogene|daten)|personenbezogene[nr]? daten werden)\b/i;

export function classifyDocument(
  page: CheerioAPI,
  url: URL,
  privacy: boolean,
): DocumentPage["documentKind"] {
  const title =
    page('h1, [role="heading"][aria-level="1"]').first().text().trim() ||
    page("title").text().trim();
  const slug = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (
    /^(?:impressum|imprint)(?:\b|$)/iu.test(title) ||
    /^(?:impressum|imprint)(?:[.-]|$)/i.test(slug)
  )
    return "imprint";
  if (
    /^(?:contact(?: us| directory)?|kontakt)(?:$|\s*[|–—])/iu.test(title) ||
    /^(?:contact|kontakt)(?:\.html?)?$/i.test(slug)
  )
    return "contact";
  if (privacy) return "privacy";
  if (
    /^(?:cookies?(?: policy| notice|s policy)?|cookie[- ]richtlinie)(?:$|\s*[|–—])/i.test(
      title,
    ) ||
    /^cookies?(?:[-_](?:policy|notice))?(?:\.html?)?$/i.test(slug)
  )
    return "cookies";
  if (
    /^(?:terms of (?:use|service)|terms and conditions|nutzungsbedingungen)(?:$|\s*[|–—])/i.test(
      title,
    ) ||
    /^terms(?:[-_]of[-_](?:use|service))?(?:\.html?)?$/i.test(slug)
  )
    return "terms";
  return "other";
}

export async function findDocuments(
  homepage: URL,
  homeLinks: DocumentLink[],
  sitemap: DocumentLink[],
  officialPolicy: string | undefined,
  fetchPage: FetchPage,
  signal: AbortSignal,
  select?: SelectPrivacyDocuments,
) {
  const links = [...homeLinks, ...sitemap];
  const homePrivacy = new Set(
    homeLinks.filter((link) => link.kind === "privacy").map((link) => link.url),
  );
  const urls = (kind: DocumentLink["kind"]) => [
    ...new Set(
      links.filter((link) => link.kind === kind).map((link) => link.url),
    ),
  ];
  const documents = new Map<string, DocumentPage>();
  const fetched = new Map<string, { url: URL; page: CheerioAPI } | null>();
  const directories = new Set(urls("hub"));
  const possible = new Map(
    links
      .filter((link) => link.kind === "candidate")
      .map((link) => [link.url, link]),
  );
  async function read(url: string, scope: URL = homepage) {
    const target = new URL(url);
    if (
      target.origin !== scope.origin ||
      target.username ||
      target.password ||
      (scope.origin !== homepage.origin && !publicDocumentUrl(url, scope))
    )
      return null;
    const cached = fetched.get(url);
    if (cached !== undefined) return cached;
    if (signal.aborted) return null;
    const result = await fetchPage(target, scope).catch(() => null);
    const loaded =
      result?.url.origin === scope.origin
        ? { url: result.url, page: load(result.html) }
        : null;
    fetched.set(url, loaded);
    if (loaded) fetched.set(loaded.url.href, loaded);
    return loaded;
  }
  let remainingTranslations = 4;
  type Loaded = NonNullable<Awaited<ReturnType<typeof read>>>;
  async function englishVersion(original: Loaded) {
    if (!remainingTranslations) return;
    const alternate = englishPolicyAlternate(original.page, original.url);
    if (!alternate) return;
    remainingTranslations--;
    const translated = await read(alternate.href, original.url);
    if (
      !translated ||
      !samePolicyLocale(
        original.url,
        translated.url,
        pageLanguage(original.page),
      )
    )
      return;
    const lang = pageLanguage(translated.page);
    if (
      lang
        ? !/^en(?:-|$)/i.test(lang)
        : !/\b(?:privacy|cookies?|data retention|terms of (?:use|service))\b/i.test(
            translated.page("h1,title").text(),
          )
    )
      return;
    return translated;
  }
  async function add(
    url: string,
    privacy: boolean,
    requireHeading: boolean,
    nominated = false,
    translation?: Loaded,
  ): Promise<boolean> {
    const target = new URL(url);
    const publisherLink =
      homePrivacy.has(url) && dedicatedDocumentHost(target, homepage);
    const scope = url === officialPolicy || publisherLink ? target : homepage;
    const loaded = translation ?? (await read(url, scope));
    if (!loaded) return false;
    if (!translation) {
      const translated = await englishVersion(loaded);
      if (translated && (await add(url, privacy, true, nominated, translated)))
        return true;
    }
    const { page } = loaded;
    const documentKind = classifyDocument(page, loaded.url, privacy);
    if (privacy && documentKind !== "privacy") return false;
    // Navigation and scripts are not evidence of what the policy discloses.
    // Keep the original DOM for discovering official links in its navigation.
    const article = load(page.html());
    article("script,style,nav,footer,header nav").remove();
    const content = article("main,[role=main]").first().length
      ? article("main,[role=main]").first()
      : article("body");
    if (!content.text().trim()) return false;
    const sections = privacy ? extractPolicySections(article, loaded.url) : [];
    if (privacy) {
      if (isAppOnlyPolicy(page)) return false;
      // Link directories may be labelled "Privacy" by the homepage.
      const body = content.clone();
      body.find("a,button,nav,footer,script,style,h1,h2,h3,h4,h5,h6").remove();
      const hasStatement = policyStatement.test(
        body.text().replace(/\s+/g, " ").trim(),
      );
      const headings = article("title,h1,[role=heading][aria-level='1']")
        .toArray()
        .map((node) => article(node).text().trim());
      const policyTitle = headings.some(isPrivacyHeading);
      const hasPolicyChildren = linkedDocuments(page, loaded.url).some(
        (link) =>
          link.url !== loaded.url.href &&
          (link.kind === "privacy" || link.kind === "candidate"),
      );
      const directoryTitle = headings.some((text) =>
        /(?:privacy (?:cent(?:er|re)|hub)|legal (?:notices|information|cent(?:er|re))|rechtliches|datenschutzcenter)/i.test(
          text,
        ),
      );
      const substantialParagraph = body
        .find("p,li,dd")
        .toArray()
        .some((node) => article(node).text().trim().length >= 80);
      if (
        !sections.length &&
        ((!hasStatement &&
          !(policyTitle && substantialParagraph && !hasPolicyChildren)) ||
          (directoryTitle && hasPolicyChildren))
      ) {
        if (loaded.url.origin === homepage.origin)
          directories.add(loaded.url.href);
        return false;
      }
      const descriptiveSection = sections.some(
        (section) =>
          ["collection", "sharing", "purpose", "retention"].includes(
            section.topic,
          ) && section.excerpt.length >= 40,
      );
      if (requireHeading && !policyTitle && !(nominated && descriptiveSection))
        return false;
      if (nominated && !hasStatement && !descriptiveSection) return false;
    }
    if (privacy || !documents.has(loaded.url.href))
      documents.set(loaded.url.href, {
        ...loaded,
        privacy,
        sections:
          privacy || documentKind === "cookies"
            ? [
                ...sections,
                ...cookieTableSections(article, documentKind === "cookies"),
              ]
            : sections,
        documentKind,
      });
    return true;
  }

  let found = officialPolicy ? await add(officialPolicy, true, true) : false;
  for (const url of urls("privacy").slice(0, 8)) {
    if (
      await add(
        url,
        true,
        !homePrivacy.has(url) ||
          url === officialPolicy ||
          new URL(url).origin !== homepage.origin,
      )
    )
      found = true;
  }
  for (const url of urls("other").slice(0, 3)) await add(url, false, false);
  if (!found) {
    for (const directory of [...directories].slice(0, 2)) {
      const hub = await read(directory);
      if (!hub || hub.url.origin !== homepage.origin) continue;
      const children = linkedDocuments(hub.page, hub.url);
      for (const child of children)
        if (child.kind === "candidate") possible.set(child.url, child);
      for (const url of [
        ...new Set(
          children
            .filter((child) => child.kind === "privacy")
            .map((child) => child.url),
        ),
      ].slice(0, 3)) {
        if (await add(url, true, true)) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  if (!found && select && possible.size && !signal.aborted) {
    const options = [...possible.values()].slice(0, 16);
    const byId = new Map(
      options.map((link, index) => ["link-" + (index + 1), link]),
    );
    const candidates = [...byId].map(([id, link]) => ({
      id,
      label: link.label,
      path: new URL(link.url).pathname.slice(0, 256),
    }));
    const picks = await select(candidates, signal).catch(() => []);
    for (const id of [...new Set(picks)].slice(0, 2)) {
      const link = byId.get(id);
      if (link && (await add(link.url, true, true, true))) {
        found = true;
        break;
      }
    }
  }
  if (!found) {
    for (const path of ["/privacy", "/privacy-policy", "/datenschutz"]) {
      if (await add(new URL(path, homepage).href, true, true)) break;
    }
  }
  const attemptedTopics = new Set<string>();
  for (const policy of [...documents.values()].filter((doc) => doc.privacy)) {
    for (const { url, topic } of supplementalDocuments(
      policy.page,
      policy.url,
    )) {
      if (attemptedTopics.has(topic)) continue;
      attemptedTopics.add(topic);
      const original = await read(url.href, policy.url);
      if (!original) continue;
      const translated = await englishVersion(original);
      for (const loaded of [translated, original]) {
        if (!loaded || documents.get(loaded.url.href)?.privacy) continue;
        const section = supplementalSection(loaded.page, topic);
        if (!section) continue;
        documents.set(loaded.url.href, {
          ...loaded,
          privacy: false,
          documentKind: topic,
          sections: [
            section,
            ...googleCookieSections(loaded.page, loaded.url),
            ...(topic === "cookies"
              ? cookieTableSections(loaded.page, true)
              : []),
          ],
        });
        break;
      }
    }
    if (attemptedTopics.size === 2) break;
  }
  return [...documents.values()];
}
