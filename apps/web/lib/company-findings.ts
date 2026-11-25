import type { PublishedScoring } from "@datadeal/contracts";
import type {
  InventoryClassification,
  InventoryPhase,
  RecipientItem,
  StorageItem,
  StorageInventory,
} from "@datadeal/contracts/storage-inventory";
import { getDomain } from "tldts";

export type CompanyPurpose = "advertising" | "analytics" | "needed" | "unknown";
type Cost = NonNullable<
  PublishedScoring["inventoryAssessment"]
>["costs"][number];

export type CompanyFinding = {
  key: string;
  name: string;
  firstParty: boolean;
  purpose: CompanyPurpose;
  /** Largest point cost of any item from this company in the headline visit. */
  cost: number;
  /** The phase that matters most for this company, see phaseRank. */
  timing: InventoryPhase;
  cookies: number;
  otherStorage: number;
  /** Stored items that look like an ID and outlast the visit. */
  lastingIds: number;
  longestExpiry?: NonNullable<StorageItem["expiry"]>;
  received: RecipientItem["fields"];
  linkedIdentifier: boolean;
  domains: string[];
  reason: string;
  citation?: { evidenceId: string; quote: string };
  evidenceIds: string[];
};

const purposeGroup: Record<InventoryClassification["purpose"], CompanyPurpose> =
  {
    advertising: "advertising",
    personalization: "advertising",
    social: "advertising",
    analytics: "analytics",
    essential: "needed",
    security: "needed",
    consent: "needed",
    preferences: "needed",
    support: "needed",
    unknown: "unknown",
  };
const purposeRank: CompanyPurpose[] = [
  "advertising",
  "analytics",
  "unknown",
  "needed",
];
// Before you agree is worse than after; "on use" was never observed.
const phaseRank: InventoryPhase[] = [
  "after_reject",
  "before_choice",
  "after_accept",
  "on_use",
];
const expiryRank = ["within_day", "within_month", "within_year", "over_year"];

const site = (host: string) =>
  getDomain(host, { allowPrivateDomains: true }) ?? host;

export function companyFindings(
  inventory: StorageInventory | undefined,
  costs: readonly Cost[] | undefined,
  homeDomain: string,
  siteName: string,
): CompanyFinding[] {
  if (!inventory?.classifications.length) return [];
  const home = site(homeDomain);
  const byId = new Map(inventory.classifications.map((c) => [c.itemId, c]));
  const costById = new Map((costs ?? []).map((c) => [c.itemId, c.cost]));
  const companies = new Map<string, CompanyFinding>();

  const add = (
    item: StorageItem | RecipientItem,
    host: string | undefined,
    apply: (company: CompanyFinding) => void,
  ) => {
    const c = byId.get(item.id);
    const firstParty =
      (!c?.vendor || c.controller === "first_party") &&
      (!host || site(host) === home);
    const name = firstParty ? siteName : (c?.vendor ?? site(host ?? home));
    const key = name.toLowerCase();
    const purpose = purposeGroup[c?.purpose ?? "unknown"];
    const timing = phaseRank.find((p) => item.phases.includes(p))!;
    const cost = costById.get(item.id) ?? 0;
    let company = companies.get(key);
    if (!company) {
      company = {
        key,
        name,
        firstParty,
        purpose,
        cost,
        timing,
        cookies: 0,
        otherStorage: 0,
        lastingIds: 0,
        received: [],
        linkedIdentifier: false,
        domains: [],
        reason: c?.reason ?? "We couldn't identify what this is for.",
        citation: c?.citation,
        evidenceIds: [],
      };
      companies.set(key, company);
    } else {
      if (
        cost > company.cost ||
        (cost === company.cost &&
          purposeRank.indexOf(purpose) < purposeRank.indexOf(company.purpose))
      ) {
        company.cost = cost;
        company.purpose = purpose;
        if (c) {
          company.reason = c.reason;
          company.citation = c.citation ?? company.citation;
        }
      }
      if (phaseRank.indexOf(timing) < phaseRank.indexOf(company.timing))
        company.timing = timing;
    }
    if (host && !company.domains.includes(site(host)))
      company.domains.push(site(host));
    for (const id of item.evidenceIds)
      if (!company.evidenceIds.includes(id)) company.evidenceIds.push(id);
    apply(company);
  };

  for (const item of inventory.storage)
    add(item, item.scope === "outside_site" ? item.site : undefined, (co) => {
      if (item.mechanism === "cookie") co.cookies++;
      else co.otherStorage++;
      if (item.lifetime === "persistent" && item.value.identifierLike)
        co.lastingIds++;
      if (
        item.expiry &&
        (!co.longestExpiry ||
          expiryRank.indexOf(item.expiry) >
            expiryRank.indexOf(co.longestExpiry))
      )
        co.longestExpiry = item.expiry;
    });
  for (const item of inventory.recipients)
    add(item, item.domain, (co) => {
      for (const field of item.fields)
        if (!co.received.includes(field)) co.received.push(field);
      co.linkedIdentifier ||= item.linkedIdentifier;
    });

  return [...companies.values()].sort(
    (a, b) =>
      b.cost - a.cost ||
      purposeRank.indexOf(a.purpose) - purposeRank.indexOf(b.purpose) ||
      Number(a.firstParty) - Number(b.firstParty) ||
      a.name.localeCompare(b.name),
  );
}

export type RecipientService = {
  vendor: string | null;
  purpose: CompanyPurpose;
  reason: string;
};

/** What each contacted site is, by registrable domain, from the inventory. */
export function recipientServices(inventory: StorageInventory | undefined) {
  const services = new Map<string, RecipientService>();
  if (!inventory) return services;
  const byId = new Map(inventory.classifications.map((c) => [c.itemId, c]));
  for (const item of inventory.recipients) {
    const c = byId.get(item.id);
    if (!c) continue;
    const key = site(item.domain);
    const purpose = purposeGroup[c.purpose];
    const existing = services.get(key);
    if (
      !existing ||
      purposeRank.indexOf(purpose) < purposeRank.indexOf(existing.purpose)
    )
      services.set(key, { vendor: c.vendor, purpose, reason: c.reason });
  }
  return services;
}
