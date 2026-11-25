import type { Evidence } from "./index";
import type { PracticeEvidence } from "./practice-evidence";

export const metaCookiePolicy =
  "https://www.facebook.com/privacy/policies/cookies/";
export const metaSecurityHeading = "Security, site and product integrity";
export function metaSecuritySection(url: string) {
  const source = URL.parse(url);
  return (
    source?.origin === "https://www.facebook.com" &&
    !source.username &&
    !source.password &&
    source.pathname.replace(/\/$/, "") === "/privacy/policies/cookies" &&
    source.searchParams.size === 1 &&
    source.searchParams.get("subpage") === "subpage-1.2"
  );
}

// Keep the exact affirmative clause. The name by itself has no purpose or score.
export function metaSecurityQuote(text: string, family: "datr" | "sb") {
  return family === "datr"
    ? text.match(
        /["“]Datr["”] is a unique identifier for your browser that, among(?:st)? other things, helps us protect you from fraud\./i,
      )?.[0]
    : text.match(
        /This includes, for example, our ["“]sb["”] and ["“]dbln["”] cookies, which enable us to identify your browser securely, as well as [“"]datr\.[”"]/i,
      )?.[0];
}

export function metaCookieDisclosure(
  fact: PracticeEvidence,
  sources: ReadonlyMap<string, Evidence>,
) {
  const storage = fact.storage;
  if (
    fact.observed !== "storage" ||
    storage?.mechanism !== "cookie" ||
    storage.site !== "facebook.com" ||
    (storage.family !== "datr" && storage.family !== "sb")
  )
    return;
  const scanId = sources.get(fact.evidenceIds[0]!)?.scanId;
  if (!scanId) return;
  for (const source of sources.values()) {
    if (
      source.scanId !== scanId ||
      source.kind !== "declared_first_party" ||
      source.observation?.type !== "policy_section" ||
      source.observation.heading !== metaSecurityHeading ||
      !source.url ||
      !metaSecuritySection(source.url)
    )
      continue;
    const text = metaSecurityQuote(source.excerpt, storage.family);
    if (text) return { family: storage.family, source, text };
  }
}
