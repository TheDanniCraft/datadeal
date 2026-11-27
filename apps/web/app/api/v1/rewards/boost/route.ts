import { z } from "zod";
import { auth } from "../../../../../lib/auth";
import { database } from "../../../../../lib/reports";
import { pointsRequest, privateHeaders } from "../../../../../lib/point-offer";

const body = z.strictObject({ scanId: z.uuid() });

/** Spend points (or a Pro free boost) to move a waiting scan to the front of the queue. */
export async function POST(request: Request) {
  const guard = pointsRequest(request);
  if (guard || !database) return new Response(null, { status: guard || 503 });
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const input = body.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json({ code: "invalid_request" }, { status: 400 });
  const code = await database.boostScan(
    session.user.id,
    input.data.scanId,
    await database.hasPro(session.user.id),
  );
  return Response.json(
    { code },
    {
      status:
        code === "boosted" || code === "already_boosted"
          ? 200
          : code === "insufficient"
            ? 409
            : 404,
      headers: privateHeaders,
    },
  );
}
