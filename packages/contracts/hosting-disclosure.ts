import type { Evidence } from "./index";

const selfHosting =
  /\b(?:self[\s\p{Pd}]?host(?:ed|ing)?|selbst[\s\p{Pd}]?(?:gehostet\p{L}*|betrieben\p{L}*)|(?:hosten|betreiben) (?:wir )?Plausible(?: Analytics)? selbst|eigenbetrieb|(?:on (?:our|its) own|auf (?:unseren |den )?eigenen) server\p{L}*|host (?:it|Plausible(?: Analytics)?) ourselves)\b/iu;
const uncertain =
  /\b(?:if|might|could|can|would|may|formerly|for example|previously|never|no longer|not|instead of|rather than|unlike|when choosing|wenn|falls|bisher|früher|zum beispiel|könn\p{L}*|nicht|statt|kein\p{L}*)\b/iu;
const actor =
  /\b(?:we (?:use|operate|run|host|self[\s\p{Pd}]?host)|(?:this|our|the) (?:site|website) uses|wir (?:betreiben|nutzen|verwenden|hosten)|(?:diese|unsere) (?:website|webseite) (?:nutzt|verwendet))\b/iu;
const hostedUse =
  /\b(?:we (?:also |separately )?(?:use|pay for)|(?:this|our) (?:site|website) uses|wir (?:nutzen|verwenden)|(?:diese|unsere) (?:website|webseite) (?:nutzt|verwendet))\s+(?:(?:the|die|den) )?Plausible(?: Analytics)?[\s\p{Pd}]+Cloud\b|\b(?:our analytics (?:is|are) hosted by Plausible|unsere (?:webanalyse|analyse) wird von Plausible gehostet)\b/iu;
const scope =
  /\b(?:for|on|für|auf)\s+(?:(?:our|the|unser\p{L}*|der|die|das) )?(?:(?:separate|public|main) )?(docs|documentation|newsletter|blog|shop|store|support (?:site|portal)|booking (?:site|portal)|website|dokumentation|supportportal|[a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/iu;
const sentences = (text: string) =>
  text.split(/(?<=[.!?;])\s+|\n+/u).map((sentence) => sentence.trim());
export const mentionsSelfHosting = (text: string) => selfHosting.test(text);
export const plausibleVendorHost = (host: string) =>
  /(?:^|\.)plausible\.io$/i.test(host);

export function selfHostedPlausible(text: string) {
  const deployment =
    /(?:self[\s\p{Pd}]?host(?:ed)?|selbst[\s\p{Pd}]?(?:gehostet|betrieben)\p{L}*)\s+(?:(?:instance|installation|version) (?:of|von) )?Plausible\b|\bPlausible(?: Analytics)?(?:[\s\p{Pd}]+(?:instance|installation|instanz))?\s+(?:selbst\b|ourselves\b|on (?:our|its) own servers?\b|auf (?:unseren |den )?eigenen server\p{L}*)/iu;
  return sentences(text).find(
    (sentence) =>
      deployment.test(sentence) &&
      selfHosting.test(sentence) &&
      actor.test(sentence) &&
      !uncertain.test(sentence) &&
      !hostedUse.test(sentence),
  );
}

// A product name, endpoint signature, vendor link or Cloud offering is insufficient.
export function declaredPlausibleCloud(text: string) {
  const clauses = sentences(text);
  const negative = clauses.filter(
    (sentence) =>
      /\bPlausible(?: Analytics)?[\s\p{Pd}]+Cloud\b/iu.test(sentence) &&
      uncertain.test(sentence),
  );
  const local = clauses.filter(
    (sentence) => /\bPlausible\b/i.test(sentence) && selfHosting.test(sentence),
  );
  return clauses.find((sentence) => {
    if (
      !hostedUse.test(sentence) ||
      uncertain.test(sentence) ||
      selfHosting.test(sentence)
    )
      return false;
    if (!local.length && !negative.length) return true;
    const feature = scope.exec(sentence)?.[1].toLowerCase();
    if (!feature) return false;
    const sameFeature = (other: string) =>
      scope.exec(other)?.[1].toLowerCase() === feature;
    return (
      !local.some(sameFeature) &&
      !negative.some((other) => !scope.test(other) || sameFeature(other))
    );
  });
}

export function supportsDeclaredHost(host: string, text: string) {
  return !plausibleVendorHost(host) || Boolean(declaredPlausibleCloud(text));
}

// Self-hosting declarations can be quoted in full. A shortened quote or paraphrase
// must not turn the software into a recipient or import another publisher's terms.
export function unsupportedHostingSummary(
  text: string,
  quote: string,
  source: string,
) {
  const selfHosted = selfHostedPlausible(source);
  if (
    !selfHosted ||
    !(
      /\bPlausible\b/i.test(text) ||
      (quote && (quote.includes(selfHosted) || selfHosted.includes(quote)))
    )
  )
    return false;
  if (declaredPlausibleCloud(source) && declaredPlausibleCloud(quote))
    return text !== quote;
  return text !== quote || !quote.includes(selfHosted);
}

// Apply the same rule to historical snapshots, whose host arrays included documentation links.
export function scopedHostingEvidence(evidence: readonly Evidence[]) {
  const sources = new Map(evidence.map((source) => [source.id, source]));
  return evidence.flatMap((source) => {
    const item = source.observation;
    if (
      item?.type === "provider_policy" &&
      plausibleVendorHost(item.providerHost)
    ) {
      const referral = sources.get(item.referringEvidenceId);
      if (
        referral?.kind !== "declared_first_party" ||
        referral.scanId !== source.scanId ||
        !declaredPlausibleCloud(referral.excerpt)
      )
        return [];
    }
    if (
      item?.type === "processing_document" &&
      source.kind === "third_party_reference" &&
      source.url &&
      plausibleVendorHost(new URL(source.url).hostname) &&
      !declaredPlausibleCloud(item.referral?.excerpt ?? "")
    )
      return [];
    if (
      item?.type === "policy_section" &&
      item.providerHosts?.some(
        (host) => !supportsDeclaredHost(host, source.excerpt),
      )
    ) {
      return [
        {
          ...source,
          observation: {
            ...item,
            providerHosts: item.providerHosts.filter((host) =>
              supportsDeclaredHost(host, source.excerpt),
            ),
          },
        },
      ];
    }
    return [source];
  });
}
