import { z } from "zod";
import { auth } from "../../../../../lib/auth";
import {
  createDeveloperTokenSecret,
  developerApiPreview,
  developerScanCost,
} from "../../../../../lib/developer-token";
import { database } from "../../../../../lib/reports";

const headers = { "Cache-Control": "private, no-store" };
const labelBody = z.object({
  label: z.string().trim().min(1).max(64),
  scope: z.enum(["reports:read", "scans:request"]).default("reports:read"),
});
const idBody = z.object({ id: z.uuid() });

export async function GET(request: Request) {
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session || !database)
    return new Response(null, { status: 401, headers });
  return Response.json(await database.listApiTokens(session.user.id), {
    headers,
  });
}

async function mutate(request: Request) {
  const origin = process.env.APP_ORIGIN;
  if (!origin || request.headers.get("origin") !== origin)
    return new Response(null, { status: 403, headers });
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session || !database)
    return new Response(null, { status: 401, headers });
  const body = await request.json().catch(() => null);
  const userId = session.user.id;

  if (request.method === "POST") {
    const parsed = labelBody.safeParse(body);
    if (!parsed.success) return new Response(null, { status: 400, headers });
    if (
      parsed.data.scope === "scans:request" &&
      (!developerApiPreview || developerScanCost === null)
    )
      return new Response(null, { status: 503, headers });
    const { hash, secret } = createDeveloperTokenSecret();
    const record = await database.createApiToken(userId, {
      label: parsed.data.label,
      scope: parsed.data.scope,
      hash,
    });
    if (!record) return new Response(null, { status: 409, headers });
    return Response.json(
      { record, token: `dd_${record.id}.${secret}` },
      { status: 201, headers },
    );
  }

  const parsed = idBody.safeParse(body);
  if (!parsed.success) return new Response(null, { status: 400, headers });
  if (request.method === "DELETE") {
    const revoked = await database.revokeApiToken(userId, parsed.data.id);
    return new Response(null, { status: revoked ? 204 : 404, headers });
  }
  const { hash, secret } = createDeveloperTokenSecret();
  const record = await database.rotateApiToken(userId, parsed.data.id, hash);
  if (!record) return new Response(null, { status: 404, headers });
  return Response.json(
    { record, token: `dd_${record.id}.${secret}` },
    { headers },
  );
}

export { mutate as POST, mutate as PATCH, mutate as DELETE };
