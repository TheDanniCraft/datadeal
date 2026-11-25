import {
  requestEvidencePriority,
  type DomainLookup,
  type Evidence,
  type ScanReport,
} from "@datadeal/contracts";
import { selfHostedPlausible } from "@datadeal/contracts/hosting-disclosure";

type PublicReport = NonNullable<DomainLookup["report"]>;
type RequestObservation = Extract<
  NonNullable<Evidence["observation"]>,
  { type: "browser_request_fields" }
>;
type ObservedRequest = {
  source: Evidence;
  fields: RequestObservation;
  scenario: NonNullable<Evidence["consentScenario"]>;
};

const dataLabels = {
  email_value: "an email-shaped value",
  email_address_value: "an email-shaped value in an email field",
  email: "email address",
  phone: "phone number",
  advertising_id: "advertising ID",
  identifier: "identifier",
  page_url: "page URL",
  referrer_url: "referring page",
  event_name: "event name",
  site_domain: "site domain",
  campaign: "campaign",
  screen_size: "screen size",
  language: "language",
  custom_properties: "custom event details",
} satisfies Record<RequestObservation["fieldCategories"][number], string>;

const relationships = {
  same_origin: "the page’s own origin",
  same_site: "another origin on the same site",
  cross_site: "a different site",
};
const list = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

function describeFields(fields: RequestObservation, limit: number) {
  const matchedEmail = fields.fieldCategories.includes("email_address_value");
  const categories = (
    Object.keys(dataLabels) as (keyof typeof dataLabels)[]
  ).filter(
    (key) =>
      key !== "email_value" &&
      key !== "email_address_value" &&
      !(matchedEmail && key === "email") &&
      fields.fieldCategories.includes(key),
  );
  const text = categories.length
    ? "fields for " +
      list.format(categories.slice(0, limit).map((key) => dataLabels[key]))
    : "";
  return [
    matchedEmail
      ? dataLabels.email_address_value
      : fields.fieldCategories.includes("email_value")
        ? "an email-shaped value"
        : "",
    text,
  ]
    .filter(Boolean)
    .join(" and ");
}

function describeRequest(fields: RequestObservation, limit: number) {
  const format =
    fields.signature === "plausible_event"
      ? "A Plausible-compatible analytics request"
      : fields.signature === "permutive_event"
        ? "A Permutive event request"
        : fields.signature === "meta_pixel_event"
          ? "A Meta Pixel event request"
          : "A request";
  const content = describeFields(fields, limit);
  return (
    format +
    " to " +
    relationships[fields.relation] +
    (content ? " included " + content : " was attempted") +
    "."
  );
}

export function requestEvidenceExcerpt(
  fields: RequestObservation,
  scenario: ObservedRequest["scenario"],
) {
  const timing =
    scenario === "default"
      ? "Default visit"
      : (fields.phase === "before_choice" ? "Before" : "After") +
        (scenario === "accepted"
          ? " accepting optional consent"
          : " rejecting optional consent");
  const channels = {
    query: "URL query",
    json: "JSON body",
    form: "form body",
    text: "text body",
  };
  const locations = list.format(
    fields.sources.map((channel) => channels[channel]),
  );
  return (
    timing +
    " · " +
    fields.targetDomain +
    ". " +
    describeRequest(fields, Infinity) +
    " Transport: " +
    fields.scheme.toUpperCase() +
    (fields.method === "OTHER" ? "." : " " + fields.method + ".") +
    (locations ? " Recorded in: " + locations + "." : "") +
    " Matching requests attempted: " +
    fields.attempts +
    ". HTTP responses observed: " +
    fields.responses +
    ". DataDeal kept the categories without retaining the values."
  );
}

export function publicRequestFindings(
  report?: ScanReport,
): NonNullable<PublicReport["requestFindings"]> {
  const ranked: ObservedRequest[] = [];
  for (const source of report?.evidence ?? []) {
    if (
      source.scanId === report?.id &&
      source.kind === "observed_technical" &&
      source.consentScenario &&
      source.observation?.type === "browser_request_fields"
    )
      ranked.push({
        source,
        fields: source.observation,
        scenario: source.consentScenario,
      });
  }
  ranked.sort(
    (a, b) =>
      requestEvidencePriority(b.fields) - requestEvidencePriority(a.fields),
  );
  const seen = new Set<string>();
  const findings: NonNullable<PublicReport["requestFindings"]> = [];
  for (const { source, scenario, fields } of ranked) {
    const key = [scenario, fields.targetDomain, fields.relation].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    const timing =
      scenario === "default"
        ? ""
        : (fields.phase === "after_choice"
            ? " Observed after "
            : " Observed before ") +
          (scenario === "accepted"
            ? "accepting optional consent."
            : "rejecting optional consent.");
    findings.push({
      destination: fields.targetDomain,
      evidenceId: source.id,
      scenario,
      text: describeRequest(fields, 4) + timing,
    });
    if (findings.length === 6) break;
  }
  return findings;
}

export function publicProviderDisclosures(
  report?: ScanReport,
): NonNullable<PublicReport["providerDisclosures"]> {
  if (!report) return [];
  const localPolicy = new Set(
    report.evidence
      .filter(
        (source) =>
          source.scanId === report.id && source.kind === "declared_first_party",
      )
      .map((source) => source.id),
  );
  return report.evidence
    .flatMap((source) => {
      const provider = source.observation;
      if (
        source.scanId !== report.id ||
        source.kind !== "third_party_reference" ||
        provider?.type !== "provider_policy" ||
        !localPolicy.has(provider.referringEvidenceId)
      )
        return [];
      const sentence = source.excerpt
        .match(/^.{12,349}?[.!?](?:\s|$)/su)?.[0]
        .trim();
      return [
        {
          providerHost: provider.providerHost,
          section: provider.heading,
          excerpt: sentence,
          evidenceId: source.id,
          referringEvidenceId: provider.referringEvidenceId,
        },
      ];
    })
    .slice(0, 4);
}

export function selfHostedAnalyticsDisclosure(report?: ScanReport) {
  for (const source of report?.evidence ?? []) {
    if (
      source.scanId !== report?.id ||
      source.kind !== "declared_first_party" ||
      source.observation?.type !== "policy_section"
    )
      continue;
    const plausible = selfHostedPlausible(source.excerpt);
    const otherTool = source.excerpt.match(
      /\b(?:(?:this|our|the) (?:website|site) uses|we (?:use|operate)) (?:a |an |our )?self[- ]hosted (Matomo|Umami)\b[^!?\n]{0,180}?(?:\.(?=\s|$)|$)/i,
    );
    const quote = plausible ?? otherTool?.[0];
    if (!quote) continue;
    const tool =
      plausible?.match(/\bPlausible(?: Analytics)?\b/i)?.[0] ?? otherTool?.[1];
    if (!tool) continue;
    const aggregate = /\baggregate traffic\b/i.test(quote);
    const nextSentence = source.excerpt.slice(
      source.excerpt.indexOf(quote) + quote.length,
    );
    const cookieless = nextSentence.match(
      /^\s+(Plausible|Matomo|Umami) does not set cookies or persistent browser identifiers\./i,
    );
    const sameTool =
      cookieless && tool.toLowerCase().startsWith(cookieless[1].toLowerCase());
    return {
      evidenceId: source.id,
      text:
        "The policy describes self-hosted " +
        tool +
        (aggregate ? " for aggregate traffic" : " for site analytics") +
        (sameTool
          ? ", without cookies or persistent browser identifiers."
          : "."),
      quote: quote + (sameTool ? cookieless[0] : ""),
    };
  }
}
