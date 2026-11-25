import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "../../../../../lib/auth";
import {
  billingConfig,
  checkoutBinding,
  creditPackBinding,
  purchasableCreditPack,
} from "../../../../../lib/billing";
import { database } from "../../../../../lib/reports";
import {
  creditCheckoutReturnPrefix,
  proCheckoutReturnPath,
} from "../../../../../lib/checkout-return";

const plan = z.object({ plan: z.enum(["monthly", "yearly", "api-credits"]) });
const checkout = z.object({
  checkout_url: z.url(),
  id: z
    .string()
    .regex(/^ch_[a-zA-Z0-9_-]{1,100}$/)
    .optional(),
});

function allowedCheckoutUrl(value: string, mode: string, product: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    return false;
  if (url.hostname === "checkout.creem.io") return true;
  if (url.hostname === "test-checkout.creem.io") return mode === "test";
  const [, environment, action, productId, sessionId, extra] =
    url.pathname.split("/");
  return (
    mode === "test" &&
    url.hostname === "creem.io" &&
    environment === "test" &&
    action === "checkout" &&
    productId === product &&
    /^ch_[A-Za-z0-9]+$/.test(sessionId ?? "") &&
    extra === undefined
  );
}

export async function POST(request: Request) {
  const origin = process.env.APP_ORIGIN;
  if (!origin || !auth || !database)
    return Response.json({ error: "Checkout unavailable" }, { status: 503 });
  if (request.headers.get("origin") !== origin)
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "Sign in to continue" }, { status: 401 });
  const parsed = plan.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Select a plan" }, { status: 400 });
  const selection = parsed.data.plan;
  if (selection === "api-credits" && !session.user.emailVerified)
    return Response.json(
      { error: "Verify your email before buying API credits." },
      { status: 403 },
    );
  const pack =
    selection === "api-credits" ? await purchasableCreditPack() : null;
  const pro = selection === "api-credits" ? null : billingConfig();
  const config = pack ?? pro;
  const product =
    pack?.product ??
    (selection === "api-credits" ? undefined : pro?.[selection]);
  const subscription =
    selection === "api-credits"
      ? null
      : await database.billingSummary(session.user.id);
  if (subscription?.has_access || subscription?.needs_management)
    return Response.json(
      {
        error: "Manage your existing Pro subscription",
        code: "existing_subscription",
      },
      { status: 409 },
    );
  if (!config || !product)
    return Response.json({ error: "Checkout unavailable" }, { status: 503 });
  const requestId = randomUUID();
  const response = await fetch(config.api + "/v1/checkouts", {
    method: "POST",
    redirect: "error",
    headers: { "x-api-key": config.key, "Content-Type": "application/json" },
    body: JSON.stringify({
      product_id: product,
      request_id: requestId,
      success_url:
        origin +
        (pack ? creditCheckoutReturnPrefix : proCheckoutReturnPath + "/") +
        requestId,
      customer: { email: session.user.email },
      metadata: {
        datadeal_user: session.user.id,
        ...(!pack && { datadeal_pro_request: requestId }),
        ...(pack && {
          datadeal_pack_credits: String(pack.credits),
          datadeal_price_cents: String(pack.price),
        }),
        datadeal_binding: pack
          ? creditPackBinding(
              config.secret,
              session.user.id,
              product,
              requestId,
              pack.credits,
              pack.price,
            )
          : checkoutBinding(config.secret, session.user.id, product),
      },
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  const result = response?.ok
    ? checkout.safeParse(await response.json().catch(() => null))
    : null;
  if (
    !result?.success ||
    !allowedCheckoutUrl(result.data.checkout_url, config.mode, product)
  )
    return Response.json({ error: "Checkout unavailable" }, { status: 502 });
  if (pack) {
    try {
      await database.recordSandboxCreditProduct(product);
    } catch {
      return Response.json({ error: "Checkout unavailable" }, { status: 503 });
    }
  } else {
    if (!result.data.id)
      return Response.json({ error: "Checkout unavailable" }, { status: 502 });
    try {
      await database.recordProCheckout({
        requestId,
        userId: session.user.id,
        product,
        checkoutId: result.data.id,
        mode: config.mode === "test" ? "test" : "live",
      });
    } catch {
      return Response.json({ error: "Checkout unavailable" }, { status: 503 });
    }
  }
  return Response.json(
    { url: result.data.checkout_url },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
