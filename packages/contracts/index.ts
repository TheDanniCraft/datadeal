import { z } from "zod";
import { browserStorageSummary } from "./browser-storage";
import { storageInventory } from "./storage-inventory";
import { dataPractice, practiceScenario } from "./data-practice";
export * from "./data-practice";
export * from "./browser-storage";

export const scanStage = z.enum([
  "homepage",
  "sitemap",
  "policy",
  "browser",
  "analysis",
  "publication",
]);
export type ScanStage = z.infer<typeof scanStage>;

export const privacyPreference = z.enum(["standard", "data_minimization"]);
export type PrivacyPreference = z.infer<typeof privacyPreference>;

export const policyTopic = z.enum([
  "collection",
  "purpose",
  "sharing",
  "retention",
  "legal_basis",
  "transfers",
  "rights",
]);
export type PolicyTopic = z.infer<typeof policyTopic>;

const consentOutcome = z.enum([
  "measured",
  "control_unavailable",
  "inconclusive",
  "untested",
]);
const consentCoverage = z.object({
  default: consentOutcome,
  rejected: consentOutcome,
  accepted: consentOutcome,
});
export type ConsentOutcome = z.infer<typeof consentOutcome>;
export type ConsentCoverage = z.infer<typeof consentCoverage>;

export const maxContentPages = 12;
export const contentPageLimit = z.number().int().min(1).max(maxContentPages);

export const domain = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    "Enter a public domain, such as example.com.",
  );

export const states = [
  "requested",
  "queued",
  "discovering",
  "fetching",
  "rendering",
  "extracting",
  "technically_analyzing",
  "ai_analyzing",
  "scoring",
  "completed",
  "partially_completed",
  "failed",
] as const;
export const browserRequestFields = z.object({
  type: z.literal("browser_request_fields"),
  targetDomain: domain,
  scheme: z.enum(["http", "https"]),
  relation: z.enum(["same_origin", "same_site", "cross_site"]),
  method: z.enum(["GET", "POST", "OTHER"]),
  phase: z.enum(["before_choice", "after_choice"]),
  fieldCategories: z
    .array(
      z.enum([
        "page_url",
        "referrer_url",
        "site_domain",
        "event_name",
        "campaign",
        "identifier",
        "advertising_id",
        "email",
        "email_value",
        "email_address_value",
        "phone",
        "screen_size",
        "language",
        "custom_properties",
      ]),
    )
    .max(14),
  sources: z.array(z.enum(["query", "json", "form", "text"])).max(4),
  signature: z
    .enum(["plausible_event", "permutive_event", "meta_pixel_event"])
    .optional(),
  initiator: z
    .enum(["tested_top_level", "same_origin_frame", "outside_frame", "unknown"])
    .optional(),
  // All attempts in this group matched a documented identifier previously
  // sampled in this same isolated visit. Neither value nor digest is exported.
  matchedStorage: z
    .enum(["fbp_cookie", "permutive_cookie", "permutive_local"])
    .optional(),
  // An answered request carried a value found in the final storage sample.
  // This does not establish which came first, or which script wrote it.
  matchedEndStorage: z
    .enum(["fbp_cookie", "permutive_cookie", "permutive_local"])
    .optional(),
  attempts: z.number().int().positive(),
  responses: z.number().int().nonnegative(),
});
export type BrowserRequestFields = z.infer<typeof browserRequestFields>;

// Select the most informative redacted groups when a scan or model input hits its budget.
export function requestEvidencePriority(group: BrowserRequestFields) {
  const fields = group.fieldCategories;
  const contact =
    fields.includes("email_value") ||
    fields.includes("email") ||
    fields.includes("phone");
  const browsing =
    fields.includes("page_url") ||
    fields.includes("referrer_url") ||
    fields.includes("event_name");
  return (
    (contact ? 64 : 0) +
    (fields.includes("advertising_id") ? 32 : 0) +
    (fields.includes("identifier") && browsing ? 16 : 0) +
    (group.signature ? 8 : 0) +
    (group.relation === "cross_site" ? 4 : 0) +
    (group.responses > 0 ? 2 : 0) +
    (group.phase === "after_choice" ? 1 : 0)
  );
}

/** EU/EEA plus Switzerland and the UK: treated as European for scoring. */
export const europeanCountries: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
  "CH",
  "GB",
]);
export const isEuropean = (country: string | undefined) =>
  !!country && europeanCountries.has(country);

/** A company running a site's servers or CDN and its home country. */
export const hostingProvider = z.object({
  name: z.string().min(1).max(120),
  country: z.string().regex(/^(?:[A-Z]{2})?$/),
});
export const browserVisit = z.object({
  freshContext: z.literal(true).optional(),
  capture: z
    .strictObject({
      navigationStartedAt: z.iso.datetime(),
      beforeChoiceSnapshotAt: z.iso.datetime().optional(),
      endSnapshotAt: z.iso.datetime(),
      settleMs: z.number().int().nonnegative().max(60_000),
      identifierComparisonEnabled: z.boolean().optional(),
    })
    .optional(),
  storageSummary: browserStorageSummary.optional(),
  requestInspection: z
    .object({
      examined: z.number().int().nonnegative(),
      matched: z.number().int().nonnegative(),
      limitReached: z.boolean(),
    })
    .optional(),
  finalPageKnown: z.boolean().optional(),
  requests: z.number().int().nonnegative(),
  cookies: z.number().int().nonnegative(),
  storage: z
    .object({
      localEntries: z.number().int().nonnegative(),
      sessionEntries: z.number().int().nonnegative(),
    })
    .optional(),
  externalDomains: z.array(domain).max(20),
  responseDomains: z.array(domain).max(20).optional(),
  afterChoice: z
    .object({
      requests: z.number().int().nonnegative(),
      externalDomains: z.array(domain).max(20),
      acceptedAll: z.boolean().optional(),
    })
    .optional(),
});

export const evidence = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "observed_technical",
    "declared_first_party",
    "declared_processor",
    "inferred_infrastructure",
    "third_party_reference",
    "unknown",
  ]),
  url: z
    .url()
    .refine((url) => /^https?:\/\//i.test(url))
    .optional(),
  excerpt: z.string().min(1),
  documentKind: z
    .enum([
      "privacy",
      "cookies",
      "terms",
      "retention",
      "imprint",
      "contact",
      "other",
    ])
    .optional(),
  documentLayout: z
    .array(
      z.object({
        kind: z.enum(["title", "heading", "paragraph", "item", "metadata"]),
        start: z.number().int().nonnegative().max(3999),
        end: z.number().int().positive().max(4000),
      }),
    )
    .max(100)
    .optional(),
  language: z
    .string()
    .max(35)
    .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i)
    .optional(),
  retrievedAt: z.iso.datetime(),
  scanId: z.string().uuid(),
  hash: z.string().optional(),
  consentScenario: z.enum(["default", "rejected", "accepted"]).optional(),
  observation: z
    .discriminatedUnion("type", [
      browserRequestFields,
      z.object({
        type: z.literal("response_cookie_attributes"),
        count: z.number().int().nonnegative(),
        secure: z.number().int().nonnegative(),
        httpOnly: z.number().int().nonnegative(),
        sameSite: z.number().int().nonnegative(),
      }),
      z.object({
        type: z.literal("html_resource_hosts"),
        hosts: z.array(domain).min(1).max(20),
      }),
      z.object({
        type: z.literal("dns_cname"),
        targets: z.array(domain).min(1).max(6),
      }),
      z.object({
        type: z.literal("hosting"),
        ip: z.union([z.ipv4(), z.ipv6()]).optional(),
        asn: z.number().int().positive().optional(),
        network: z.string().min(1).max(120).optional(),
        networkCountry: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .optional(),
        host: hostingProvider.optional(),
        cdn: hostingProvider.optional(),
      }),
      z.object({
        type: z.literal("policy_section"),
        heading: z.string().min(1).max(140),
        topic: policyTopic.optional(),
        disclosedPreference: z.literal("c15t_choice").optional(),
        providerHosts: z.array(domain).max(5).optional(),
        vendorListing: z
          .object({
            contextEvidenceId: z.string().min(1).max(160),
            policyUrl: z.url().max(400),
          })
          .optional(),
        directoryReferralId: z.string().min(1).max(160).optional(),
      }),
      z.object({
        type: z.literal("provider_policy"),
        providerHost: domain,
        referringEvidenceId: z.string().min(1).max(100),
        heading: z.string().min(1).max(140),
      }),
      z.object({
        type: z.literal("processing_document"),
        document: z.enum(["dpa", "subprocessors"]),
        heading: z.string().min(1).max(180),
        // Present only for a third-party publication explicitly linked by the site's privacy policy.
        referral: z
          .object({
            url: z.url().refine((value) => value.startsWith("https://")),
            excerpt: z.string().min(20).max(580),
          })
          .optional(),
      }),
      browserVisit.extend({
        type: z.literal("browser_consent_counts"),
      }),
      browserVisit.extend({
        type: z.literal("browser_content_page"),
        network: z.array(browserRequestFields).max(24),
      }),
    ])
    .optional(),
});
export const finding = z.object({
  rule: z.enum([
    "policy_available",
    "no_default_browser_storage",
    "no_accept_all_browser_storage",
    "optional_control",
    "independent_ads",
    "external_advertising_field",
    "external_identifier_context",
    "recognized_tracking_storage",
    "external_email_field",
    "declared_advertising_sharing",
    "declared_ad_personalization",
    "sensitive_processing",
    "transfer_risk",
    "necessary_processor",
    "declared_processor",
    "missing_information",
  ]),
  title: z.string(),
  explanation: z.string(),
  confidence: z.enum(["low", "moderate", "high"]),
  severity: z.enum(["positive", "informational", "caution", "critical"]),
  evidenceIds: z.array(z.string()).min(1),
});
const publishedScoring = z.object({
  methodologyVersion: z.string().min(1),
  rulesRevision: z.string().min(1).max(64).optional(),
  noChoiceEvidence: z
    .object({
      policyId: z.string().min(1),
      quote: z.string().min(1).max(350),
      visitIds: z
        .array(z.string().min(1))
        .min(2)
        .max(maxContentPages + 1),
    })
    .optional(),
  baseScore: z.number().int().min(0).max(100).optional(),
  practiceAssessment: z
    .object({
      coverage: z.string().min(1).max(900),
      ratings: z
        .array(
          z.object({
            factId: z.string().min(1).max(260),
            score: z.number().int().min(0).max(100).nullable(),
            reason: z.string().min(1).max(900),
            evidenceIds: z.array(z.string()).max(24),
          }),
        )
        .max(96),
    })
    .optional(),
  // Scoring v2: what each classified storage item or recipient cost.
  inventoryAssessment: z
    .object({
      coverage: z.string().min(1).max(900),
      costs: z
        .array(
          z.object({
            itemId: z.string().min(1).max(40),
            label: z.string().min(1).max(400),
            vendor: z.string().max(80).nullable(),
            cost: z.number().min(0).max(100),
            consentPenalty: z.boolean(),
            outsideEu: z.boolean().optional(),
            kind: z.enum(["item", "hosting", "policy"]).optional(),
            reason: z.string().min(1).max(300),
            evidenceIds: z.array(z.string()).max(8),
          }),
        )
        .max(48),
      classifiedItems: z.number().int().nonnegative(),
      unknownItems: z.number().int().nonnegative(),
      // The arithmetic behind the score, so a reader can follow it exactly.
      breakdown: z
        .object({
          worst: z.number().min(0).max(100),
          others: z.number().min(0).max(100),
          otherItems: z.number().int().nonnegative(),
          raw: z.number().min(0).max(100),
        })
        .optional(),
    })
    .optional(),
  adjustments: z.array(finding.extend({ adjustment: z.number().int() })),
  score: z.number().int().min(0).max(100).nullable(),
  grade: z.enum([
    "Excellent",
    "Good",
    "Mixed",
    "Concerning",
    "Poor",
    "Critical",
    "Unrated",
  ]),
  verdict: z.string().min(1),
  confidence: z.enum(["Moderate", "Low"]),
});
export type PublishedScoring = z.infer<typeof publishedScoring>;
export const policyBrief = z
  .array(
    z.strictObject({
      topic: z.enum(["collection", "sharing", "purpose"]),
      text: z.string().trim().min(1).max(230),
      source: z.string().min(1).max(100),
      quote: z.string().trim().min(18).max(400).optional(),
    }),
  )
  .min(1)
  .max(3);

export const policySummaryAddendum = z.strictObject({
  reviewedAt: z.iso.datetime(),
  model: z.string().trim().min(1).max(160),
  promptVersion: z.string().trim().min(1).max(32),
  items: z
    .array(
      z.strictObject({
        topic: z.enum(["collection", "sharing", "purpose", "retention"]),
        source: z.string().min(1).max(100),
        text: z.string().trim().min(1).max(230),
        quote: z.string().trim().min(18).max(400),
      }),
    )
    .min(1)
    .max(3),
});

export const scanReport = z.object({
  id: z.string().uuid(),
  domain,
  completedAt: z.iso.datetime(),
  demo: z.boolean(),
  partial: z.boolean(),
  consentCoverage: consentCoverage.optional(),
  pageSample: z
    .object({
      discovered: z.number().int().nonnegative(),
      discoveryLimited: z.boolean(),
      limit: contentPageLimit,
      pages: z
        .array(
          z.object({
            url: z.url(),
            source: z.enum(["sitemap", "homepage_link"]),
            coverage: consentCoverage,
          }),
        )
        .max(maxContentPages),
    })
    .optional(),
  favicon: z
    .string()
    .max(32_030)
    .regex(/^data:image\/(?:png|x-icon);base64,[A-Za-z0-9+/]+={0,2}$/)
    .optional(),
  evidence: z.array(evidence),
  findings: z.array(finding),
  preferredPolicyEvidenceId: z.string().min(1).max(100).optional(),
  policyBrief: policyBrief.optional(),
  // A later reading of existing evidence never enters the original score calculation.
  policySummaryAddendum: policySummaryAddendum.optional(),
  policyClaims: z
    .array(
      z.object({
        category: z.enum([
          "data_category",
          "purpose",
          "recipient",
          "retention",
        ]),
        text: z.string().min(1).max(600),
        confidence: finding.shape.confidence,
        source: z.string().min(1).max(100),
        quote: z.string().min(1).max(400),
      }),
    )
    .max(8)
    .optional(),
  scoring: publishedScoring.optional(),
  scoringCorrection: z
    .object({
      correctedAt: z.iso.datetime(),
      reason: z.string().min(1).max(300),
      result: publishedScoring,
      accepted: publishedScoring.optional(),
      rejected: publishedScoring.optional(),
    })
    .optional(),
  acceptAllScoring: publishedScoring.optional(),
  rejectedScoring: publishedScoring.optional(),
  dataPractices: z.array(dataPractice).max(96).optional(),
  // Scoring v2 input: value-free inventory classified by the analyst.
  storageInventory: storageInventory.optional(),
  practiceCoverage: z
    .object({
      facts: z.number().int().nonnegative(),
      retained: z.number().int().nonnegative(),
      analystReviewed: z.number().int().nonnegative(),
      truncated: z.boolean(),
    })
    .optional(),
});
export type ScanReport = z.infer<typeof scanReport>;
export type Evidence = z.infer<typeof evidence>;

export function policySummarySentence(source: Evidence, scanId: string) {
  const section = source.observation;
  if (
    source.scanId !== scanId ||
    source.kind !== "declared_first_party" ||
    section?.type !== "policy_section" ||
    (section.topic !== "collection" && section.topic !== "sharing")
  )
    return undefined;
  return source.excerpt
    .match(
      /^(?:We (?:collect|share) |Wir (?:erheben|übermitteln) |If you use the inquiry form, |The contact page can open )[^.!?]{1,245}\.(?:\s|$)/iu,
    )?.[0]
    .trim();
}
export type Finding = z.infer<typeof finding>;
export type ScanState = (typeof states)[number];

export const domainLookup = z.object({
  domain,
  state: z.enum(states).nullable(),
  latestUnratedScan: z.string().max(36).optional(),
  report: z
    .object({
      demo: z.boolean(),
      scanId: scanReport.shape.id.nullable().optional(),
      partial: z.boolean(),
      completedAt: z.iso.datetime(),
      score: z.number().min(0).max(100).nullable(),
      grade: z.string(),
      headlineScenario: practiceScenario.optional(),
      noChoiceVisit: z.literal(true).optional(),
      beforeChoiceRating: publishedScoring
        .pick({ score: true, grade: true })
        .optional(),
      acceptAllRating: publishedScoring
        .pick({
          score: true,
          grade: true,
          methodologyVersion: true,
          confidence: true,
        })
        .optional(),
      verdict: z.string(),
      policySummary: z.array(z.string().max(230)).min(1).max(2).optional(),
      policyEvidenceIds: z.array(evidence.shape.id).max(3).optional(),
      additionalPolicySummary: z.string().max(230).optional(),
      policyOnly: z.boolean().optional(),
      browserSummary: z.string().max(230).optional(),
      visitorSummary: z
        .array(
          z.object({
            text: z.string().min(1).max(1200),
            evidenceIds: z.array(evidence.shape.id).min(1).max(24),
            evidenceLabels: z
              .array(z.string().min(1).max(160))
              .max(24)
              .optional(),
          }),
        )
        .max(3)
        .optional(),
      browserEvidenceId: evidence.shape.id.optional(),
      practiceTakeaway: z
        .object({
          summary: dataPractice.shape.summary,
          significance: dataPractice.shape.significance,
          evidenceIds: z.array(evidence.shape.id).min(1).max(16),
        })
        .optional(),
      consentTakeaway: z
        .object({
          text: z.string().min(1).max(600),
          evidenceId: evidence.shape.id,
          beforeChoiceEvidenceId: evidence.shape.id.optional(),
        })
        .optional(),
      consentDifference: z
        .object({
          text: z.string().min(1).max(2048),
          acceptedEvidenceId: evidence.shape.id,
          rejectedEvidenceId: evidence.shape.id,
        })
        .optional(),
      contentPageDifference: z
        .object({
          text: z.string().min(1).max(230),
          evidenceId: evidence.shape.id,
        })
        .optional(),
      analyticsDisclosure: z
        .object({ text: z.string().max(230), evidenceId: evidence.shape.id })
        .optional(),
      requestFindings: z
        .array(
          z.object({
            destination: domain,
            text: z.string().max(320),
            scenario: z.enum(["default", "rejected", "accepted"]),
            evidenceId: evidence.shape.id,
          }),
        )
        .max(6)
        .optional(),
      providerDisclosures: z
        .array(
          z.object({
            providerHost: domain,
            section: z.string().max(160),
            excerpt: z.string().max(350).optional(),
            evidenceId: evidence.shape.id,
            referringEvidenceId: evidence.shape.id,
          }),
        )
        .max(4)
        .optional(),
      confidence: z.string(),
      warnings: z.array(z.string()),
      warningEvidenceIds: z.array(evidence.shape.id.nullable()).optional(),
    })
    .nullable(),
});
export type DomainLookup = z.infer<typeof domainLookup>;
export type ConsentTakeaway = NonNullable<
  NonNullable<DomainLookup["report"]>["consentTakeaway"]
>;

export const comparisonQuery = z
  .object({
    left: domain,
    right: domain,
  })
  .refine(({ left, right }) => left !== right, {
    path: ["right"],
    message: "Enter two different domains.",
  });

export function isActiveScan(state: ScanState | null | undefined): boolean {
  return (
    state != null &&
    state !== "completed" &&
    state !== "partially_completed" &&
    state !== "failed"
  );
}
