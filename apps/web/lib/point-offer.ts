import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "./auth";
import {
  createLocalRewardHolder,
  localRewardHolder,
  localRewardCookie,
  offerBrowserCookie,
  offerBrowserHash,
  localPointsEnabled,
} from "./local-reward";
import { database } from "./reports";

export const privateHeaders = { "Cache-Control": "private,no-store" };
export function localPointsRequest(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (
    !localPointsEnabled() ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return 404;
  if (!origin || !URL.canParse(origin)) return 403;
  const caller = new URL(origin);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(caller.hostname) ||
    caller.protocol !== url.protocol ||
    caller.port !== url.port ||
    (caller.host !== url.host && caller.host !== request.headers.get("host"))
  )
    return 403;
  return 0;
}
export async function pointActor() {
  const jar = await cookies();
  const session = await auth?.api.getSession({ headers: await headers() });
  const existing = jar.get(offerBrowserCookie)?.value;
  const raw = offerBrowserHash(existing)
    ? existing!
    : randomBytes(32).toString("base64url");
  return {
    actor: {
      userId: session?.user.id ?? null,
      browserHash: offerBrowserHash(raw),
    },
    raw,
  };
}
export function rememberBrowser(response: NextResponse, value: string) {
  response.cookies.set(offerBrowserCookie, value, {
    path: "/",
    sameSite: "strict",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
  });
}
export async function handlePointAction(
  id: string,
  command:
    | "status"
    | "complete"
    | "open"
    | "choosePoints"
    | "chooseFlight"
    | "launch"
    | "bank"
    | "continue",
  input: { target?: number | null; host?: string; scanId?: string } = {},
) {
  if (!database) return NextResponse.json({}, { status: 503 });
  const { actor } = await pointActor();
  const value = createLocalRewardHolder(id);
  // Only completion/open can mint a grant. Its holder must be bound to its own scan.
  const status =
    command === "open"
      ? await database.reportOfferAction(id, actor, "status")
      : null;
  const scanId = input.scanId ?? status?.reward?.scanId;
  const holder = scanId ? localRewardHolder(scanId, value) : null;
  const result = await database.reportOfferAction(id, actor, command, {
    ...input,
    grantHash: holder?.holderHash,
  });
  if (result.code !== "ok")
    return NextResponse.json(
      { code: result.code },
      {
        status:
          result.code === "missing"
            ? 404
            : result.code === "forbidden"
              ? 403
              : 409,
        headers: privateHeaders,
      },
    );
  const reward = result.reward;
  const response =
    command === "complete" && reward.state === "unlocked"
      ? new NextResponse(null, { status: 204, headers: privateHeaders })
      : NextResponse.json(reward, { headers: privateHeaders });
  if (
    reward.state === "unlocked" &&
    (command === "open" || command === "complete")
  )
    response.cookies.set(localRewardCookie(reward.scanId), value, {
      path: "/",
      sameSite: "strict",
      httpOnly: true,
      maxAge: 86400,
    });
  return response;
}
