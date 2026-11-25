import { database } from "../../../../../lib/reports";

export async function GET() {
  const available = await database?.recentPublishedDomains();
  return Response.json({
    domains: (available ?? []).map(({ domain }) => domain).sort(),
  });
}
