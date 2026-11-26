import { headers } from "next/headers";
import { browserScanUpload } from "@datadeal/contracts/browser-scan";
import { database } from "../../../../lib/reports";
import { auth } from "../../../../lib/auth";

/** Same-origin only: the extension uploads through its bridge on our pages. */
function sameOrigin(request: Request) {
  const incoming = new URL(request.url);
  const configured = new URL(process.env.APP_ORIGIN ?? incoming.origin);
  const origin = request.headers.get("origin");
  const loopback = (host: string) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(host);
  return (
    origin === configured.origin ||
    (process.env.NODE_ENV === "development" &&
      origin === incoming.origin &&
      loopback(incoming.hostname) &&
      loopback(configured.hostname))
  );
}

/**
 * A scan measured in a visitor's private browser window, for a site that
 * blocks the server's scanner. Published once a second person agrees.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ code: "origin" }, { status: 403 });
  if (!database || !auth)
    return Response.json({ code: "unavailable" }, { status: 503 });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return Response.json({ code: "sign_in" }, { status: 401 });
  const parsed = browserScanUpload.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json({ code: "invalid" }, { status: 400 });
  // Locally one upload is enough to see the whole flow.
  const single =
    process.env.NODE_ENV !== "production" &&
    process.env.DATADEAL_BROWSER_SCAN_SINGLE === "true";
  const result = await database.submitBrowserScan(
    session.user.id,
    parsed.data,
    single,
  );
  return Response.json(result, {
    status: result.status === "duplicate" ? 409 : 202,
  });
}

/** The next blocked site this signed-in visitor could help measure. */
export async function GET() {
  if (!database || !auth)
    return Response.json({ code: "unavailable" }, { status: 503 });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ code: "sign_in" }, { status: 401 });
  const domain = await database.nextBrowserScan(session.user.id);
  return domain
    ? Response.json({ domain })
    : new Response(null, { status: 204 });
}
