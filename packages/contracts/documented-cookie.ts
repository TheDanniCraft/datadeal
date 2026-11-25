import { googleCookieDeclarations } from "./google-cookies";
import type { Evidence } from "./index";
import { metaCookieDisclosure } from "./meta-cookies";
import type { PracticeEvidence } from "./practice-evidence";

/** The declaration is about the cookie family. Its use in a particular
 * request would require a separate observation linking it to that request. */
export function documentedCookie(
  fact: PracticeEvidence,
  sources: ReadonlyMap<string, Evidence>,
) {
  const storage = fact.storage;
  const visitUrl = sources.get(fact.evidenceIds[0]!)?.url;
  const page = visitUrl && URL.parse(visitUrl);
  if (
    !page ||
    page.protocol !== "https:" ||
    !storage?.site ||
    storage.scope !== "same_site" ||
    storage.mechanism !== "cookie" ||
    (page.hostname !== storage.site &&
      !page.hostname.endsWith("." + storage.site))
  )
    return;
  const meta = metaCookieDisclosure(fact, sources);
  if (meta)
    return {
      ...meta,
      use: "browser_recognition" as const,
      description: `Meta describes ${meta.family} as helping it recognize the browser for security checks.`,
    };
  const google = googleCookieDeclarations(fact, sources).find(
    (c) => c.supportsPublicClaim,
  );
  if (!google) return;
  const uses = {
    NID: [
      "signed_out_ads",
      "Google says NID can be used to show ads to signed-out visitors.",
    ],
    SOCS: [
      "consent",
      "Google says SOCS remembers the visitor’s cookie choices.",
    ],
    AEC: [
      "security",
      "Google describes AEC as helping detect spam, fraud and abuse.",
    ],
  } as const;
  const [use, description] = uses[google.family];
  return { ...google, use, description };
}
