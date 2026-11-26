import { z } from "zod";
import {
  browserRequestFields,
  browserVisit,
  consentCoverage,
  siteDomain,
} from "./index";

/** One measured visit, in the same shape the Playwright worker records. */
export const browserScanVisit = z.object({
  scenario: z.enum(["default", "rejected", "accepted"]),
  visitedUrl: z.url().max(2000),
  observation: browserVisit.extend({
    type: z.literal("browser_consent_counts"),
  }),
  network: z.array(browserRequestFields).max(24),
});
export type BrowserScanVisit = z.infer<typeof browserScanVisit>;

/** A page captured as rendered in the private window (homepage, policies). */
export const capturedPage = z.object({
  url: z.url().max(2000),
  html: z.string().min(1).max(1_500_000),
});

/**
 * What the extension uploads after scanning a site in a private window.
 * Raw cookie and storage values never leave the browser: only masked names
 * and value descriptions, as in the worker's evidence.
 */
export const browserScanUpload = z.object({
  domain: siteDomain,
  homepageUrl: z.url().max(2000),
  collector: z.object({
    browser: z.enum(["chrome", "firefox", "edge", "other"]),
    version: z.string().max(40),
    extension: z.string().max(20),
  }),
  coverage: consentCoverage,
  visits: z.array(browserScanVisit).min(1).max(3),
  pages: z.array(capturedPage).min(1).max(4),
});
export type BrowserScanUpload = z.infer<typeof browserScanUpload>;

/**
 * The stable facts two independent collectors must agree on before a
 * browser-collected report is published.
 */
export function browserScanFacts(upload: BrowserScanUpload) {
  const domains = new Set<string>();
  for (const visit of upload.visits)
    for (const host of visit.observation.externalDomains) domains.add(host);
  return {
    coverage: upload.coverage,
    domains: [...domains].sort(),
  };
}

/** Two uploads agree when consent outcomes match and outside domains mostly overlap. */
export function browserScansAgree(
  a: ReturnType<typeof browserScanFacts>,
  b: ReturnType<typeof browserScanFacts>,
) {
  const same =
    a.coverage.default === b.coverage.default &&
    a.coverage.rejected === b.coverage.rejected &&
    a.coverage.accepted === b.coverage.accepted;
  const left = new Set(a.domains);
  const shared = b.domains.filter((host) => left.has(host)).length;
  const union = new Set([...a.domains, ...b.domains]).size;
  return same && (union === 0 || shared / union >= 0.7);
}
