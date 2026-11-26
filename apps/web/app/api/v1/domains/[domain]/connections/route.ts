import { domain, siteDomain } from "@datadeal/contracts";
import { measuredContentVisits } from "@datadeal/contracts/content-page";
import { auth } from "../../../../../../lib/auth";
import { database, lookup } from "../../../../../../lib/reports";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ domain: string }> },
) {
  const headers = { "Cache-Control": "private, no-store" };
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "Sign in to expand the graph" },
      { status: 401, headers },
    );
  if (!database || !(await database.hasPro(session.user.id)))
    return Response.json(
      { error: "Connections require DataDeal Pro" },
      { status: 403, headers },
    );

  const parsed = siteDomain.safeParse((await params).domain);
  if (!parsed.success)
    return Response.json({ error: "Invalid domain" }, { status: 400, headers });
  const [exact, references] = await Promise.all([
    lookup(parsed.data),
    database.observedProviderReferences(parsed.data),
  ]);
  const candidate =
    exact.report ??
    (parsed.data.startsWith("www.")
      ? (await lookup(parsed.data.slice(4))).report
      : undefined);
  const report = candidate?.demo ? undefined : candidate;
  if (!report && !references.length)
    return Response.json(
      { error: "No published scan for this provider yet." },
      { status: 404, headers },
    );

  const destinations = new Map<
    string,
    { declaredEvidenceId?: string; observedEvidenceId?: string }
  >();
  for (const source of report?.evidence ?? []) {
    if (!report) continue;
    if (source.scanId !== report.id) continue;
    const observation = source.observation;
    const declared =
      source.kind === "declared_first_party" &&
      observation?.type === "policy_section";
    const observed =
      source.kind === "observed_technical" &&
      observation?.type === "browser_consent_counts";
    for (const host of declared
      ? (observation.providerHosts ?? [])
      : observed
        ? observation.externalDomains
        : []) {
      if (host === report.domain) continue;
      const citation = destinations.get(host) ?? {};
      if (declared) citation.declaredEvidenceId ??= source.id;
      if (observed) citation.observedEvidenceId ??= source.id;
      destinations.set(host, citation);
    }
  }
  for (const { source, visit } of measuredContentVisits(report)) {
    for (const host of visit.externalDomains) {
      if (host === report?.domain) continue;
      const citation = destinations.get(host) ?? {};
      citation.observedEvidenceId ??= source.id;
      destinations.set(host, citation);
    }
  }
  return Response.json(
    {
      domain: report?.domain ?? parsed.data,
      scanId: report?.id ?? null,
      favicon: report?.favicon,
      references,
      destinations: Array.from(destinations, ([label, citation]) => ({
        label,
        ...citation,
      })).slice(0, 30),
    },
    { headers },
  );
}
