import { z } from "zod";
import { auth } from "../../../../../lib/auth";
import { creemConnection } from "../../../../../lib/billing";
import { database } from "../../../../../lib/reports";

const portalResult = z.object({
  customer_portal_link: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === "creem.io" ||
        url.hostname === "www.creem.io" ||
        url.hostname === "portal.creem.io")
    );
  }),
});

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const config = creemConnection();
  if (!config || !auth || !database) {
    return Response.json(
      { error: "Billing portal unavailable" },
      { status: 503, headers: privateHeaders },
    );
  }
  if (request.headers.get("origin") !== process.env.APP_ORIGIN) {
    return Response.json(
      { error: "Invalid origin" },
      { status: 403, headers: privateHeaders },
    );
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "Sign in to continue" },
      { status: 401, headers: privateHeaders },
    );
  const customer = await database.billingCustomer(session.user.id);
  if (!customer)
    return Response.json(
      { error: "No billing account found" },
      { status: 404, headers: privateHeaders },
    );

  const response = await fetch(config.api + "/v1/customers/billing", {
    method: "POST",
    redirect: "error",
    headers: { "x-api-key": config.key, "Content-Type": "application/json" },
    body: JSON.stringify({ customer_id: customer }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  const parsed = response?.ok
    ? portalResult.safeParse(await response.json().catch(() => null))
    : null;
  if (!parsed?.success)
    return Response.json(
      { error: "Billing portal unavailable" },
      { status: 502, headers: privateHeaders },
    );
  return Response.json(
    { url: parsed.data.customer_portal_link },
    { headers: privateHeaders },
  );
}
