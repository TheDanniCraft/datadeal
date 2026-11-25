import { z } from "zod";
import { getDomain } from "tldts";
import {
  storageNamePattern,
  storageValueSignal,
  type BrowserStorageSnapshot,
  type StorageValueSignal,
} from "./browser-storage";
import { practiceConfidence } from "./data-practice";
import type { Evidence, ScanReport } from "./index";

/**
 * Scoring v2 works on an inventory: every unique storage item and every outside
 * recipient seen during the measured visits, each classified once. The
 * inventory is value-free: it holds masked names and coarse value shapes.
 */
export const inventoryPhase = z.enum([
  "before_choice",
  "after_reject",
  "after_accept",
]);
export type InventoryPhase = z.infer<typeof inventoryPhase>;
const site = z
  .string()
  .max(253)
  .regex(/^[a-z0-9.-]+$/);
const ids = z.array(z.string().min(1).max(160)).min(1).max(8);

export const storageItem = z.strictObject({
  id: z.string().regex(/^st-[0-9a-f]{12}$/),
  mechanism: z.enum(["cookie", "local_storage", "session_storage"]),
  name: storageNamePattern,
  site: site.optional(),
  scope: z.enum(["same_site", "outside_site", "unknown"]),
  lifetime: z.enum(["session", "persistent"]),
  expiry: z
    .enum(["within_day", "within_month", "within_year", "over_year"])
    .optional(),
  value: storageValueSignal,
  phases: z.array(inventoryPhase).min(1).max(3),
  evidenceIds: ids,
});
export type StorageItem = z.infer<typeof storageItem>;

export const recipientFields = z.enum([
  "identifier",
  "advertising_id",
  "email",
  "page_url",
  "event_name",
]);
export const recipientItem = z.strictObject({
  id: z.string().regex(/^rc-[0-9a-f]{12}$/),
  domain: site,
  phases: z.array(inventoryPhase).min(1).max(3),
  // Field categories observed in request bodies or queries, never values.
  fields: z.array(recipientFields).max(5),
  // A value from browser storage reappeared in a request to this recipient.
  linkedIdentifier: z.boolean(),
  answered: z.boolean(),
  evidenceIds: ids,
});
export type RecipientItem = z.infer<typeof recipientItem>;

export const inventoryPurpose = z.enum([
  "essential",
  "security",
  "consent",
  "preferences",
  "support",
  "analytics",
  "advertising",
  "personalization",
  "social",
  "unknown",
]);
export const inventoryController = z.enum([
  "first_party",
  "processor",
  "independent",
  "unknown",
]);
export const inventoryClassification = z.strictObject({
  itemId: z.string().regex(/^(?:st|rc)-[0-9a-f]{12}$/),
  purpose: inventoryPurpose,
  controller: inventoryController,
  vendor: z.string().trim().min(1).max(80).nullable(),
  confidence: practiceConfidence,
  reason: z.string().trim().min(1).max(280),
  basis: z.enum(["known_convention", "site_policy", "vendor_policy", "none"]),
  // Required for site_policy and vendor_policy: an exact quote from evidence.
  citation: z
    .strictObject({
      evidenceId: z.string().min(1).max(160),
      quote: z.string().trim().min(12).max(400),
    })
    .optional(),
});
export type InventoryClassification = z.infer<typeof inventoryClassification>;

export const storageInventory = z.strictObject({
  version: z.literal(1),
  storage: z.array(storageItem).max(240),
  recipients: z.array(recipientItem).max(80),
  truncated: z.boolean(),
  classifications: z.array(inventoryClassification).max(320),
  research: z
    .array(
      z.strictObject({
        domain: site,
        status: z.enum(["fetched", "unavailable"]),
        evidenceIds: z.array(z.string().min(1).max(160)).max(4),
      }),
    )
    .max(3),
  model: z.string().min(1).max(160).optional(),
  promptVersion: z.string().min(1).max(32).optional(),
});
export type StorageInventory = z.infer<typeof storageInventory>;

function shortHash(text: string) {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++)
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n,
    );
  return hash.toString(16).padStart(16, "0").slice(0, 12);
}

const shapeRank = (value: StorageValueSignal) =>
  (value.identifierLike ? 4 : 0) +
  ["empty", "short", "medium", "long"].indexOf(value.length);
const phaseOrder = inventoryPhase.options;

type Visit = Extract<
  NonNullable<Evidence["observation"]>,
  { type: "browser_consent_counts" | "browser_content_page" }
>;

function endPhase(scenario: Evidence["consentScenario"]): InventoryPhase {
  return scenario === "accepted"
    ? "after_accept"
    : scenario === "rejected"
      ? "after_reject"
      : "before_choice";
}

/** Builds the value-free inventory of one scan's measured visits. */
export function buildStorageInventory(
  report: Pick<ScanReport, "id" | "domain" | "evidence">,
): Omit<StorageInventory, "classifications" | "research"> {
  const homeSite = getDomain(report.domain, { allowPrivateDomains: true });
  const storage = new Map<string, StorageItem>();
  const recipients = new Map<string, RecipientItem>();
  const merge = <T extends { phases: InventoryPhase[]; evidenceIds: string[] }>(
    target: T,
    phase: InventoryPhase,
    evidenceId: string,
  ) => {
    if (!target.phases.includes(phase))
      target.phases = phaseOrder.filter(
        (p) => p === phase || target.phases.includes(p),
      );
    if (
      target.evidenceIds.length < 8 &&
      !target.evidenceIds.includes(evidenceId)
    )
      target.evidenceIds.push(evidenceId);
  };
  function addStorage(
    entry: Omit<StorageItem, "id" | "phases" | "evidenceIds">,
    phase: InventoryPhase,
    evidenceId: string,
  ) {
    const key = JSON.stringify([entry.mechanism, entry.name, entry.site]);
    const existing = storage.get(key);
    if (existing) {
      if (shapeRank(entry.value) > shapeRank(existing.value))
        existing.value = entry.value;
      if (entry.lifetime === "persistent") {
        existing.lifetime = "persistent";
        existing.expiry ??= entry.expiry;
      }
      merge(existing, phase, evidenceId);
      return;
    }
    storage.set(key, {
      id: "st-" + shortHash(key),
      ...entry,
      phases: [phase],
      evidenceIds: [evidenceId],
    });
  }
  function addSnapshot(
    snapshot: BrowserStorageSnapshot,
    phase: InventoryPhase,
    evidenceId: string,
  ) {
    for (const cookie of snapshot.cookies.named ?? [])
      addStorage(
        {
          mechanism: "cookie",
          name: cookie.name,
          ...(cookie.site && { site: cookie.site }),
          scope: cookie.scope,
          lifetime: cookie.persistent ? "persistent" : "session",
          ...(cookie.expiry && { expiry: cookie.expiry }),
          value: cookie.value,
        },
        phase,
        evidenceId,
      );
    for (const mechanism of ["local", "session"] as const)
      for (const key of snapshot.web?.[mechanism].keys ?? [])
        addStorage(
          {
            mechanism:
              mechanism === "local" ? "local_storage" : "session_storage",
            name: key.name,
            ...(homeSite && { site: homeSite }),
            scope: "same_site",
            lifetime: mechanism === "local" ? "persistent" : "session",
            value: key.value,
          },
          phase,
          evidenceId,
        );
  }
  function addRecipient(
    domain: string,
    phase: InventoryPhase,
    evidenceId: string,
    detail?: {
      fields: RecipientItem["fields"];
      linked: boolean;
      answered: boolean;
    },
  ) {
    const owner = getDomain(domain, { allowPrivateDomains: true }) ?? domain;
    if (homeSite && owner === homeSite) return;
    const existing = recipients.get(owner);
    const target =
      existing ??
      ({
        id: "rc-" + shortHash(owner),
        domain: owner,
        phases: [phase],
        fields: [],
        linkedIdentifier: false,
        answered: false,
        evidenceIds: [evidenceId],
      } satisfies RecipientItem);
    if (existing) merge(existing, phase, evidenceId);
    else recipients.set(owner, target);
    if (detail) {
      target.fields = recipientFields.options.filter(
        (f) => target.fields.includes(f) || detail.fields.includes(f),
      );
      target.linkedIdentifier ||= detail.linked;
      target.answered ||= detail.answered;
    }
  }

  for (const source of report.evidence) {
    if (source.scanId !== report.id || source.kind !== "observed_technical")
      continue;
    const observation = source.observation;
    if (!observation || !source.consentScenario) continue;
    if (
      observation.type === "browser_consent_counts" ||
      observation.type === "browser_content_page"
    ) {
      const visit = observation as Visit;
      const after = endPhase(source.consentScenario);
      const summary = visit.storageSummary;
      if (summary?.beforeChoice)
        addSnapshot(summary.beforeChoice, "before_choice", source.id);
      if (summary) addSnapshot(summary.end, after, source.id);
      // Without an after-choice split, everything counts as before the choice.
      for (const domain of visit.externalDomains)
        addRecipient(
          domain,
          visit.afterChoice ? "before_choice" : after,
          source.id,
        );
      for (const domain of visit.afterChoice?.externalDomains ?? [])
        addRecipient(domain, after, source.id);
      if (observation.type === "browser_content_page")
        for (const request of observation.network)
          addRecipient(
            request.targetDomain,
            request.phase === "before_choice" ? "before_choice" : after,
            source.id,
            {
              fields: request.fieldCategories.flatMap((category) =>
                category === "email_value" || category === "email_address_value"
                  ? ["email" as const]
                  : recipientFields.safeParse(category).success
                    ? [category as RecipientItem["fields"][number]]
                    : [],
              ),
              linked: Boolean(
                request.matchedStorage ?? request.matchedEndStorage,
              ),
              answered: request.responses > 0,
            },
          );
    } else if (observation.type === "browser_request_fields") {
      addRecipient(
        observation.targetDomain,
        observation.phase === "before_choice"
          ? "before_choice"
          : endPhase(source.consentScenario),
        source.id,
        {
          fields: observation.fieldCategories.flatMap((category) =>
            category === "email_value" || category === "email_address_value"
              ? ["email" as const]
              : recipientFields.safeParse(category).success
                ? [category as RecipientItem["fields"][number]]
                : [],
          ),
          linked: Boolean(
            observation.matchedStorage ?? observation.matchedEndStorage,
          ),
          answered: observation.responses > 0,
        },
      );
    }
  }
  const storageItems = [...storage.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const recipientItems = [...recipients.values()].sort((a, b) =>
    a.domain.localeCompare(b.domain),
  );
  return {
    version: 1,
    storage: storageItems.slice(0, 240),
    recipients: recipientItems.slice(0, 80),
    truncated: storageItems.length > 240 || recipientItems.length > 80,
  };
}
