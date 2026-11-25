import { evidence, type Evidence } from "@datadeal/contracts";
import {
  declaredPlausibleCloud,
  plausibleVendorHost,
  mentionsSelfHosting,
} from "@datadeal/contracts/hosting-disclosure";
import { load, type CheerioAPI } from "cheerio";
import { pageLanguage } from "./language";
import {
  publicDocumentUrl,
  privateText,
  dedicatedDocumentHost,
} from "./public-document-url";
import { processingDocumentKind, type DocumentLink } from "./sitemap";

type Kind = NonNullable<ReturnType<typeof processingDocumentKind>>;
type Referral = { url: string; excerpt: string };
type Target = {
  url: URL;
  kind: Kind | "provider_directory";
  referral?: Referral;
};
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const role =
  /\b(?:hosting|hosted|host|infrastructure|storage|email delivery|technical support|customer support|payment processing|webhosting|hoster|hostinganbieter|gehostet|speicherplatz|infrastruktur|zahlungsabwicklung|kundensupport|e-mail-versand)\b/i;
const declaration =
  /\b(?:our (?:web )?host(?:ing provider)? is|our (?:website|service) is hosted by|we (?:use|engage) [^.!?]{1,90} (?:for|to provide|to host)|wir (?:nutzen|beauftragen) [^.!?]{1,90} (?:für|zum)|unser(?:e|er)? (?:webseite|website) wird (?:bei|von)|unser (?:hoster|hostinganbieter) ist)\b/i;
const hypothetical =
  /\b(?:may|might|could|example|sample|template|if|except|not|never|formerly|können|könnte|muster|beispiel|wenn|nicht|kein\p{L}*)\b/iu;

function linkedTargets(page: CheerioAPI, base: URL, external: boolean) {
  const found: Target[] = [];
  for (const node of page("a[href]").toArray()) {
    const a = page(node);
    const raw = a.attr("href")?.trim();
    if (!raw || raw.startsWith("#")) continue;
    const url = publicDocumentUrl(raw, base);
    if (!url || url.href === base.href) continue;
    const kind = [
      a.text(),
      a.attr("aria-label") ?? "",
      a.attr("title") ?? "",
      url.pathname
        .split("/")
        .filter(Boolean)
        .at(-1)
        ?.replace(/\.(?:html?|pdf)$/i, "") ?? "",
    ]
      .map(processingDocumentKind)
      .find(Boolean);
    if (url.origin === base.origin) {
      if (kind) found.push({ url, kind });
      continue;
    }
    if (!external || a.parents("nav,header,footer,aside,form").length) continue;
    const passage = a.closest("p,li,dd");
    const excerpt = clean(passage.text());
    const cloud = plausibleVendorHost(url.hostname)
      ? declaredPlausibleCloud(excerpt)
      : undefined;
    if (plausibleVendorHost(url.hostname)) {
      // Compare adjacent policy paragraphs as well as this link's own text.
      // Separate Cloud use can qualify when its distinct service scope is named.
      const neighborText = [
        ...passage.prevUntil("h1,h2,h3,h4,h5,h6").toArray().reverse(),
        ...passage.toArray(),
        ...passage.nextUntil("h1,h2,h3,h4,h5,h6").toArray(),
      ]
        .map((node) => clean(page(node).text()))
        .join("\n");
      if (!cloud || !declaredPlausibleCloud(neighborText)) continue;
    }
    const statement =
      cloud ??
      excerpt
        .split(/(?<=[.!?])\s+/)
        .find((sentence) => declaration.test(sentence) && role.test(sentence));
    // A link in a directory, sidebar or shared paragraph about several vendors is ambiguous.
    if (
      passage.find("a[href]").length !== 1 ||
      excerpt.length > 580 ||
      excerpt.length < 20 ||
      privateText.test(excerpt) ||
      (!cloud &&
        (hypothetical.test(excerpt) || mentionsSelfHosting(statement ?? ""))) ||
      !statement
    )
      continue;
    const name = url.hostname
      .split(".")
      .slice(0, -1)
      .filter(
        (label) =>
          label.length >= 3 &&
          !/^(?:www|com|org|net|legal|privacy|hosting|cloud|docs|trust)$/.test(
            label,
          ),
      );
    const namedHost = name.some((label) =>
      new RegExp("\\b" + label.replaceAll("-", "[- ]?") + "\\b", "i").test(
        statement,
      ),
    );
    if (!namedHost) continue;
    if (
      kind ||
      url.pathname === "/" ||
      /privacy|datenschutz/i.test(clean(a.text()))
    ) {
      found.push({
        url,
        kind: kind ?? "provider_directory",
        referral: { url: base.href, excerpt },
      });
    }
  }
  return found;
}

function passages(page: CheerioAPI, kind: Kind) {
  page("script,style,nav,footer,header nav,aside,form").remove();
  const title = page("h1").first().text() || page("title").text();
  if (
    !title
      .split(/\s+[|–—-]\s+/)
      .some((part) => processingDocumentKind(part) === kind)
  )
    return [];
  const content = page("main,[role=main],article").first();
  const body = content.length ? content : page("body");
  const rows: { heading: string; excerpt: string }[] = [];
  let heading = clean(title).slice(0, 180);
  for (const node of body.find("h1,h2,h3,h4,p,li,dd,tr").toArray()) {
    const element = page(node);
    if (element.is("h1,h2,h3,h4")) {
      heading = clean(element.text()).slice(0, 180) || heading;
      continue;
    }
    if (element.find("p,li,dd,tr").length && !element.is("tr")) continue;
    if (element.parents("tr").length) continue;
    let excerpt = clean(element.text());
    let context = heading;
    if (element.is("tr")) {
      if (kind !== "subprocessors" || element.find("th").length) continue;
      const headers = element
        .closest("table")
        .find("tr")
        .first()
        .children("th")
        .map((_, cell) => clean(page(cell).text()))
        .get();
      const cells = element
        .children("td")
        .map((_, cell) => clean(page(cell).text()))
        .get();
      const entity = headers.findIndex((h) =>
        /^(?:sub[- ]?processor|company|provider|name|entity|anbieter|unternehmen|unterauftragnehmer|unterauftragsverarbeiter)$/i.test(
          h,
        ),
      );
      const purpose = headers.findIndex((h) =>
        /^(?:purpose|service|function|processing activity|zweck|leistung|dienstleistung)$/i.test(
          h,
        ),
      );
      if (
        entity < 0 ||
        purpose < 0 ||
        cells.length !== headers.length ||
        !cells[entity] ||
        !cells[purpose]
      )
        continue;
      excerpt = cells.join(" · ");
      context = heading + " — " + headers.join(" · ");
    } else if (kind === "dpa") {
      const scopedProcessing =
        /\b(?:personal data|visitor data|customer data|personenbezogene[nr]? daten)\b/i.test(
          excerpt,
        ) &&
        /\b(?:documented instructions|on behalf of (?:the |its )?(?:customer|controller)|dokumentierten? weisung\p{L}*|im auftrag des (?:kunden|verantwortlichen))\b/iu.test(
          excerpt,
        ) &&
        /\b(?:process(?:es|ed|ing)?|verarbeitet|verarbeiten)\b/i.test(excerpt);
      const hostingClause =
        /\b(?:provides? (?:database |cloud )?hosting|our (?:website|service) is hosted by|unser (?:hoster|hostinganbieter) ist)\b/i.test(
          excerpt,
        );
      if (!scopedProcessing && !hostingClause) continue;
    } else if (
      !/\b(?:we (?:use|engage)|our sub[- ]?processor|wir (?:nutzen|beauftragen)|unser unterauftragnehmer)\b/i.test(
        excerpt,
      ) ||
      !role.test(excerpt)
    )
      continue;
    if (
      !excerpt ||
      excerpt.length > 850 ||
      privateText.test(excerpt) ||
      !context ||
      context.length > 180 ||
      rows.some((row) => row.excerpt === excerpt)
    )
      continue;
    rows.push({ heading: context, excerpt });
    if (rows.length === 3) break;
  }
  return rows;
}

export async function processingDocumentEvidence(
  scanId: string,
  homepage: URL,
  links: DocumentLink[],
  policies: { url: URL; page: CheerioAPI; privacy: boolean }[],
  fetchPage: (
    url: URL,
    signal: AbortSignal,
  ) => Promise<{ url: URL; html: string }>,
  signal: AbortSignal,
) {
  const queue: Target[] = [];
  for (const policy of policies) {
    for (const target of linkedTargets(
      policy.page,
      policy.url,
      policy.privacy,
    )) {
      // A separately hosted official site policy does not turn its whole domain into the reviewed site.
      if (target.referral || target.url.origin === homepage.origin)
        queue.push(target);
    }
  }
  for (const link of links) {
    if (link.kind !== "dpa" && link.kind !== "subprocessors") continue;
    const url = publicDocumentUrl(link.url, homepage);
    if (
      url &&
      (url.origin === homepage.origin || dedicatedDocumentHost(url, homepage))
    )
      queue.push({ url, kind: link.kind });
  }
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(3000)]);
  const seen = new Set<string>();
  const rows: Evidence[] = [];
  for (const target of queue) {
    if (seen.size >= 4 || deadline.aborted) break;
    if (seen.has(target.url.href)) continue;
    seen.add(target.url.href);
    const response = await fetchPage(target.url, deadline).catch(
      () => undefined,
    );
    if (
      !response ||
      response.url.origin !== target.url.origin ||
      !publicDocumentUrl(response.url.href, target.url)
    )
      continue;
    const page = load(response.html);
    if (target.kind === "provider_directory") {
      for (const next of linkedTargets(page, response.url, false))
        queue.push({ ...next, referral: target.referral });
      continue;
    }
    const sections = passages(page, target.kind);
    const language = evidence.shape.language.safeParse(pageLanguage(page)).data;
    for (const section of sections)
      rows.push({
        id: "processing-document-" + (rows.length + 1),
        scanId,
        kind: target.referral
          ? "third_party_reference"
          : "declared_first_party",
        url: response.url.href,
        language,
        excerpt: section.excerpt,
        retrievedAt: new Date().toISOString(),
        observation: {
          type: "processing_document",
          document: target.kind,
          heading: section.heading,
          referral: target.referral,
        },
      });
    if (target.kind === "dpa" && sections.length) {
      for (const next of linkedTargets(page, response.url, false))
        if (next.kind === "subprocessors")
          queue.push({ ...next, referral: target.referral });
    }
  }
  return rows;
}
