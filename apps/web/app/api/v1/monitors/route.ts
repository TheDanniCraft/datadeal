import { z } from "zod";
import { domain } from "@datadeal/contracts";
import { auth } from "../../../../lib/auth";
import { database } from "../../../../lib/reports";
import {
  localPointsRequest,
  privateHeaders,
} from "../../../../lib/point-offer";

const body = z.strictObject({ domain, monitor: z.boolean() });

/** "Keep me updated": start or stop a points-funded site monitor. */
export async function POST(request: Request) {
  const guard = localPointsRequest(request);
  if (guard || !database) return new Response(null, { status: guard || 503 });
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const input = body.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json({ code: "invalid_request" }, { status: 400 });
  if (!input.data.monitor) {
    await database.stopMonitoring(session.user.id, input.data.domain);
    return Response.json({ code: "stopped" }, { headers: privateHeaders });
  }
  const code = await database.startMonitoring(
    session.user.id,
    input.data.domain,
  );
  return Response.json(
    { code },
    {
      status: code === "insufficient" ? 409 : 200,
      headers: privateHeaders,
    },
  );
}
