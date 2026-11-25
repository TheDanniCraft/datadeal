import type { Evidence } from "./index";
import type { PracticeEvidence } from "./practice-evidence";

/** The SDK's default category-choice key is `c15t` in the cookie and local
 * storage. A site can override it. Only the exact pair sampled after a real
 * choice can be associated with this origin's declared preference inventory.
 * https://c15t.com/docs/frameworks/javascript/modules/persistence */
export function c15tChoiceDisclosure(
  fact: PracticeEvidence,
  sources: ReadonlyMap<string, Evidence>,
) {
  const storage = fact.storage;
  if (
    fact.request ||
    fact.observed !== "storage" ||
    storage?.family !== "c15t" ||
    storage.scope !== "same_site" ||
    storage.snapshot !== "end" ||
    !["after_accept", "after_reject"].includes(fact.trigger) ||
    !["cookie", "local_storage"].includes(storage.mechanism)
  )
    return;
  const visit = sources.get(fact.evidenceIds[0]!);
  const o = visit?.observation;
  if (
    !visit?.url ||
    !o ||
    (o.type !== "browser_consent_counts" &&
      o.type !== "browser_content_page") ||
    !o.freshContext ||
    !o.finalPageKnown ||
    !o.afterChoice ||
    (fact.scenario === "accepted"
      ? o.afterChoice.acceptedAll !== true
      : fact.scenario !== "rejected" || o.afterChoice.acceptedAll === true)
  )
    return;
  const before = o.storageSummary?.beforeChoice,
    end = o.storageSummary?.end;
  if (
    !end?.web?.local.categories.includes("c15t_key") ||
    !end.cookies.recognized.some(
      (c) => c.name === "c15t" && c.scope === "same_site" && !c.httpOnly,
    ) ||
    !before?.web ||
    before.cookies.inspected !== before.cookies.total ||
    before.web.local.inspected !== before.web.local.total ||
    before.web.local.categories.includes("c15t_key") ||
    before.cookies.recognized.some(
      (c) => c.name === "c15t" && c.scope === "same_site",
    )
  )
    return;
  const origin = new URL(visit.url).origin;
  const rows = [...sources.values()].filter(
    (source) =>
      source.scanId === visit.scanId &&
      source.kind === "declared_first_party" &&
      source.url &&
      new URL(source.url).origin === origin &&
      source.observation?.type === "policy_section" &&
      source.observation.disclosedPreference === "c15t_choice" &&
      source.excerpt.length <= 500,
  );
  return rows.length === 1 ? rows[0] : undefined;
}
