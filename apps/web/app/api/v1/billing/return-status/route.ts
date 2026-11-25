import { auth } from "../../../../../lib/auth";
import {
  checkoutReference,
  isCreditRequestId,
  proCheckoutReference,
} from "../../../../../lib/checkout-return";
import { database } from "../../../../../lib/reports";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (!database || !auth) return new Response(null, { status: 503, headers });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  if (params.size !== 1) return new Response(null, { status: 400, headers });
  const proRef = params.get("pro_receipt");
  if (proRef) {
    if (
      !isCreditRequestId(proRef) &&
      proCheckoutReference({ checkout_id: proRef, order_id: proRef }) !== proRef
    )
      return new Response(null, { status: 400, headers });
    const status =
      (await database.proCheckoutReceipt(session.user.id, proRef)) ?? "pending";
    return Response.json({ status }, { headers });
  }
  const requestId = params.get("request_id");
  if (isCreditRequestId(requestId)) {
    const status = await database.creditCheckoutReceipt(
      session.user.id,
      requestId,
    );
    return Response.json({ status }, { headers });
  }
  if (params.get("checkout") === "pro") {
    const billing = await database.billingSummary(session.user.id);
    return Response.json(
      {
        status:
          billing?.has_access || billing?.needs_management
            ? "account_subscription"
            : "pending",
      },
      { headers },
    );
  }
  const kind = params.has("subscription_id") ? "subscription" : "credits";
  const id = checkoutReference(kind, Object.fromEntries(params));
  if (!id) return new Response(null, { status: 400, headers });
  const status = await database.checkoutReceipt(session.user.id, kind, id);
  return Response.json({ status }, { headers });
}
