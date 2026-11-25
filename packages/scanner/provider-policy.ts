import { load, type CheerioAPI } from "cheerio";
import {
  domain,
  evidence as evidenceSchema,
  type Evidence,
} from "@datadeal/contracts";
import { pageLanguage } from "./language";
import { isPrivacyHeading } from "./sitemap";
import {
  mentionsSelfHosting,
  plausibleVendorHost,
  supportsDeclaredHost,
} from "@datadeal/contracts/hosting-disclosure";

export type ProviderPolicyReference = {
  url: string;
  evidenceId: string;
  context: string;
  advertisingList?: boolean;
};
type FetchProvider = (
  url: URL,
  signal: AbortSignal,
) => Promise<{ url: URL; html: string }>;

// Match the visitor action in both disclosures. An account-registration policy
// for a provider does not establish what happens to a guest who opens its embed.
const activities = [
  /\b(?:booking|scheduling|appointment|buchung|terminbuchung)\b/i,
  /\b(?:payment|payments|checkout|zahlung)\b/i,
  /\b(?:analytics|measurement|reichweitenmessung)\b/i,
  /\b(?:newsletter|mailing list)\b/i,
  /\b(?:contact form|inquir(?:y|ies)|kontaktformular)\b/i,
  /advertis|\bads\b|werb|vermarkt/i,
];
const relevantHeading =
  /sharing|recipients?|sub[- ]?processors?|information we collect|collection of|how (?:do )?we use|weitergabe|empfänger|datenerhebung/i;
const currentDocument = "h1,h2,h3,h4,h5,h6,[role=heading]";

function excerpts(page: CheerioAPI, context: string) {
  page("script,style,nav,footer,form,header nav").remove();
  if (
    !page("title,h1")
      .toArray()
      .some((n) => isPrivacyHeading(page(n).text()))
  )
    return [];
  const matchActivities = activities.filter((pattern) => pattern.test(context));
  if (!matchActivities.length) return [];
  const content = page("main,[role=main]").first();
  const body = content.length ? content : page("body");
  let heading = "";
  const passages: { heading: string; excerpt: string }[] = [];
  for (const node of body.find(currentDocument + ",p,li,dd").toArray()) {
    const element = page(node);
    if (element.is(currentDocument)) {
      heading = element.text().replace(/\s+/g, " ").trim().slice(0, 140);
      continue;
    }
    if (!relevantHeading.test(heading) || element.find("p,li,dd").length)
      continue;
    const copy = element.clone();
    copy.find("br").replaceWith(" ");
    const text = copy
      .text()
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    let excerpt = "";
    for (const sentence of text.split(/(?<=[.!?])\s+(?=\p{Lu})/u)) {
      if (
        excerpt.length + sentence.length > 680 ||
        /https?:\/\/|\b[^\s@]+@[^\s@]+\.[^\s@]+|\b[A-Za-z0-9_-]{48,}\b/i.test(
          sentence,
        )
      )
        break;
      excerpt += (excerpt ? " " : "") + sentence;
    }
    if (
      excerpt.length < 40 ||
      !matchActivities.some((pattern) => pattern.test(excerpt)) ||
      !/\b(?:use|collect|host|store|storing|process|share|send|verarbeiten|speichern|übermitteln)\b/i.test(
        excerpt,
      ) ||
      passages.some((p) => p.excerpt === excerpt)
    )
      continue;
    passages.push({ heading, excerpt });
    if (passages.length === 2) break;
  }
  return passages;
}

export async function providerPolicyEvidence(
  scanId: string,
  references: ProviderPolicyReference[],
  fetchProvider: FetchProvider,
  signal: AbortSignal,
) {
  const rows: Evidence[] = [];
  const attempted = new Set<string>();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(2500)]);
  for (const reference of references) {
    if (attempted.size === 2 || deadline.aborted) break;
    const url = URL.parse(reference.url);
    if (
      !url ||
      url.protocol !== "https:" ||
      url.port ||
      url.search ||
      url.username ||
      url.password ||
      !domain.safeParse(url.hostname).success ||
      attempted.has(url.hostname) ||
      !activities.some((pattern) => pattern.test(reference.context))
    )
      continue;
    if (reference.advertisingList) {
      if (!/privacy|datenschutz/i.test(url.pathname)) continue;
    } else if (
      !supportsDeclaredHost(url.hostname, reference.context) ||
      (!plausibleVendorHost(url.hostname) &&
        mentionsSelfHosting(reference.context)) ||
      /\b(?:(?:do not|don't|never|no longer) (?:use|share|send|load|embed|work with)|not (?:provided|processed|hosted) by)\b/i.test(
        reference.context,
      ) ||
      !/\b(?:provided by|(?:processed|hosted|delivered) by|(?:we|we may) (?:use|work with|share|send|load|embed)|(?:receives?|processes|may process) (?:your|the|booking|payment|contact|data)|(?:nutzen|verwenden|übermitteln) wir|wir (?:nutzen|verwenden|übermitteln))\b/i.test(
        reference.context,
      )
    )
      continue;
    attempted.add(url.hostname);
    const response = await fetchProvider(url, deadline).catch(() => undefined);
    if (
      !response ||
      response.url.origin !== url.origin ||
      response.url.username ||
      response.url.password ||
      response.url.search
    )
      continue;
    const page = load(response.html);
    const language = evidenceSchema.shape.language.safeParse(
      pageLanguage(page),
    ).data;
    for (const passage of excerpts(page, reference.context)) {
      rows.push({
        id: "provider-policy-" + (rows.length + 1),
        scanId,
        kind: "third_party_reference",
        language,
        url: response.url.href,
        retrievedAt: new Date().toISOString(),
        excerpt: passage.excerpt,
        observation: {
          type: "provider_policy",
          providerHost: url.hostname,
          referringEvidenceId: reference.evidenceId,
          heading: passage.heading,
        },
      });
    }
  }
  return rows;
}
