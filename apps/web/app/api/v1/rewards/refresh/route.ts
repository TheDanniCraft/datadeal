import { createHash } from "node:crypto";
import { z } from "zod";
import { domain } from "@datadeal/contracts";
import { auth } from "../../../../../lib/auth";
import { database } from "../../../../../lib/reports";
import { localPointsEnabled } from "../../../../../lib/local-reward";
import { scanClientKey } from "../../../../../lib/scan-limit";

const input = z.strictObject({
  domain,
  requestId: z.uuid(),
  spendPoints: z.literal(true),
});
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (
    !localPointsEnabled() ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return new Response(null, { status: 404 });
  if (request.headers.get("origin") !== url.origin)
    return new Response(null, { status: 403 });
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  if (!database) return Response.json({ code: "unavailable" }, { status: 503 });
  const body = input.safeParse(await request.json().catch(() => undefined));
  if (!body.success)
    return Response.json({ code: "invalid_request" }, { status: 400 });
  const userId = session.user.id;
  const daily = (await database.hasPro(userId))
    ? null
    : "daily:account:" + createHash("sha256").update(userId).digest("hex");
  const result = await database.requestPointRefresh(
    userId,
    body.data.domain,
    body.data.requestId,
    scanClientKey(request),
    daily,
  );
  const statuses = {
    accepted: 202,
    refunded: 200,
    scan_in_progress: 200,
    domain_cooldown: 429,
    daily_limit: 429,
    hourly_limit: 429,
    queue_full: 429,
    insufficient_points: 409,
    conflict: 409,
    no_report: 404,
    watchlist_disabled: 503,
  };
  return Response.json(result, {
    status: statuses[result.code],
    headers: { "Cache-Control": "private, no-store" },
  });
}
