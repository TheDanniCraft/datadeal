import { isEuropean } from "@datadeal/contracts";
import type { PublishedScoring, ScanReport } from "@datadeal/contracts";
import type {
  InventoryClassification,
  InventoryPhase,
  RecipientItem,
  StorageInventory,
  StorageItem,
} from "@datadeal/contracts/storage-inventory";
import { gradeForScore, methodologyVersion } from "./grades";

export const inventoryRulesRevision = "contextual-practices-8";
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
/** A recipient company based outside the EU/EEA, Switzerland or the UK. */
export const outsideEuFactor = 1.25;
/** Hosting or a CDN outside Europe: needed to run the site, so a small cost. */
export const outsideEuHosting = 4;
/** The EU requires a privacy policy; a site without one cannot be read. */
export const missingPolicyCost = 15;
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
  accepted: ["before_choice", "after_reject", "after_accept", "on_use"],
};
/** Breadth: a bounded, logarithmic penalty for everything after the worst. */
export const breadth = { perDoubling: 6, cap: 30, unit: 10 } as const;
/** How much of the distance from 50 the coverage of a scan supports. */
export const coverageWeights = {
  rejectUntested: 0.93,
  homepageOnly: 0.9,
  oneSampledPage: 0.94,
  severalSampledPages: 0.97,
  featuresUntested: 0.97,
  captureLimited: 0.95,
  unknownShare: 0.3,
} as const;

type Cost = {
  itemId: string;
  label: string;
  vendor: string | null;
  cost: number;
  // Cost before the consent penalty; decides which practice it was.
  baseCost: number;
  consentPenalty: boolean;
  outsideEu?: boolean;
  kind?: "item" | "hosting" | "policy";
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

const declaredOnly = (item: RecipientItem) =>
  item.phases.length === 1 && item.phases[0] === "on_use";

function recipientCost(item: RecipientItem, c?: InventoryClassification) {
  if (declaredOnly(item)) {
    // Named in the policy for a feature the visitor chooses to use; the
    // passive visit could not observe what it receives.
    const observed = observedRecipientCost(item, c);
    return observed === 0 ? 1 : observed / 2;
  }
  return observedRecipientCost(item, c);
}

function observedRecipientCost(
  item: RecipientItem,
  c?: InventoryClassification,
) {
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

/**
 * The worst practice counts in full. Everything else adds a logarithmic,
 * capped penalty: more trackers are worse, each extra one matters less,
 * and count alone cannot push a site to zero.
 */
export function combineCosts(costs: readonly number[]) {
  const [worst = 0, ...rest] = [...costs].sort((a, b) => b - a);
  const others = rest.reduce((sum, cost) => sum + cost, 0);
  return (
    worst +
    Math.min(
      breadth.cap,
      breadth.perDoubling * Math.log2(1 + others / breadth.unit),
    )
  );
}

type CoverageInput = Pick<
  ScanReport,
  "consentCoverage" | "pageSample" | "evidence" | "id"
>;

/**
 * Share of the distance from the midpoint (50) that the evidence supports.
 * A scan that saw less cannot claim a perfect or a hopeless result.
 */
export function scanCoverage(
  report: Partial<CoverageInput>,
  inventory: StorageInventory,
  unknownShare: number,
) {
  const w = coverageWeights;
  const reasons: string[] = [];
  let c = 1;
  if (report.consentCoverage?.rejected !== "measured") {
    c *= w.rejectUntested;
    reasons.push("the reject option couldn't be tested");
  }
  const sampled =
    report.pageSample?.pages.filter((p) => p.coverage.accepted === "measured")
      .length ?? 0;
  c *=
    sampled === 0
      ? w.homepageOnly
      : sampled === 1
        ? w.oneSampledPage
        : w.severalSampledPages;
  const pages =
    sampled === 0
      ? "We tested the homepage only."
      : `We tested the homepage and ${sampled} other ${sampled === 1 ? "page" : "pages"}.`;
  if (inventory.recipients.some(declaredOnly)) {
    c *= w.featuresUntested;
    reasons.push("features named in the policy weren't tried");
  }
  const limited =
    inventory.truncated ||
    (report.evidence ?? []).some(
      (e) =>
        e.scanId === report.id &&
        (e.observation?.type === "browser_consent_counts" ||
          e.observation?.type === "browser_content_page") &&
        e.observation.requestInspection?.limitReached,
    );
  if (limited) {
    c *= w.captureLimited;
    reasons.push("some traffic was too large to inspect fully");
  }
  c *= 1 - w.unknownShare * unknownShare;
  return { coverage: c, reasons, pages };
}

type HostingInput = Pick<ScanReport, "evidence" | "id" | "findings">;

export function inventoryCostsFor(
  inventory: StorageInventory,
  scenario: Scenario,
  report?: Partial<HostingInput>,
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
    const outsideEu = base > 0 && c?.jurisdiction === "non_eu";
    costs.push({
      itemId: item.id,
      label,
      vendor: c?.vendor ?? null,
      cost:
        base *
        (withoutConsent ? consentPenalty : 1) *
        (outsideEu ? outsideEuFactor : 1),
      baseCost: base,
      consentPenalty: withoutConsent,
      ...(outsideEu && { outsideEu }),
      kind: "item",
      reason: c?.reason ?? "Not classified.",
      evidenceIds: [
        ...new Set([
          ...item.evidenceIds,
          ...(c?.citation ? [c.citation.evidenceId] : []),
        ]),
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
        : declaredOnly(item)
          ? `When you use a feature: ${item.domain} (named in the privacy policy)`
          : "Data sent to " + item.domain,
      recipientCost(item, byId.get(item.id)),
    );
  const hosting = report?.evidence?.find(
    (e) => e.scanId === report.id && e.observation?.type === "hosting",
  );
  if (hosting?.observation?.type === "hosting") {
    const { host, cdn } = hosting.observation;
    for (const [role, provider] of [
      ["Hosting", host],
      ["CDN", cdn],
    ] as const) {
      if (!provider?.country || isEuropean(provider.country)) continue;
      costs.push({
        itemId: "hosting-" + role.toLowerCase(),
        label: `${role}: ${provider.name} (${provider.country})`,
        vendor: provider.name,
        cost: outsideEuHosting,
        baseCost: outsideEuHosting,
        consentPenalty: false,
        outsideEu: true,
        kind: "hosting",
        reason:
          role === "CDN"
            ? `Every visit passes through ${provider.name}, a company based outside the EU.`
            : `The site's servers run on ${provider.name}'s network, a company based outside the EU.`,
        evidenceIds: [hosting.id],
        unknown: false,
      });
    }
  }
  if (
    report?.findings &&
    !report.findings.some(({ rule }) => rule === "policy_available")
  )
    costs.push({
      itemId: "policy-missing",
      label: "No privacy policy found",
      vendor: null,
      cost: missingPolicyCost,
      baseCost: missingPolicyCost,
      consentPenalty: false,
      kind: "policy",
      reason:
        "We couldn't find a privacy policy, which EU law requires. Nothing explains what the site does with your data.",
      evidenceIds: [],
      unknown: false,
    });
  return costs.sort((a, b) => b.cost - a.cost);
}

function verdictFor(all: Cost[]) {
  const missingPolicy = all.some(({ kind }) => kind === "policy");
  const verdict = itemVerdict(
    all.filter(({ kind }) => !kind || kind === "item"),
  );
  return missingPolicy ? verdict + " No privacy policy found." : verdict;
}

function itemVerdict(costs: Cost[]) {
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
  report: Pick<ScanReport, "storageInventory"> &
    Partial<CoverageInput> &
    Partial<HostingInput>,
  scenario: Scenario,
): PublishedScoring | undefined {
  const inventory = report.storageInventory;
  if (!inventory) return undefined;
  const itemCount = inventory.storage.length + inventory.recipients.length;
  if (itemCount && !inventory.classifications.length) return undefined;
  const costs = inventoryCostsFor(inventory, scenario, report);
  const raw = Math.max(0, 100 - combineCosts(costs.map(({ cost }) => cost)));
  const unknown = costs.filter((c) => c.unknown).length;
  const classified = inventory.classifications.length;
  const { coverage, reasons, pages } = scanCoverage(
    report,
    inventory,
    costs.length ? unknown / costs.length : 0,
  );
  const score = Math.round(50 + (raw - 50) * coverage);
  const confidence =
    coverage >= 0.85 && classified >= itemCount * 0.9 ? "Moderate" : "Low";
  return {
    methodologyVersion,
    rulesRevision: inventoryRulesRevision,
    score,
    grade: gradeForScore(score),
    verdict: verdictFor(costs),
    confidence,
    adjustments: [],
    inventoryAssessment: {
      coverage: [
        pages,
        reasons.length &&
          reasons.join(", and ").replace(/^./, (c) => c.toUpperCase()) + ".",
        unknown > 0 &&
          `${unknown} ${unknown === 1 ? "item" : "items"} couldn't be identified.`,
      ]
        .filter(Boolean)
        .join(" "),
      costs: costs
        .filter(({ cost }) => cost > 0)
        .slice(0, 48)
        .map(({ unknown: _u, baseCost: _b, ...c }) => ({
          ...c,
          cost: Math.round(c.cost * 10) / 10,
        })),
      classifiedItems: classified,
      unknownItems: unknown,
      breakdown: {
        worst: Math.round((costs[0]?.cost ?? 0) * 10) / 10,
        others:
          Math.round(
            (combineCosts(costs.map(({ cost }) => cost)) -
              (costs[0]?.cost ?? 0)) *
              10,
          ) / 10,
        otherItems: costs.filter(({ cost }) => cost > 0).length
          ? costs.filter(({ cost }) => cost > 0).length - 1
          : 0,
        raw: Math.round(raw * 10) / 10,
      },
    },
  };
}
