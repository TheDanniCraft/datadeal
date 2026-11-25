import type { PublishedScoring, ScanReport } from "@datadeal/contracts";
import type {
  InventoryClassification,
  InventoryPhase,
  RecipientItem,
  StorageInventory,
  StorageItem,
} from "@datadeal/contracts/storage-inventory";
import { gradeForScore, methodologyVersion } from "./grades";

export const inventoryRulesRevision = "contextual-practices-6";
type Scenario = "default" | "rejected" | "accepted";

/** Costs from docs/scoring-v2.md. The analyst classifies; these numbers decide. */
export const inventoryCosts = {
  proportionate: 0,
  contractAnalytics: 3,
  unknownIdentifier: 4,
  advertisingStorage: 5,
  independentRecipient: 8,
  analyticsId: 10,
  advertisingId: 15,
  linkedAdvertising: 25,
  contactAdvertising: 35,
} as const;
export const consentPenalty = 1.5;
const proportionatePurposes = new Set([
  "essential",
  "security",
  "consent",
  "preferences",
  "support",
]);
const advertisingPurposes = new Set([
  "advertising",
  "social",
  "personalization",
]);
const scenarioPhases: Record<Scenario, InventoryPhase[]> = {
  default: ["before_choice"],
  rejected: ["before_choice", "after_reject"],
  accepted: ["before_choice", "after_reject", "after_accept"],
};

type Cost = {
  itemId: string;
  label: string;
  vendor: string | null;
  cost: number;
  // Cost before the consent penalty; decides which practice it was.
  baseCost: number;
  consentPenalty: boolean;
  reason: string;
  evidenceIds: string[];
  unknown: boolean;
};

function storageCost(item: StorageItem, c?: InventoryClassification) {
  const persistentId =
    item.lifetime === "persistent" && item.value.identifierLike;
  const purpose = c?.purpose ?? "unknown";
  if (proportionatePurposes.has(purpose)) return inventoryCosts.proportionate;
  if (purpose === "analytics")
    return persistentId
      ? inventoryCosts.analyticsId
      : inventoryCosts.contractAnalytics;
  if (advertisingPurposes.has(purpose))
    return persistentId
      ? inventoryCosts.advertisingId
      : inventoryCosts.advertisingStorage;
  return persistentId ? inventoryCosts.unknownIdentifier : 0;
}

function recipientCost(item: RecipientItem, c?: InventoryClassification) {
  const purpose = c?.purpose ?? "unknown";
  const controller = c?.controller ?? "unknown";
  const tracking =
    advertisingPurposes.has(purpose) || controller === "independent";
  if (tracking && item.fields.includes("email"))
    return inventoryCosts.contactAdvertising;
  if (
    advertisingPurposes.has(purpose) &&
    (item.linkedIdentifier ||
      item.fields.includes("identifier") ||
      item.fields.includes("advertising_id"))
  )
    return inventoryCosts.linkedAdvertising;
  if (proportionatePurposes.has(purpose) && controller !== "independent")
    return inventoryCosts.proportionate;
  if (purpose === "analytics" && controller !== "independent")
    return inventoryCosts.contractAnalytics;
  if (tracking || purpose === "analytics")
    return inventoryCosts.independentRecipient;
  return purpose === "unknown" && controller === "unknown"
    ? inventoryCosts.unknownIdentifier
    : 0;
}

const proxyLabels = {
  plausible: "Plausible",
  permutive: "Permutive",
  meta: "Meta",
} as const;

const storageLabel = (item: StorageItem) =>
  `${item.mechanism === "cookie" ? "Cookie" : item.mechanism === "local_storage" ? "Local storage" : "Session storage"} ${item.name}${item.site ? " (" + item.site + ")" : ""}`;

/** Breadth weights: full, half, quarter, … but never below a tenth. */
export function combineCosts(costs: readonly number[]) {
  return [...costs]
    .sort((a, b) => b - a)
    .reduce(
      (total, cost, index) => total + cost * Math.max(0.5 ** index, 0.1),
      0,
    );
}

export function inventoryCostsFor(
  inventory: StorageInventory,
  scenario: Scenario,
): Cost[] {
  const phases = scenarioPhases[scenario];
  const byId = new Map(inventory.classifications.map((c) => [c.itemId, c]));
  const costs: Cost[] = [];
  const add = (
    item: StorageItem | RecipientItem,
    label: string,
    base: number,
  ) => {
    const c = byId.get(item.id);
    if (!item.phases.some((phase) => phases.includes(phase))) return;
    const withoutConsent =
      base > 0 &&
      item.phases.some((p) => p === "before_choice" || p === "after_reject");
    costs.push({
      itemId: item.id,
      label,
      vendor: c?.vendor ?? null,
      cost: withoutConsent ? base * consentPenalty : base,
      baseCost: base,
      consentPenalty: withoutConsent,
      reason: c?.reason ?? "Not classified.",
      evidenceIds: [
        ...item.evidenceIds,
        ...(c?.citation ? [c.citation.evidenceId] : []),
      ].slice(0, 8),
      unknown: !c || c.purpose === "unknown",
    });
  };
  for (const item of inventory.storage)
    add(item, storageLabel(item), storageCost(item, byId.get(item.id)));
  for (const item of inventory.recipients)
    add(
      item,
      item.via
        ? `${proxyLabels[item.via.vendor]} event forwarded via ${item.domain}`
        : "Data sent to " + item.domain,
      recipientCost(item, byId.get(item.id)),
    );
  return costs.sort((a, b) => b.cost - a.cost);
}

function verdictFor(costs: Cost[]) {
  // Compare practices by their base cost: a 50% consent penalty must not
  // turn a linked ad ID (25 → 37.5) into the email case (35).
  const worst = Math.max(0, ...costs.map(({ baseCost }) => baseCost));
  const before = costs.some((c) => c.consentPenalty && c.cost > 0);
  if (worst >= inventoryCosts.contactAdvertising)
    return "An email-shaped value reached an advertising company.";
  if (worst >= inventoryCosts.linkedAdvertising)
    return before
      ? "Shares browser IDs with advertising companies, some before you agree."
      : "Shares browser IDs with advertising companies once you accept.";
  if (worst >= inventoryCosts.advertisingId)
    return "Sets advertising or social media identifiers in your browser.";
  if (worst >= inventoryCosts.analyticsId)
    return "Measures visits with a persistent visitor ID.";
  if (worst > 0)
    return "Mostly functional, with some measurement or outside services.";
  return "Only what the site needs to work: no tracking found.";
}

/** Scoring v2 rating for one scenario, or undefined if not classified. */
export function inventoryRating(
  report: Pick<ScanReport, "storageInventory">,
  scenario: Scenario,
): PublishedScoring | undefined {
  const inventory = report.storageInventory;
  if (!inventory) return undefined;
  const itemCount = inventory.storage.length + inventory.recipients.length;
  if (itemCount && !inventory.classifications.length) return undefined;
  const costs = inventoryCostsFor(inventory, scenario);
  const score = Math.max(
    0,
    Math.round(100 - combineCosts(costs.map(({ cost }) => cost))),
  );
  const unknown = costs.filter((c) => c.unknown).length;
  const classified = inventory.classifications.length;
  const confidence =
    !inventory.truncated &&
    classified >= itemCount * 0.9 &&
    unknown <= Math.max(2, costs.length * 0.25)
      ? "Moderate"
      : "Low";
  return {
    methodologyVersion,
    rulesRevision: inventoryRulesRevision,
    score,
    grade: gradeForScore(score),
    verdict: verdictFor(costs),
    confidence,
    adjustments: [],
    inventoryAssessment: {
      coverage: `Based on ${inventory.storage.length} storage ${inventory.storage.length === 1 ? "item" : "items"} and ${inventory.recipients.length} outside ${inventory.recipients.length === 1 ? "recipient" : "recipients"} measured on the tested pages${inventory.research.length ? `, with ${inventory.research.length} vendor ${inventory.research.length === 1 ? "policy" : "policies"} researched` : ""}. ${unknown ? `${unknown} could not be identified and lower the confidence.` : "Every item was identified."}`,
      costs: costs
        .filter(({ cost }) => cost > 0)
        .slice(0, 48)
        .map(({ unknown: _u, baseCost: _b, ...c }) => ({
          ...c,
          cost: Math.round(c.cost * 10) / 10,
        })),
      classifiedItems: classified,
      unknownItems: unknown,
    },
  };
}
