import type { Evidence } from "./index";
import type { PracticeEvidence } from "./practice-evidence";

// A publisher's list can name a legal entity separately from the paragraph
// describing the list. Preserve both source rows when attributing a purpose.
export function vendorDisclosures(
  fact: PracticeEvidence,
  sources: ReadonlyMap<string, Evidence>,
) {
  const request = fact.request;
  if (!request || request.relation !== "cross_site") return [];
  const visit = sources.get(fact.evidenceIds[0]!);
  if (!visit) return [];
  return [...sources.values()].flatMap((entry) => {
    const section = entry.observation;
    if (
      entry.scanId !== visit.scanId ||
      entry.kind !== "declared_first_party" ||
      section?.type !== "policy_section" ||
      section.topic !== "sharing" ||
      !section.vendorListing ||
      !entry.url
    )
      return [];
    const { contextEvidenceId, policyUrl } = section.vendorListing;
    const context = sources.get(contextEvidenceId);
    if (
      !context ||
      context.id === entry.id ||
      context.scanId !== entry.scanId ||
      context.kind !== "declared_first_party" ||
      context.url !== entry.url ||
      context.observation?.type !== "policy_section" ||
      context.observation.topic !== "sharing" ||
      context.observation.heading !== section.heading ||
      context.observation.vendorListing ||
      !URL.canParse(policyUrl)
    )
      return [];
    const url = new URL(policyUrl);
    if (url.protocol !== "https:" || url.username || url.password) return [];
    const host = url.hostname.toLowerCase();
    const target = request.targetDomain;
    // Permutive's Events API uses permutive.app; its legal site uses permutive.com.
    const permutive =
      request.signature === "permutive_event" &&
      target === "permutive.app" &&
      (host === "permutive.com" || host.endsWith(".permutive.com"));
    const brand = permutive ? "permutive" : target.split(".")[0]!;
    const matchesName =
      brand.length >= 3 &&
      entry.excerpt
        .replace(/(?:https?:\/\/|www\.)\S+/giu, "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}-]+/u)
        .includes(brand);
    if (
      !matchesName ||
      (!permutive && host !== target && !host.endsWith("." + target))
    )
      return [];
    return [{ entry, context }];
  });
}
