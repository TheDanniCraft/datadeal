import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { domain, scanReport } from "@datadeal/contracts";
import {
  localRewardCookie,
  localPointsEnabled,
  createLocalRewardHolder,
  localRewardHolder,
} from "../../../../../lib/local-reward";
import { database } from "../../../../../lib/reports";
import { auth } from "../../../../../lib/auth";
import { hasAdvancedSnapshotDetails } from "../../../../../lib/browser-summary";

import { handlePointAction } from "../../../../../lib/point-offer";

const requestBody = z.object({
  host: domain,
  scanId: z.uuid(),
  completionId: z.uuid(),
});
const duration = 24 * 60 * 60;
const loopback = ["localhost", "127.0.0.1", "[::1]"];

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!localPointsEnabled() || !database || !loopback.includes(url.hostname))
    return new Response(null, { status: 404 });
  const origin = request.headers.get("origin");
  const caller = origin && URL.canParse(origin) ? new URL(origin) : null;
  if (
    !caller ||
    !loopback.includes(caller.hostname) ||
    (origin !== url.origin &&
      (caller.port !== url.port ||
        caller.protocol !== url.protocol ||
        caller.host !== request.headers.get("host")))
  )
    return new Response(null, { status: 403 });
  const body = requestBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  const { host, scanId, completionId } = body.data;
  if (await database.reservedReportOffer(completionId)) {
    return handlePointAction(completionId, "complete", { host, scanId });
  }
  // A new publication can arrive while the guest is watching the ad.
  const snapshots = await database.archivedReports(host, scanId, false);
  const offered = scanReport.safeParse(snapshots[0]?.report);
  if (
    !offered.success ||
    offered.data.domain !== host ||
    offered.data.id !== scanId ||
    !hasAdvancedSnapshotDetails(offered.data)
  )
    return new Response(null, { status: 404 });
  const cookie = localRewardCookie(scanId);
  const existing = (await cookies()).get(cookie)?.value;
  const prior = localRewardHolder(scanId, existing);
  const session = await auth?.api.getSession({ headers: request.headers });
  const account = session && { kind: "user" as const, userId: session.user.id };
  const savedToAccount =
    account && (await database.hasScanReward(scanId, account));
  if (
    prior &&
    (!account || savedToAccount) &&
    (await database.hasScanReward(scanId, prior))
  )
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store" },
    });

  const value = createLocalRewardHolder(completionId);
  const holder = localRewardHolder(scanId, value);
  if (!holder) return new Response(null, { status: 503 });
  const settled = await database.grantScanReward({
    provider: "local_sample",
    receiptId: completionId,
    scanId,
    holder,
    signedInUserId: session?.user.id,
  });
  if (
    settled === "duplicate_receipt" &&
    (!(await database.hasScanReward(scanId, holder)) ||
      (account && !(await database.hasScanReward(scanId, account))))
  )
    return new Response(null, { status: 409 });
  if (settled === "unavailable") return new Response(null, { status: 404 });
  const response = new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "private, no-store" },
  });
  response.cookies.set(cookie, value, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: duration,
  });
  return response;
}
