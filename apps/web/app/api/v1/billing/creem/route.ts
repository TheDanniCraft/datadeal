import { creemCreditsClient } from "@datadeal/database";
import {
  billingConfig,
  checkoutBinding,
  creemConnection,
  creemCreditCheckout,
  creemEnvelope,
  creemFullRefund,
  creemProCheckout,
  proReceiptMarker,
  creemRefundedPayment,
  creemSubscription,
  matchesSignature,
  signature,
} from "../../../../../lib/billing";
import {
  pointPackConfig,
  purchasedPointPack,
} from "../../../../../lib/point-packs";
import { database } from "../../../../../lib/reports";
import { cancelSubscription } from "../../../../../lib/cancel-subscription";

const statuses: Readonly<Record<string, string>> = {
  "subscription.paid": "active",
  "subscription.canceled": "canceled",
  "subscription.expired": "expired",
  "subscription.paused": "paused",
  "subscription.past_due": "past_due",
};
const maxWebhookBytes = 128_000;

export async function POST(request: Request) {
  const connection = creemConnection();
  if (!connection || !database) return new Response(null, { status: 503 });
  if (Number(request.headers.get("content-length")) > maxWebhookBytes)
    return new Response(null, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxWebhookBytes) {
        void reader.cancel().catch(() => {});
        return new Response(null, { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return new Response(null, { status: 400 });
  } finally {
    reader.releaseLock();
  }
  const raw = Buffer.concat(chunks, received);
  if (
    !matchesSignature(
      signature(connection.secret, raw),
      request.headers.get("creem-signature"),
    )
  ) {
    return new Response(null, { status: 401 });
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return new Response(null, { status: 400 });
  }
  const envelope = creemEnvelope.safeParse(decoded);
  if (!envelope.success) return new Response(null, { status: 400 });
  const { id, eventType, created_at: time, object } = envelope.data;
  if (eventType === "refund.created") {
    const event = creemFullRefund.safeParse(object);
    if (connection.mode !== "test" || !event.success)
      return new Response(null, { status: 200 });
    const transactionId = event.data.transaction.id;
    let payment = creemRefundedPayment.safeParse(event.data.transaction);
    if (!payment.success) {
      const lookup = new URL("/v1/transactions", connection.api);
      lookup.searchParams.set("transaction_id", transactionId);
      const response = await fetch(lookup, {
        headers: { "x-api-key": connection.key },
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (!response?.ok) return new Response(null, { status: 503 });
      payment = creemRefundedPayment.safeParse(
        await response.json().catch(() => null),
      );
    }
    if (!payment.success || payment.data.id !== transactionId)
      return new Response(null, { status: 503 });
    const order = payment.data.order;
    let result: string = await database
      .refundPointPackPurchase(order)
      .catch(() => "unavailable" as const);
    if (result === "missing") {
      // Orders from before points were bought as Creem-held credits. Those
      // records are kept for history; reversing them never touches points.
      const client = creemCreditsClient();
      const reversal = client
        ? await database
            .reverseCreemCreditPurchase(client, order)
            .catch(() => "unavailable" as const)
        : ("missing" as const);
      result =
        reversal === "missing"
          ? await database
              .recordApiCreditPaymentRefund("creem:test:" + order)
              .catch(() => "unavailable" as const)
          : reversal;
    }
    const product =
      typeof event.data.order === "object" && event.data.order?.product;
    const offered = pointPackConfig()?.packs.map((pack) => pack.product) ?? [];
    if (result === "missing" && product && !offered.includes(product)) {
      // A refund can arrive before checkout.completed, including after the
      // purchased product has been replaced in the store configuration.
      try {
        if (!(await database.wasSandboxCreditProductOffered(product)))
          return new Response(null);
      } catch {
        return new Response(null, { status: 503 });
      }
    }
    // Retry if this delivery arrived before the checkout that credits the order.
    return new Response(null, {
      status: result === "applied" || result === "replayed" ? 200 : 503,
    });
  }
  if (eventType === "checkout.completed") {
    if (proReceiptMarker.safeParse(object).success) {
      const receipt = creemProCheckout.safeParse(object);
      if (!receipt.success) return new Response(null, { status: 422 });
      const { data } = receipt;
      const userId = data.metadata.datadeal_user;
      if (
        data.mode !== connection.mode ||
        !matchesSignature(
          checkoutBinding(connection.secret, userId, data.product),
          data.metadata.datadeal_binding,
        )
      )
        return new Response(null, { status: 422 });
      try {
        const matched = await database.completeProCheckout({
          requestId: data.request_id,
          checkoutId: data.id,
          userId,
          mode: data.mode,
          product: data.product,
          customerId: data.customer,
          subscriptionId: data.subscription.id,
          orderId: data.order?.id,
        });
        return new Response(null, { status: matched ? 200 : 409 });
      } catch {
        return new Response(null, { status: 503 });
      }
    }
    const pack =
      connection.mode === "test" &&
      purchasedPointPack(object, connection.secret);
    if (!pack) return new Response(null);
    const completed = creemCreditCheckout.safeParse(object);
    if (!completed.success)
      return new Response("Incomplete point pack payment details", {
        status: 422,
      });
    const { order, product, metadata, customer } = completed.data;
    if (
      product.id !== pack.product ||
      order.product !== pack.product ||
      (order.customer !== undefined && order.customer !== customer.id) ||
      order.amount < pack.price ||
      (metadata.datadeal_price_cents === undefined &&
        product.price !== pack.price) ||
      (order.amount_paid != null &&
        (order.amount_paid === 0 ||
          order.amount_paid < (order.amount_due ?? pack.price)))
    )
      return new Response("Point pack order does not match the checkout", {
        status: 422,
      });
    const result = await database
      .settlePointPackPurchase({
        userId: metadata.datadeal_user,
        email: customer.email,
        orderId: order.id,
        requestId: completed.data.request_id,
        points: pack.points,
        priceCents: pack.price,
      })
      .catch(() => "unavailable" as const);
    return new Response(null, {
      status:
        result === "conflict" ? 409 : result === "unavailable" ? 503 : 200,
    });
  }
  if (!Object.hasOwn(statuses, eventType)) return new Response(null);
  const config = billingConfig();
  const subscription = creemSubscription.safeParse(object);
  if (!subscription.success) return new Response(null, { status: 400 });
  const data = subscription.data;
  // An expired period can still belong to a subscription in payment recovery.
  const status =
    eventType === "subscription.expired" &&
    ["active", "unpaid", "past_due"].includes(data.status ?? "")
      ? "renewal_pending"
      : statuses[eventType];
  if (data.mode && data.mode !== connection.mode) {
    return new Response(null);
  }
  if (status === "active" && !data.current_period_end_date)
    return new Response(null, { status: 400 });
  const user = data.metadata?.datadeal_user;
  const boundUser =
    user &&
    matchesSignature(
      checkoutBinding(connection.secret, user, data.product),
      data.metadata?.datadeal_binding ?? null,
    )
      ? user
      : undefined;
  const result = await database.applyBillingEvent({
    id,
    time,
    subscription: data.id,
    customer: data.customer,
    product: data.product,
    userId: boundUser,
    existingProductOnly:
      !boundUser &&
      data.product !== config?.monthly &&
      data.product !== config?.yearly,
    status,
    accessUntil: data.current_period_end_date ?? undefined,
  });
  if (result === "cancel_subscription") {
    try {
      await cancelSubscription(data.id, data.customer);
    } catch {
      return new Response(null, { status: 503 });
    }
  }
  return new Response(null);
}
