import { domain } from "@datadeal/contracts";
import { z } from "zod";
import { auth } from "../../../../../lib/auth";
import { database } from "../../../../../lib/reports";

const preferences = z.object({ domain, enabled: z.boolean() });
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session || !database)
    return Response.json(
      { error: "Sign in to see alerts" },
      { status: 401, headers },
    );
  return Response.json(
    { alerts: await database.documentAlerts(session.user.id) },
    { headers },
  );
}

export async function PATCH(request: Request) {
  if (request.headers.get("origin") !== process.env.APP_ORIGIN)
    return Response.json({ error: "Invalid origin" }, { status: 403, headers });
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session || !database)
    return Response.json(
      { error: "Sign in to manage alerts" },
      { status: 401, headers },
    );
  const parsed = preferences.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Invalid preference" },
      { status: 400, headers },
    );
  const updated = await database.setDocumentAlerts(
    session.user.id,
    parsed.data.domain,
    parsed.data.enabled,
  );
  if (updated === "limit")
    return Response.json(
      { code: "limit", error: "Pro includes this many watched sites" },
      { status: 409, headers },
    );
  return new Response(null, {
    status: updated === "updated" ? 204 : 404,
    headers,
  });
}
