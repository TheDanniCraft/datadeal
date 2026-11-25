import { domain } from "@datadeal/contracts";
import { createHash } from "node:crypto";
import { database } from "../../../../../lib/reports";
import { auth } from "../../../../../lib/auth";
import { publishedReportPayload } from "../../../../../lib/published-report";

import { scanClientKey } from "../../../../../lib/scan-limit";

type Context = { params: Promise<{ domain: string }> };

export async function GET(_request: Request, { params }: Context) {
  const parsed = domain.safeParse((await params).domain);
  if (!parsed.success)
    return Response.json({ error: "Invalid domain" }, { status: 400 });
  return Response.json(await publishedReportPayload(parsed.data));
}

export async function POST(request: Request, { params }: Context) {
  const incoming = new URL(request.url);
  const configured = new URL(process.env.APP_ORIGIN ?? incoming.origin);
  const origin = request.headers.get("origin");
  const loopback = (host: string) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const localAlias =
    process.env.NODE_ENV === "development" &&
    origin === incoming.origin &&
    loopback(incoming.hostname) &&
    loopback(configured.hostname) &&
    incoming.port === configured.port &&
    incoming.protocol === configured.protocol;
  if (origin !== configured.origin && !localAlias) {
    return Response.json(
      { code: "origin", error: "Invalid origin" },
      { status: 403 },
    );
  }
  const parsed = domain.safeParse((await params).domain);
  if (!parsed.success)
    return Response.json({ error: "Invalid domain" }, { status: 400 });
  if (!database)
    return Response.json(
      { code: "unavailable", error: "Scan queue unavailable" },
      { status: 503 },
    );
  const session = await auth?.api.getSession({ headers: request.headers });
  const userId = session?.user.id;
  const client = scanClientKey(request);
  if (process.env.NODE_ENV === "production" && !userId && !client) {
    return Response.json(
      {
        code: "unavailable",
        error: "Guest scan requests are temporarily unavailable",
      },
      { status: 503 },
    );
  }
  const pro = userId && (await database.hasPro(userId));
  const daily = pro
    ? null
    : userId
      ? "daily:account:" + createHash("sha256").update(userId).digest("hex")
      : scanClientKey(request, "day");
  const result = await database.requestScan(parsed.data, client, daily, userId);
  if (result.code === "accepted")
    return Response.json({ id: result.id }, { status: 202 });
  if (result.code === "domain_cooldown") {
    return Response.json(
      { code: result.code, error: "This domain was scanned recently" },
      { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
    );
  }
  if (result.code === "daily_limit" || result.code === "hourly_limit") {
    const seconds = result.code === "daily_limit" ? 86_400 : 3_600;
    return Response.json(
      {
        code: result.code,
        error: "Scan request limit reached",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            seconds - (Math.floor(Date.now() / 1000) % seconds),
          ),
        },
      },
    );
  }
  if (result.code === "queue_full") {
    return Response.json(
      { code: "queue_full", error: "Scan queue is full" },
      {
        status: 429,
        headers: { "Retry-After": "60" },
      },
    );
  }
  return Response.json(
    { code: "unavailable", error: "Scan queue unavailable" },
    { status: 503 },
  );
}
