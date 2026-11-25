import { privacyPreference } from "@datadeal/contracts";
import { auth } from "../../../../../lib/auth";
import { database } from "../../../../../lib/reports";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session || !database)
    return new Response(null, { status: 401, headers });
  if (!(await database.hasPro(session.user.id)))
    return new Response(null, { status: 403, headers });
  const preference =
    (await database.privacyProfile(session.user.id)) ?? "standard";
  return Response.json(preference, { headers });
}

export async function PUT(request: Request) {
  if (request.headers.get("origin") !== process.env.APP_ORIGIN)
    return new Response(null, { status: 403, headers });
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session || !database)
    return new Response(null, { status: 401, headers });
  const preference = privacyPreference.safeParse(
    await request.json().catch(() => null),
  );
  if (!preference.success) return new Response(null, { status: 400, headers });
  const saved = await database.setPrivacyProfile(
    session.user.id,
    preference.data,
  );
  return new Response(null, { status: saved ? 204 : 403, headers });
}
