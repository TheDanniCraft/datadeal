import { domain, scanReport, siteDomain } from "@datadeal/contracts";
import { evaluateHeadline } from "@datadeal/scoring";
import { z } from "zod";
import { auth } from "../../../../../../lib/auth";
import { database } from "../../../../../../lib/reports";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ domain: string }> },
) {
  const headers = { "Cache-Control": "private, no-store" };
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "Sign in to export a report" },
      { status: 401, headers },
    );
  if (!database || !(await database.hasPro(session.user.id)))
    return Response.json(
      { error: "Report exports require DataDeal Pro" },
      { status: 403, headers },
    );

  const host = siteDomain.safeParse((await params).domain);
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("scan"));
  if (!host.success || !id.success)
    return Response.json(
      { error: "Invalid report reference" },
      { status: 400, headers },
    );

  const [snapshot] = await database.archivedReports(host.data, id.data, false);
  const parsed = scanReport.safeParse(snapshot?.report);
  if (
    !parsed.success ||
    parsed.data.id !== id.data ||
    parsed.data.domain !== host.data ||
    parsed.data.demo
  )
    return Response.json(
      { error: "Report not found" },
      { status: 404, headers },
    );

  const report = parsed.data;
  const headline = evaluateHeadline(report);
  const artifact = await database.getScanArtifact(host.data, id.data);
  return Response.json(
    {
      report,
      score: headline.rating,
      headlineScenario: headline.scenario,
      ...(artifact && { captureArtifact: artifact }),
    },
    {
      headers: {
        ...headers,
        "Content-Disposition": `attachment; filename="datadeal-${host.data}-${id.data}.json"`,
      },
    },
  );
}
