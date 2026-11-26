import { createHmac, randomBytes } from "node:crypto";

const permutiveId = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const pixelId = /^fb\.\d{1,2}\.\d{13}\.\d{1,20}$/;
type Marker = "fbp_cookie" | "permutive_cookie" | "permutive_local";

// Only the crawler's fresh context uses this matcher. Request-side equality
// is checked against a sample taken earlier in this visit. The keyed digest
// and its per-visit key never enter a report or cross context boundaries.
export function isolatedIdentifierMatcher() {
  const key = randomBytes(32);
  const markers = new Map<Marker, Set<string>>();
  const endMarkers = new Map<Marker, Set<string>>();
  const digest = (value: string) =>
    createHmac("sha256", key).update(value).digest("hex");
  return {
    sample(kind: Marker, value: string, atEnd = false) {
      if (!(kind === "fbp_cookie" ? pixelId : permutiveId).test(value)) return;
      const snapshot = atEnd ? endMarkers : markers;
      const seen = snapshot.get(kind) ?? new Set<string>();
      if (seen.size < 8) seen.add(digest(value));
      snapshot.set(kind, seen);
    },
    // The collector keeps a bounded set of these keyed digests only for
    // answered requests to known event endpoints. They never leave this visit.
    eventDigest(value: string) {
      if (pixelId.test(value) || permutiveId.test(value)) return digest(value);
    },
    endMatch(
      digest: string,
      signature: "meta_pixel_event" | "permutive_event",
    ) {
      const kinds =
        signature === "meta_pixel_event"
          ? (["fbp_cookie"] as const)
          : (["permutive_cookie", "permutive_local"] as const);
      return kinds.find((k) => endMarkers.get(k)?.has(digest));
    },
    match(kind: Marker, value: string) {
      return (
        (kind === "fbp_cookie" ? pixelId : permutiveId).test(value) &&
        markers.get(kind)?.has(digest(value)) === true
      );
    },
    clear() {
      markers.clear();
      endMarkers.clear();
      key.fill(0);
    },
  };
}
export type IsolatedIdentifierMatcher = ReturnType<
  typeof isolatedIdentifierMatcher
>;

// Serialized by Playwright. Only one documented public SDK marker is read.
export function readPermutiveVisitorId(expectedOrigin: string) {
  if (location.origin !== expectedOrigin) return;
  try {
    const value = localStorage.getItem("permutive-id");
    if (value && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value))
      return value;
  } catch {
    /* Disabled origin storage provides no sample. */
  }
}
