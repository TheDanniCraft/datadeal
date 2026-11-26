import {
  externalResourceHosts,
  rejectControlLabel,
  summarizeResponseCookies,
} from "./observations";
import { Resolver } from "node:dns/promises";
import { resolvePublicAddress } from "./public-address";
import { detectHosting, hostingHeaderNames, isEuropean } from "./hosting";
export { resolvePublicAddress } from "./public-address";
import { request } from "node:https";
import { load } from "cheerio";
import { discoverSitemap, linkedDocuments } from "./sitemap";
import { vendorPassages, vendorPolicyLinks } from "./vendor-research";
import { contentPageSample } from "./content-pages";
export { configuredContentPageLimit } from "./content-pages";
import { findDocuments, type SelectPrivacyDocuments } from "./documents";
import { processingDocumentEvidence } from "./processing-documents";
import { c15tPreferenceSection } from "./c15t-preferences";
import {
  advertisingEvidence,
  type AdvertisingSection,
} from "./advertising-evidence";
import {
  providerPolicyEvidence,
  type ProviderPolicyReference,
} from "./provider-policy";
import { pageLanguage, scanLanguage } from "./language";
import { publicDocumentUrl } from "./public-document-url";
import { captureDocument } from "./document-layout";
import { extractPdfText, maxPdfBytes } from "./pdf-document";
import { pdfDocumentHtml } from "./pdf-layout";
import { isAccessInterstitial, isBlockPage } from "./access-interstitial";
export { isAccessInterstitial, isBlockPage } from "./access-interstitial";
export { scanLanguage } from "./language";
export * from "./browser-storage";
import {
  domain,
  evidence as evidenceSchema,
  type ScanReport,
  type Evidence,
  type Finding,
} from "@datadeal/contracts";

class RetryableResponseError extends Error {}

const officialPolicyPages = new Map([
  ["google.com", "https://policies.google.com/privacy?hl=en"],
  ["facebook.com", "https://www.facebook.com/privacy/policy/"],
  [
    "bild.de",
    "https://www.bild.de/corporate/site/datenschutz/artikel-datenschutz-54485502.bild.html",
  ],
]);

export function isRetryableScanFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error instanceof RetryableResponseError ||
    error.name === "AbortError" ||
    ["EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"].includes(
      String((error as NodeJS.ErrnoException).code),
    )
  );
}

async function readablePage(
  url: URL,
  origin: URL,
  signal: AbortSignal,
  redirects = 0,
  canonicalOrigin?: string,
  maxBytes = 1_000_000,
  format: "html" | "document" | "image" | "xml" | "text" = "html",
  publicDocument = false,
): Promise<{
  html: string;
  favicon?: string;
  url: URL;
  address?: string;
  headers?: Record<string, string>;
  cookies: ReturnType<typeof summarizeResponseCookies>;
}> {
  if (
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    (publicDocument && !publicDocumentUrl(url.href, origin)) ||
    redirects > 3
  ) {
    throw new Error("Redirect outside scan scope");
  }
  const pinned = await resolvePublicAddress(url.hostname);
  const response = await new Promise<import("node:http").IncomingMessage>(
    (resolve, reject) => {
      const req = request(
        url,
        {
          agent: false,
          signal,
          family: pinned.family,
          lookup: (_hostname, _options, callback) =>
            callback(null, pinned.address, pinned.family),
          headers: {
            "User-Agent": "DataDealResearch/1.0",
            "Accept-Language": scanLanguage,
            Accept: {
              html: "text/html",
              document: "text/html,application/pdf",
              image: "image/png,image/x-icon,image/vnd.microsoft.icon",
              xml: "application/xml,text/xml",
              text: "text/plain",
            }[format],
          },
        },
        resolve,
      );
      req.on("error", reject);
      req.end();
    },
  );
  const code = response.statusCode ?? 0;
  if ([408, 429, 500, 502, 503, 504].includes(code)) {
    response.destroy();
    throw new RetryableResponseError("Temporary HTTP response");
  }
  if ([301, 302, 303, 307, 308].includes(code) && response.headers.location) {
    response.destroy();
    const next = new URL(response.headers.location, url);
    if (next.origin === canonicalOrigin)
      return readablePage(
        next,
        next,
        signal,
        redirects + 1,
        undefined,
        maxBytes,
        format,
        publicDocument,
      );
    return readablePage(
      next,
      origin,
      signal,
      redirects + 1,
      canonicalOrigin,
      maxBytes,
      format,
      publicDocument,
    );
  }
  const contentType = (response.headers["content-type"] ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const pdf =
    format === "document" &&
    (contentType === "application/pdf" ||
      (contentType === "application/octet-stream" &&
        /\.pdf$/i.test(url.pathname)));
  if (
    code !== 200 ||
    (!pdf &&
      !{
        html: /^text\/html\b/i,
        document: /^text\/html$/i,
        image:
          /^(image\/(?:png|x-icon|vnd\.microsoft\.icon)|application\/octet-stream)\b/i,
        xml: /^(?:application|text)\/xml\b/i,
        text: /^text\/plain\b/i,
      }[format].test(contentType))
  ) {
    response.destroy();
    throw new Error("Unexpected scan response type");
  }
  const bodyLimit = pdf ? maxPdfBytes : maxBytes;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response as AsyncIterable<Buffer>) {
    bytes += chunk.length;
    if (bytes > bodyLimit) throw new Error("Response exceeds scan limit");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  let html = "";
  if (pdf) {
    const text = await extractPdfText(body, signal);
    if (!text) throw new Error("PDF policy text unavailable");
    html = pdfDocumentHtml(text);
  } else if (format !== "image") {
    html = body.toString("utf8");
  }
  if (
    (format === "html" || (format === "document" && !pdf)) &&
    isAccessInterstitial(
      html.match(/<title\b[^>]*>([^<]*)<\/title>/i)?.[1] ?? "",
      response.headers["cf-mitigated"],
      /\/cdn-cgi\/challenge-platform\/|id=["']challenge-(?:form|stage)["']/i.test(
        html,
      ) || isBlockPage(html),
    )
  )
    throw new Error("Site returned an access challenge");
  const iconType =
    format === "image" && body.length >= 8
      ? body.length >= 24 &&
        body
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        body.readUInt32BE(16) <= 1024 &&
        body.readUInt32BE(20) <= 1024
        ? "png"
        : body.readUInt32LE(0) === 0x00010000
          ? "x-icon"
          : null
      : null;
  return {
    html,
    favicon: iconType
      ? "data:image/" + iconType + ";base64," + body.toString("base64")
      : undefined,
    url,
    cookies: summarizeResponseCookies(response.headers["set-cookie"] ?? []),
    address: pinned.address,
    headers: Object.fromEntries(
      hostingHeaderNames.flatMap((name) => {
        const value = response.headers[name];
        return value === undefined ? [] : [[name, String(value).slice(0, 200)]];
      }),
    ),
  };
}

/** Isolated read-only policy acquisition, with identical URL and redirect checks at every hop. */
export function readPublicPolicyDocument(
  url: URL,
  signal: AbortSignal,
  source: "referral" | "official" = "referral",
) {
  const official =
    source === "official" &&
    [...officialPolicyPages.values()].includes(url.href);
  return readablePage(
    url,
    url,
    signal,
    0,
    undefined,
    official ? 3_000_000 : 800_000,
    "document",
    true,
  );
}

/**
 * Scoring v2 research: reads up to two privacy or cookie pages linked from a
 * vendor's homepage that the scan actually contacted. Same SSRF-safe reader,
 * same-origin only. Returns quoted passages as third-party evidence.
 */
export async function researchVendorPolicy(
  scanId: string,
  vendor: string,
  referringEvidenceId: string,
  signal: AbortSignal,
): Promise<Evidence[]> {
  const host = domain.parse(vendor);
  const home = new URL("https://" + host);
  const homepage = await readablePage(
    home,
    home,
    signal,
    0,
    host.startsWith("www.") ? undefined : "https://www." + host,
    2_000_000,
  );
  const rows: Evidence[] = [];
  for (const url of vendorPolicyLinks(load(homepage.html), homepage.url)) {
    const page = await readablePage(
      url,
      homepage.url,
      signal,
      0,
      undefined,
      800_000,
    ).catch(() => undefined);
    if (!page) continue;
    for (const passage of vendorPassages(load(page.html))) {
      rows.push({
        id: `vendor-policy-${host}-${rows.length + 1}`,
        scanId,
        kind: "third_party_reference",
        url: page.url.href,
        retrievedAt: new Date().toISOString(),
        excerpt: passage.excerpt,
        observation: {
          type: "provider_policy",
          providerHost: host,
          referringEvidenceId,
          heading: passage.heading,
        },
      });
    }
  }
  return rows;
}

export async function scan(
  id: string,
  input: string,
  selectPrivacyDocuments?: SelectPrivacyDocuments,
  onStage?: (stage: "sitemap" | "policy") => Promise<void>,
  options?: { contentPageLimit: number },
): Promise<ScanReport> {
  const host = domain.parse(input);
  const home = new URL("https://" + host);
  const signal = AbortSignal.timeout(18_000);
  const homepage = await readablePage(
    home,
    home,
    signal,
    0,
    host.startsWith("www.") ? undefined : "https://www." + host,
    2_000_000,
  );
  const $ = load(homepage.html);
  const icons = $("link[rel~='icon'][href],link[rel~='apple-touch-icon'][href]")
    .toArray()
    .map((node) => URL.parse($(node).attr("href") ?? "", homepage.url))
    .filter(
      (url): url is URL =>
        url?.origin === homepage.url.origin &&
        /\.(?:png|ico)$/i.test(url.pathname),
    )
    .sort(
      (a, b) =>
        Number(/\.png$/i.test(b.pathname)) - Number(/\.png$/i.test(a.pathname)),
    );
  const favicon = icons.length
    ? (async () => {
        const iconSignal = AbortSignal.any([signal, AbortSignal.timeout(2500)]);
        for (const icon of [
          ...icons.slice(0, 2),
          new URL("/favicon.ico", homepage.url),
        ]) {
          const asset = await readablePage(
            icon,
            homepage.url,
            iconSignal,
            0,
            undefined,
            24_000,
            "image",
          ).catch(() => undefined);
          if (asset?.favicon) return asset.favicon;
        }
      })()
    : undefined;
  const officialPolicy = officialPolicyPages.get(host.replace(/^www\./, ""));
  await onStage?.("sitemap");
  const discoverySignal = AbortSignal.any([signal, AbortSignal.timeout(3000)]);
  const sitemap = await discoverSitemap(homepage.url, (target, format) =>
    readablePage(
      target,
      homepage.url,
      discoverySignal,
      0,
      undefined,
      format === "xml" ? 750_000 : 256_000,
      format,
    ).then(({ html }) => html),
  );
  const evidence: Evidence[] = [
    {
      id: "homepage-http-cookies",
      kind: "observed_technical",
      url: homepage.url.href,
      excerpt: `The final homepage HTTP response included ${homepage.cookies.count} Set-Cookie headers.`,
      observation: homepage.cookies,
      retrievedAt: new Date().toISOString(),
      scanId: id,
    },
  ];
  const findings: Finding[] = [];
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  const aliases = await resolver
    .resolveCname(homepage.url.hostname)
    .catch(() => []);
  const targets = [
    ...new Set(aliases.map((alias) => alias.toLowerCase().replace(/\.$/, ""))),
  ]
    .filter((alias) => domain.safeParse(alias).success)
    .slice(0, 6);
  if (targets.length) {
    evidence.push({
      id: "homepage-dns-cname",
      kind: "inferred_infrastructure",
      excerpt: "The domain is routed through these hosts.",
      observation: { type: "dns_cname", targets },
      retrievedAt: new Date().toISOString(),
      scanId: id,
    });
  }
  const hosting = await detectHosting(
    homepage.address,
    homepage.headers ?? {},
  ).catch(() => undefined);
  if (hosting && (hosting.host || hosting.cdn)) {
    const describe = (role: string, p: { name: string; country: string }) =>
      `${role} ${p.name}${p.country ? ` (${p.country}${isEuropean(p.country) ? "" : ", outside the EU"})` : ""}`;
    evidence.push({
      id: "homepage-hosting",
      kind: "inferred_infrastructure",
      url: homepage.url.href,
      excerpt:
        [
          hosting.host &&
            describe("The server's network belongs to", hosting.host),
          hosting.cdn &&
            describe("Traffic passes through the CDN", hosting.cdn),
        ]
          .filter(Boolean)
          .join(". ") + ".",
      observation: hosting,
      retrievedAt: new Date().toISOString(),
      scanId: id,
    });
  }
  const rejectLabel = rejectControlLabel($);
  if (rejectLabel) {
    const evidenceId = "homepage-reject-control";
    evidence.push({
      id: evidenceId,
      kind: "observed_technical",
      url: homepage.url.href,
      excerpt: `The homepage HTML contained a control labeled “${rejectLabel}”. Its visibility and behavior were not checked in a browser.`,
      retrievedAt: new Date().toISOString(),
      scanId: id,
    });
    findings.push({
      rule: "optional_control",
      title: "Reject option present in homepage HTML",
      explanation:
        "The scan found a label for rejecting optional consent. A browser scan is needed to determine what the control does.",
      confidence: "low",
      severity: "informational",
      evidenceIds: [evidenceId],
    });
  }
  const externalHosts = externalResourceHosts($, homepage.url);
  if (externalHosts.length) {
    evidence.push({
      id: "homepage-external-resources",
      kind: "observed_technical",
      url: homepage.url.href,
      excerpt: `Script or iframe tags in the homepage HTML referenced these other hostnames: ${externalHosts.join(", ")}. The scanner did not load these resources or verify who operates them.`,
      observation: { type: "html_resource_hosts", hosts: externalHosts },
      retrievedAt: new Date().toISOString(),
      scanId: id,
    });
  }
  let privacySource: string | undefined;
  await onStage?.("policy");
  const homeLinks = linkedDocuments($, homepage.url, true);
  const documents = await findDocuments(
    homepage.url,
    homeLinks,
    sitemap.documents,
    officialPolicy,
    (url, scope) =>
      readablePage(
        url,
        scope,
        signal,
        0,
        undefined,
        url.href === officialPolicy ? 3_000_000 : undefined,
        "document",
        scope.origin !== homepage.url.origin,
      ),
    signal,
    selectPrivacyDocuments,
  );
  const processingSources = processingDocumentEvidence(
    id,
    homepage.url,
    [...homeLinks, ...sitemap.documents],
    documents,
    readPublicPolicyDocument,
    signal,
  );
  let retrievedDocuments = 0;
  const providerReferences: ProviderPolicyReference[] = [];
  const advertisingSections: AdvertisingSection[] = [];
  for (const {
    url,
    page,
    privacy: isPrivacy,
    sections,
    documentKind,
  } of documents) {
    const document = captureDocument(page);
    if (!document) continue;
    const evidenceId = "document-" + ++retrievedDocuments;
    const language = evidenceSchema.shape.language.safeParse(
      pageLanguage(page),
    ).data;
    evidence.push({
      id: evidenceId,
      language,
      url: url.href,
      ...document,
      documentKind,
      scanId: id,
      retrievedAt: new Date().toISOString(),
      kind: "declared_first_party",
    });
    if (isPrivacy) privacySource ??= evidenceId;
    const preference =
      documentKind === "cookies" &&
      url.origin === homepage.url.origin &&
      c15tPreferenceSection(page, url);
    if (preference)
      evidence.push({
        id: evidenceId + "-c15t-preferences",
        language,
        url: url.href,
        scanId: id,
        retrievedAt: new Date().toISOString(),
        kind: "declared_first_party",
        excerpt: preference.excerpt,
        observation: {
          type: "policy_section",
          heading: preference.heading,
          topic: "purpose",
          disclosedPreference: "c15t_choice",
        },
      });
    for (const [index, section] of sections.entries()) {
      const sectionId = `${evidenceId}-section-${index + 1}`;
      for (const policyUrl of section.providerPolicyUrls ?? []) {
        providerReferences.push({
          url: policyUrl,
          evidenceId: sectionId,
          context:
            section.providerContexts?.[policyUrl] ??
            section.title + " " + section.excerpt,
        });
      }
      const source: Evidence = {
        id: sectionId,
        language,
        url: url.href,
        excerpt: section.excerpt,
        observation: {
          type: "policy_section",
          heading: section.title,
          topic: section.topic,
          providerHosts: section.providerHosts,
        },
        scanId: id,
        retrievedAt: new Date().toISOString(),
        kind: "declared_first_party",
      };
      evidence.push(source);
      if (
        isPrivacy &&
        (section.advertisingLists?.length || section.directories?.length)
      ) {
        advertisingSections.push({
          source,
          lists: section.advertisingLists ?? [],
          directories: section.directories ?? [],
        });
      }
    }
  }
  const advertising = await advertisingEvidence(
    id,
    advertisingSections,
    readPublicPolicyDocument,
    signal,
  );
  evidence.push(
    ...advertising.rows,
    ...(await providerPolicyEvidence(
      id,
      [...providerReferences, ...advertising.providers],
      readPublicPolicyDocument,
      signal,
    )),
    ...(await processingSources),
  );
  if (privacySource) {
    findings.push({
      rule: "policy_available",
      title: "Privacy documentation available",
      explanation:
        "The scanner retrieved a public document identified as privacy information.",
      confidence: "moderate",
      severity: "positive",
      evidenceIds: [privacySource],
    });
  } else {
    // A linked policy we could not read is our gap, not the site's; only a
    // site with no privacy link anywhere counts as having no policy.
    const linked = [...homeLinks, ...sitemap.documents].some(
      ({ kind }) => kind === "privacy",
    );
    evidence.push({
      id: linked ? "coverage" : "policy-not-found",
      kind: "unknown",
      scanId: id,
      retrievedAt: new Date().toISOString(),
      excerpt: linked
        ? "The site links to a privacy policy, but the scanner couldn't read it."
        : "No privacy policy was found on the homepage, in legal directories, the sitemap or common policy addresses.",
    });
    findings.push({
      rule: "missing_information",
      title: "Policy evidence unavailable",
      explanation:
        "Review the website’s current policy before submitting personal information.",
      confidence: "low",
      severity: "caution",
      evidenceIds: [linked ? "coverage" : "policy-not-found"],
    });
  }
  return {
    id,
    domain: host,
    completedAt: new Date().toISOString(),
    demo: false,
    partial: true,
    pageSample: contentPageSample(
      homepage.url,
      $,
      sitemap.contentUrls,
      sitemap.discoveryLimited,
      options?.contentPageLimit,
    ),
    favicon: await favicon,
    evidence,
    findings,
  };
}
