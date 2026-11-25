import { z } from "zod";
import { auth } from "../../../../lib/auth";
import { accountReturnPath } from "../../../../lib/account-return";

const signIn = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  returnTo: z.string().optional(),
});

export async function GET(request: Request) {
  if (new URL(request.url).pathname.endsWith("/delete-user/callback"))
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  return auth
    ? auth.handler(request)
    : Response.json({ error: "Authentication unavailable" }, { status: 503 });
}

export async function POST(request: Request) {
  if (!auth)
    return Response.json(
      { error: "Authentication unavailable" },
      { status: 503 },
    );
  if (request.headers.get("origin") !== process.env.APP_ORIGIN) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (!new URL(request.url).pathname.endsWith("/sign-in/magic-link"))
    return auth.handler(request);
  const parsed = signIn.safeParse(await request.json().catch(() => null));
  if (!parsed?.success)
    return Response.json(
      { error: "Enter a valid email address" },
      { status: 400 },
    );
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const callbackURL = accountReturnPath(parsed.data.returnTo);
  return auth.handler(
    new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: parsed.data.email,
        callbackURL,
        errorCallbackURL:
          callbackURL === "/account"
            ? "/account"
            : "/account?returnTo=" + callbackURL,
      }),
    }),
  );
}
