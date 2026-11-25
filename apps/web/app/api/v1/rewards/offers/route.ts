import { z } from "zod";
import { domain } from "@datadeal/contracts";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { database } from "../../../../../lib/reports";
import {
  handlePointAction,
  localPointsRequest,
  pointActor,
  privateHeaders,
  rememberBrowser,
} from "../../../../../lib/point-offer";
import {
  localRewardCookie,
  guestReportHolders,
  hasLocalReward,
} from "../../../../../lib/local-reward";

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reserve"),
    host: domain,
    scanId: z.uuid(),
    offer: z.enum(["unlock", "points", "flight", "choice"]),
  }),
  z.object({
    action: z.literal("spend"),
    host: domain,
    scanId: z.uuid(),
    spendPoints: z.literal(true),
  }),
  z.object({
    action: z.enum([
      "status",
      "open",
      "choosePoints",
      "chooseFlight",
      "launch",
      "bank",
      "continue",
    ]),
    id: z.uuid(),
    target: z.number().int().min(1).max(1000).nullable().optional(),
  }),
]);
export async function POST(request: Request) {
  const guard = localPointsRequest(request);
  if (guard || !database) return new Response(null, { status: guard || 503 });
  const input = body.safeParse(await request.json().catch(() => null));
  if (!input.success) return new Response(null, { status: 400 });
  const params = input.data;
  if (params.action === "reserve") {
    const { actor, raw } = await pointActor();
    const id = await database.createReportOffer(
      params.host,
      params.scanId,
      params.offer,
      actor,
    );
    if (!id) return new Response(null, { status: 404 });
    const response = NextResponse.json({ id }, { headers: privateHeaders });
    rememberBrowser(response, raw);
    return response;
  }
  if (params.action === "spend") {
    const { actor } = await pointActor();
    if (!actor.userId) return new Response(null, { status: 401 });
    const jar = await cookies();
    if (
      hasLocalReward(
        params.scanId,
        jar.get(localRewardCookie(params.scanId))?.value,
      )
    )
      return NextResponse.json({ code: "owned" }, { headers: privateHeaders });
    const guests = guestReportHolders(jar.getAll());
    await database.reportPointWallet(actor.userId);
    const code = await database.spendOnReport(
      params.host,
      params.scanId,
      actor.userId,
      guests,
    );
    return NextResponse.json(
      { code },
      {
        status:
          code === "insufficient" ? 409 : code === "unavailable" ? 404 : 200,
        headers: privateHeaders,
      },
    );
  }
  return handlePointAction(params.id, params.action, { target: params.target });
}
