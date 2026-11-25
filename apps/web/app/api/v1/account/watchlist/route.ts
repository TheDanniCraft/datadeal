import { domain } from "@datadeal/contracts";
import { z } from "zod";
import { auth } from "../../../../../lib/auth";
import { database } from "../../../../../lib/reports";

const body = z.object({ domain });
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session || !database)
    return Response.json(
      { error: "Sign in to view your watchlist" },
      { status: 401, headers: privateHeaders },
    );
  return Response.json(
    { websites: await database.listWatchlist(session.user.id) },
    { headers: privateHeaders },
  );
}

async function change(request: Request, operation: "save" | "remove") {
  if (request.headers.get("origin") !== process.env.APP_ORIGIN) {
    return Response.json(
      { error: "Invalid origin" },
      { status: 403, headers: privateHeaders },
    );
  }
  const session = await auth?.api.getSession({ headers: request.headers });
  if (!session || !database)
    return Response.json(
      { error: "Sign in to manage your watchlist" },
      { status: 401, headers: privateHeaders },
    );
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Enter a public domain" },
      { status: 400, headers: privateHeaders },
    );
  if (operation === "remove") {
    await database.removeWatchlistDomain(session.user.id, parsed.data.domain);
  } else {
    const status = await database.saveWatchlistDomain(
      session.user.id,
      parsed.data.domain,
    );
    if (status === "forbidden")
      return Response.json(
        { error: "Pro required" },
        { status: 403, headers: privateHeaders },
      );
    if (status === "full")
      return Response.json(
        { error: "Watchlist is full" },
        { status: 409, headers: privateHeaders },
      );
  }
  return new Response(null, { status: 204, headers: privateHeaders });
}
export function POST(request: Request) {
  return change(request, "save");
}
export function DELETE(request: Request) {
  return change(request, "remove");
}
