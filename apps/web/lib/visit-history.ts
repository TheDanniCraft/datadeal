import type { ScanReport } from "@datadeal/contracts";
import { acceptAllHomepage } from "@datadeal/contracts/content-page";

type VisitSource = {
  scanId: string;
  evidenceId: string;
  retrievedAt: string;
  href: string;
};

export type VisitDestinationChange = {
  pageUrl: string;
  earlierOnly: string[];
  laterOnly: string[];
  previous: VisitSource;
  current: VisitSource;
};

function destinationInventory(report: ScanReport) {
  const run = acceptAllHomepage(report);
  if (!run || report.demo) return;
  const { source, visit } = run;
  const { afterChoice, capture } = visit;
  if (!source.url || !visit.freshContext || !afterChoice || !capture?.settleMs)
    return;
  const page = new URL(source.url);
  if (page.username || page.password || page.search || page.hash) return;
  const started = Date.parse(capture.navigationStartedAt);
  const ended = Date.parse(capture.endSnapshotAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started)
    return;
  // The worker keeps a separate set of at most 20 registrable domains after
  // the click. At the cap we cannot establish that a domain was absent.
  const hosts = new Set(afterChoice.externalDomains);
  if (
    hosts.size >= 20 ||
    hosts.size !== afterChoice.externalDomains.length ||
    hosts.size > afterChoice.requests ||
    (visit.externalDomains.length < 20 &&
      [...hosts].some((host) => !visit.externalDomains.includes(host)))
  )
    return;
  return {
    hosts,
    pageUrl: source.url,
    started,
    ended,
    settleMs: capture.settleMs,
    source: {
      scanId: report.id,
      evidenceId: source.id,
      retrievedAt: source.retrievedAt,
      href: `/report/${encodeURIComponent(report.domain)}?scan=${encodeURIComponent(report.id)}#evidence-${encodeURIComponent(source.id)}`,
    },
  };
}

// These are destinations of attempted requests during two recorded windows.
// The response-domain list covers the whole visit and cannot establish
// delivery during either post-choice window.
export function compareVisitDestinations(
  previous: ScanReport,
  current: ScanReport,
): VisitDestinationChange | undefined {
  if (previous.domain !== current.domain || previous.id === current.id) return;
  const before = destinationInventory(previous);
  const after = destinationInventory(current);
  if (
    !before ||
    !after ||
    before.pageUrl !== after.pageUrl ||
    before.settleMs !== after.settleMs ||
    before.ended >= after.started
  )
    return;
  return {
    pageUrl: after.pageUrl,
    earlierOnly: [...before.hosts]
      .filter((host) => !after.hosts.has(host))
      .sort(),
    laterOnly: [...after.hosts]
      .filter((host) => !before.hosts.has(host))
      .sort(),
    previous: before.source,
    current: after.source,
  };
}
