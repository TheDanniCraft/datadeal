import { domain, type PolicyTopic } from "@datadeal/contracts";
import {
  mentionsSelfHosting,
  plausibleVendorHost,
  supportsDeclaredHost,
} from "@datadeal/contracts/hosting-disclosure";
import type { CheerioAPI } from "cheerio";
import {
  advertisingReferrals,
  type AdvertisingList,
  type DirectoryLink,
} from "./advertising-referrals";

const policyHeadings: [PolicyTopic, RegExp][] = [
  [
    "purpose",
    /^we (?:do not|don['’]t|never) track (?:you|visitors) (?:through|with|using) cookies\b/i,
  ],
  [
    "sharing",
    /^we (?:do not|don['’]t|never) (?:sell|share) (?:your )?personal (?:information|data)\b/i,
  ],
  [
    "collection",
    /^we (?:do not|don['’]t|never) (?:save|store|collect)(?: or share)? your (?:search|browsing)\b/i,
  ],
  [
    "transfers",
    /international transfers?|where (?:in the world )?(?:is|are) (?:your )?(?:personal )?(?:data|information) transferred|drittland|drittländer/i,
  ],
  [
    "retention",
    /\b(?:retention|retain(?:ing)? (?:your |personal )?(?:data|information)|how long|speicherdauer|aufbewahrungsdauer)\b/i,
  ],
  ["legal_basis", /legal bas[ie]s|rechtsgrundlagen?/i],
  ["rights", /your rights|ihre rechte|betroffenenrechte/i],
  [
    "collection",
    /\bhow (?:is|was) (?:your )?(?:personal )?(?:data|information) collected\b/i,
  ],
  [
    "sharing",
    /\b(?:disclosures? of (?:your )?personal (?:data|information)|how (?:do )?we share (?:your )?(?:personal )?(?:data|information))\b/i,
  ],
  [
    "purpose",
    /\bwhy (?:do )?we collect (?:your )?(?:personal )?(?:data|information)\b/i,
  ],
  [
    "sharing",
    /\b(?:sharing|(?:advertising|marketing) (?:vendors?|partners?|recipients?)|werbepartner|who (?:do )?we share (?:your )?(?:personal )?(?:data|information) with|google shares your information|external processing|recipients and transfers|optional booking embed|disclosing (?:your )?personal (?:data|information)|datenweitergabe|weitergabe (?:von |ihrer )?(?:personenbezogener |personenbezogenen )?daten|empfänger (?:der|ihrer) daten|drittanbieter|weitergabe von nutzerkennungen|wie teilen wir informationen mit dritten)\b/i,
  ],
  [
    "collection",
    /\b(?:(?:data|information) (?:do )?we collect|how we collect|information [a-z]+ collects|your apps, browsers|your activity|project inquiries|ihre kontaktaufnahme|aufruf der website|collection of (?:your )?personal (?:data|information)|datenerhebung|erhebung (?:von )?(?:personenbezogenen |personenbezogener )?daten|welche informationen erheben wir|(?:welche )?daten (?:erheben wir|wir erheben))\b/i,
  ],
  [
    "purpose",
    /how (?:do )?we use|what (?:do )?we do with (?:your )?(?:personal )?(?:data|information)\b|why [a-z]+ collects data|we use data to build better services|^(?:provide our services|maintain (?:&|and) improve our services|provide personalized services, including content and ads)$|privacy-friendly analytics|website delivery and security|zwecke? der (?:daten)?verarbeitung|wie verwenden wir (?:deine|ihre) informationen/i,
  ],
];

export function isAppOnlyPolicy($: CheerioAPI) {
  const content = $("main").first().length ? $("main").first() : $("body");
  const [title = "", subtitle = ""] = content
    .find("h1, h2, h3")
    .slice(0, 2)
    .map((_, element) => $(element).text().replace(/\s+/g, " ").trim())
    .get();
  const policyTitle = /privacy (?:policy|notice)|datenschutzerklärung/i;
  const siteScope = /\b(?:website|webseite|websites|webseiten|webangebot)\b/i;
  return (
    !siteScope.test(`${title} ${subtitle}`) &&
    policyTitle.test(title) &&
    (/\bapp\s*[-–:]?\s*(?:privacy (?:policy|notice)|datenschutzerklärung)$/i.test(
      title,
    ) ||
      /^[\p{L}\p{N}][\p{L}\p{N} .&-]{0,60}[ -]app$/iu.test(subtitle))
  );
}

const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });

function sectionExcerpt(blocks: string[], limit: number) {
  let excerpt = "";
  for (const block of blocks) {
    const text = block.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const prefix = excerpt ? excerpt + " " : "";
    if (prefix.length + text.length <= limit) {
      excerpt = prefix + text;
      continue;
    }
    let end = 0;
    for (const { segment, index } of sentences.segment(text)) {
      if (prefix.length + index + segment.trimEnd().length > limit) break;
      end = index + segment.length;
    }
    if (end) excerpt = prefix + text.slice(0, end).trimEnd();
    break;
  }
  return excerpt;
}

export function extractPolicySections($: CheerioAPI, documentUrl?: URL) {
  const emphasisHeading = "p:has(> :is(b, strong):only-child)";
  const accessibleHeading = '[role="heading"][aria-level="2"]';
  const headingSelector = `h1, h2, h3, h4, h5, h6, ${emphasisHeading}, ${accessibleHeading}`;
  const content = $("main").first().length
    ? $("main").first()
    : $("body").first();
  const sections: {
    title: string;
    excerpt: string;
    topic: PolicyTopic;
    providerHosts?: string[];
    providerPolicyUrls?: string[];
    providerContexts?: Record<string, string>;
    advertisingLists?: AdvertisingList[];
    directories?: DirectoryLink[];
  }[] = [];
  const headings = content
    .find(headingSelector)
    .toArray()
    .filter((element) => {
      const heading = $(element);
      if (!heading.is(emphasisHeading)) return true;
      const title = heading.text().replace(/\s+/g, " ").trim();
      return (
        title.length <= 140 &&
        title === heading.children().text().replace(/\s+/g, " ").trim()
      );
    });
  const anchors = headings.map((element) => {
    const heading = $(element);
    const wrapper = heading.parent();
    return heading.is(accessibleHeading) && wrapper.children().length === 1
      ? wrapper[0]
      : element;
  });
  const boundaries = new Set(anchors);
  for (const [index, element] of headings.entries()) {
    const heading = $(element);
    const title = heading.text().replace(/\s+/g, " ").trim();
    const matched = policyHeadings.find(([, pattern]) => pattern.test(title));
    if (!matched) continue;
    const following = $(anchors[index]).nextAll().toArray();
    const end = following.findIndex(
      (node) => boundaries.has(node) || node.name === "h1",
    );
    const siblings = $(end === -1 ? following : following.slice(0, end));
    const excerpt = sectionExcerpt(
      siblings.toArray().map((sibling) => $(sibling).text()),
      matched[0] === "purpose" ? 1600 : 800,
    );
    if (!excerpt) continue;
    const providers = new Set<string>();
    const policyUrls = new Set<string>();
    const providerContexts: Record<string, string> = {};
    if (documentUrl && (matched[0] === "sharing" || matched[0] === "purpose")) {
      for (const anchor of siblings.find("a[href]").toArray()) {
        if (!/privacy policy|datenschutz/i.test($(anchor).text())) continue;
        const target = URL.parse($(anchor).attr("href") ?? "", documentUrl);
        if (
          target?.protocol === "https:" &&
          !target.port &&
          !target.username &&
          !target.password &&
          target.origin !== documentUrl.origin &&
          domain.safeParse(target.hostname).success
        ) {
          const context = $(anchor)
            .closest("p,li,dd")
            .text()
            .replace(/\s+/g, " ")
            .trim();
          if (
            !context ||
            !excerpt.includes(context) ||
            !supportsDeclaredHost(target.hostname, context) ||
            !supportsDeclaredHost(target.hostname, excerpt) ||
            (!plausibleVendorHost(target.hostname) &&
              (mentionsSelfHosting(context) || matched[0] !== "sharing"))
          )
            continue;
          providers.add(target.hostname);
          if (policyUrls.size < 5 && !target.search) {
            target.hash = "";
            if (target.pathname.length <= 240) {
              policyUrls.add(target.href);
              providerContexts[target.href] = title + " " + context;
            }
          }
          if (providers.size === 5) break;
        }
      }
    }
    const referrals =
      documentUrl && (matched[0] === "sharing" || matched[0] === "purpose")
        ? advertisingReferrals($, siblings, title, documentUrl)
        : undefined;
    sections.push({
      title: title.slice(0, 140),
      excerpt,
      topic: matched[0],
      ...(referrals?.lists.length && { advertisingLists: referrals.lists }),
      ...(referrals?.directories.length && {
        directories: referrals.directories,
      }),
      ...(providers.size ? { providerHosts: [...providers] } : {}),
      ...(policyUrls.size
        ? { providerPolicyUrls: [...policyUrls], providerContexts }
        : {}),
    });
    if (sections.length === 16) break;
  }
  return sections;
}

export function summarizeResponseCookies(headers: readonly string[]) {
  let secure = 0;
  let httpOnly = 0;
  let sameSite = 0;
  for (const header of headers) {
    const attributes = header
      .split(";")
      .slice(1)
      .map((value) => value.trim());
    if (attributes.some((value) => /^secure$/i.test(value))) secure++;
    if (attributes.some((value) => /^httponly$/i.test(value))) httpOnly++;
    if (
      attributes.some((value) =>
        /^samesite\s*=\s*(strict|lax|none)$/i.test(value),
      )
    )
      sameSite++;
  }
  return {
    type: "response_cookie_attributes" as const,
    count: headers.length,
    secure,
    httpOnly,
    sameSite,
  };
}

export function externalResourceHosts($: CheerioAPI, homepage: URL) {
  const hosts = new Set<string>();
  for (const element of $("script[src], iframe[src]").toArray()) {
    const source = $(element).attr("src")?.trim();
    if (!source || !/^(https?:)?\/\//i.test(source)) continue;
    const reference = URL.parse(source, homepage);
    if (
      reference &&
      !reference.username &&
      !reference.password &&
      reference.hostname !== homepage.hostname &&
      domain.safeParse(reference.hostname).success
    ) {
      hosts.add(reference.hostname);
      if (hosts.size === 20) break;
    }
  }
  return [...hosts];
}
export function rejectControlLabel($: CheerioAPI) {
  for (const element of $(
    "button, [role=button], input[type=button]",
  ).toArray()) {
    const control = $(element);
    if (
      control.closest('[hidden], [inert], [aria-hidden="true"], template')
        .length ||
      control.is('[disabled], [aria-disabled="true"]')
    )
      continue;
    const label = (
      control.attr("aria-label") ??
      control.attr("value") ??
      control.text()
    )
      .replace(/\s+/g, " ")
      .trim();
    if (
      /^((reject|decline) (all|optional) cookies|nur notwendige cookies|alle cookies ablehnen)$/i.test(
        label,
      )
    )
      return label;
    if (
      /^((reject|decline) (all|optional)|alle ablehnen)$/i.test(label) &&
      /cookie|consent|einwilligung/i.test(
        control.closest('dialog, [role="dialog"], [role="alertdialog"]').text(),
      )
    )
      return label;
  }
}
