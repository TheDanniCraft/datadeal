import { comparisonQuery } from "@datadeal/contracts";
import { comparePublicReports } from "../../../../lib/compare";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = comparisonQuery.safeParse({
    left: params.get("left"),
    right: params.get("right"),
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Provide two different public domains." },
      { status: 400 },
    );
  }
  return Response.json({
    reports: await comparePublicReports(parsed.data.left, parsed.data.right),
  });
}
