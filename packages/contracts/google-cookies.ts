import { isGoogleCookieFamily, isGoogleCookiePolicy } from "./browser-storage";
import type { Evidence } from "./index";
import type { PracticeEvidence } from "./practice-evidence";

// Only these affirmative clauses support the short public paraphrases.
// A later wording change keeps the measured family but can lose the claim.
const declaredUse = {
  NID: /^The [‘'"]?NID[’'"]? cookie can be used to show ads in Google services for signed-out users\.$/iu,
  SOCS: /^Google uses the [‘'"]?SOCS[’'"]? cookie(?:, which lasts for [\d ]+months,)? to store a user[’']s state regarding their cookies? choices\.$/iu,
  AEC: /^The .{0,100}[‘'"]?AEC[’'"]? cookies are used to detect spam, fraud, and abuse\b.{0,350}\.$/iu,
};

/** A disclosure is local to the captured scan. Neither a stored cookie nor
 * these descriptions prove a request, an actual use or the value of consent. */
export function googleCookieDeclarations(
  fact: PracticeEvidence,
  sources: ReadonlyMap<string, Evidence>,
) {
  const storage = fact.storage;
  if (
    fact.observed !== "storage" ||
    storage?.mechanism !== "cookie" ||
    storage.site !== "google.com" ||
    !isGoogleCookieFamily(storage.family)
  )
    return [];
  const family = storage.family;
  const scanId = sources.get(fact.evidenceIds[0]!)?.scanId;
  if (!scanId) return [];
  const matches: {
    family: typeof family;
    source: Evidence;
    text: string;
    supportsPublicClaim: boolean;
  }[] = [];
  for (const source of sources.values()) {
    if (
      source.scanId !== scanId ||
      source.kind !== "declared_first_party" ||
      source.observation?.type !== "policy_section" ||
      !source.observation.heading ||
      !isGoogleCookiePolicy(source.url)
    )
      continue;
    const sentences = source.excerpt
      .split(/(?<=[.!?])\s+/u)
      .filter(
        (sentence) =>
          sentence.length >= 12 &&
          sentence.length <= 600 &&
          sentence.split(/[^\p{L}\p{N}_-]+/u).includes(family),
      );
    if (!sentences.length) continue;
    const affirmative = sentences.find((sentence) =>
      declaredUse[family].test(sentence),
    );
    matches.push({
      family,
      source,
      text: affirmative ?? sentences[0]!,
      supportsPublicClaim: Boolean(affirmative),
    });
  }
  return matches.sort(
    (a, b) => Number(b.supportsPublicClaim) - Number(a.supportsPublicClaim),
  );
}
