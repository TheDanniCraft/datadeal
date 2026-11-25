import { z } from "zod";

export const practiceScenario = z.enum(["default", "rejected", "accepted"]);
export const scenarioLabel = {
  default: "Before a choice",
  rejected: "After rejecting optional consent",
  accepted: "After accepting all",
} as const;
export const noChoiceVisitLabel = "No cookie choice offered";

const citationIds = z.array(z.string().min(1).max(160)).max(8);
export const practicePurpose = z.enum([
  "consent",
  "security",
  "support",
  "analytics",
  "advertising",
  "other",
  "unknown",
]);
export const practiceRole = z.enum([
  "site_operator",
  "processor",
  "independent",
  "service_controller",
  "unknown",
]);
export const practiceNecessity = z.enum([
  "proportionate",
  "optional",
  "unclear",
]);
export const practiceConfidence = z.enum(["high", "moderate", "low"]);

export const dataPractice = z.strictObject({
  factId: z.string().min(1).max(260),
  scenario: practiceScenario,
  dataClass: z.enum([
    "preference",
    "conversation_id",
    "persistent_browser_id",
    "account_id",
    "contact_details",
    "page_activity",
    "device_information",
    "opaque_id",
    "other",
  ]),
  operation: z.enum([
    "stored",
    "read",
    "transmitted",
    "stored_and_transmitted",
    "declared",
    "attempted",
    "observed_visit",
  ]),
  recipient: z.string().max(253).nullable(),
  role: practiceRole,
  purpose: practicePurpose,
  declaredPurpose: practicePurpose.optional(),
  necessity: practiceNecessity,
  persistence: z.enum(["session", "persistent", "unknown"]),
  scope: z.enum(["same_origin", "same_site", "cross_site", "unknown"]),
  control: z.enum([
    "before_choice",
    "after_reject",
    "after_accept",
    "conditional",
    "unknown",
  ]),
  trigger: z.string().min(1).max(240),
  confidence: practiceConfidence,
  interpretation: z
    .enum(["analyst_reviewed", "observed_only", "source_matched"])
    .optional(),
  linkedIdentifier: z.boolean(),
  evidence: z.strictObject({
    behavior: citationIds,
    context: citationIds,
    link: citationIds,
  }),
  summary: z.string().min(1).max(550),
  significance: z.string().min(1).max(450),
  unknowns: z.array(z.string().min(1).max(280)).max(6),
  mismatch: z.string().min(1).max(400).nullable(),
  contextQuote: z
    .object({ source: z.string(), text: z.string().min(1).max(600) })
    .optional(),
});
export type DataPractice = z.infer<typeof dataPractice>;
