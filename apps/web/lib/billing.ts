import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { creditServiceAccessible } from "./credit-service-access";
import {
  developerApiPreview,
  developerReportReadCost,
  developerScanCost,
} from "./developer-token";

export function creemConnection() {
  const {
    CREEM_API_KEY: key,
    CREEM_WEBHOOK_SECRET: secret,
    CREEM_MODE: mode,
  } = process.env;
  if (!key || !secret || (mode !== "test" && mode !== "live")) return null;
  return {
    key,
    secret,
    mode,
    api: mode === "test" ? "https://test-api.creem.io" : "https://api.creem.io",
  };
}

export function billingConfig() {
  const connection = creemConnection();
  const { CREEM_MONTHLY_PRODUCT: monthly, CREEM_YEARLY_PRODUCT: yearly } =
    process.env;
  return connection && monthly && yearly && monthly !== yearly
    ? { ...connection, monthly, yearly }
    : null;
}

/**
 * The earlier API credit pack. Kept so older signed checkouts verify and as
 * the fallback for CREEM_POINT_PACKS; new purchases are point packs.
 */
export function creditPackConfig() {
  const connection = creemConnection();
  const {
    CREEM_CREDIT_PACK_PRODUCT: product,
    CREEM_CREDIT_PACK_CREDITS: credits,
    CREEM_CREDIT_PACK_PRICE_CENTS: price,
    CREEM_MONTHLY_PRODUCT,
    CREEM_YEARLY_PRODUCT,
  } = process.env;
  if (
    connection?.mode !== "test" ||
    !product ||
    product === CREEM_MONTHLY_PRODUCT ||
    product === CREEM_YEARLY_PRODUCT ||
    !/^[1-9]\d{0,8}$/.test(credits ?? "") ||
    !/^[1-9]\d{2,8}$/.test(price ?? "")
  )
    return null;
  return {
    ...connection,
    product,
    credits: Number(credits),
    price: Number(price),
  };
}
/** Kept for history: credit packs are no longer offered (see point-packs). */
export async function purchasableCreditPack() {
  const origin = process.env.APP_ORIGIN;
  if (
    !developerApiPreview ||
    (developerReportReadCost === null && developerScanCost === null) ||
    !origin ||
    !URL.canParse(origin) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)
  )
    return null;
  const config = creditPackConfig();
  return config && (await creditServiceAccessible(config)) ? config : null;
}

export function signature(secret: string, payload: string | Uint8Array) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
export function matchesSignature(expected: string, provided: string | null) {
  return Boolean(
    provided &&
    /^[a-f0-9]{64}$/i.test(provided) &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex")),
  );
}
export function checkoutBinding(secret: string, user: string, product: string) {
  return signature(
    secret,
    JSON.stringify(["datadeal-checkout", user, product]),
  );
}

export function creditPackBinding(
  secret: string,
  user: string,
  product: string,
  requestId: string,
  credits: number,
  price: number,
) {
  return signature(
    secret,
    JSON.stringify([
      "datadeal-credit-pack",
      user,
      product,
      requestId,
      credits,
      price,
      "EUR",
    ]),
  );
}

const sandboxMode = z.enum(["test", "sandbox"]);
/** Either Creem mode, normalised to the CREEM_MODE spelling. */
export const creemMode = z
  .enum(["test", "sandbox", "prod", "live"])
  .transform((mode) =>
    mode === "test" || mode === "sandbox"
      ? ("test" as const)
      : ("live" as const),
  );
const optionalAmount = z.number().int().nonnegative().nullish();
const reference = z.union([
  z.string().min(1).max(100),
  z.object({ id: z.string().min(1).max(100) }).transform((item) => item.id),
]);
const packMetadata = z.object({
  datadeal_user: z.string().min(1).max(100),
  datadeal_binding: z.string(),
  datadeal_pack_credits: z
    .string()
    .regex(/^[1-9]\d{0,8}$/)
    .optional(),
  datadeal_pack_points: z
    .string()
    .regex(/^[1-9]\d{0,8}$/)
    .optional(),
  datadeal_price_cents: z
    .string()
    .regex(/^[1-9]\d{2,8}$/)
    .optional(),
});
export const proReceiptMarker = z.object({
  metadata: z.object({ datadeal_pro_request: z.uuid() }),
});
export const creemProCheckout = z
  .object({
    object: z.literal("checkout"),
    status: z.literal("completed"),
    id: z.string().regex(/^ch_[a-zA-Z0-9_-]{1,100}$/),
    request_id: z.uuid(),
    mode: z
      .enum(["test", "sandbox", "prod", "live"])
      .transform((m) =>
        m === "test" || m === "sandbox" ? ("test" as const) : ("live" as const),
      ),
    metadata: z.object({
      datadeal_user: z.string().min(1).max(100),
      datadeal_binding: z.string(),
      datadeal_pro_request: z.uuid(),
    }),
    product: reference,
    customer: reference,
    subscription: z
      .union([
        z.string(),
        z.object({
          id: z.string(),
          product: reference.optional(),
          customer: reference.optional(),
        }),
      ])
      .transform((s) => (typeof s === "string" ? { id: s } : s)),
    order: z
      .union([
        z.string(),
        z.object({
          id: z.string(),
          product: reference.optional(),
          customer: reference.optional(),
        }),
      ])
      .transform((o) => (typeof o === "string" ? { id: o } : o))
      .nullish(),
  })
  .refine(
    (c) =>
      /^sub_[a-zA-Z0-9_-]{1,100}$/.test(c.subscription.id) &&
      (!c.order || /^ord_[a-zA-Z0-9_-]{1,100}$/.test(c.order.id)) &&
      c.request_id === c.metadata.datadeal_pro_request &&
      [c.subscription, c.order].every(
        (part) =>
          !part ||
          ((!part.product || part.product === c.product) &&
            (!part.customer || part.customer === c.customer)),
      ),
  );
const creditPackTarget = z.object({
  object: z.literal("checkout"),
  mode: sandboxMode,
  request_id: z.uuid(),
  product: reference,
  metadata: packMetadata,
});

export const creemCreditCheckout = z.object({
  object: z.literal("checkout"),
  status: z.literal("completed"),
  mode: creemMode,
  request_id: z.uuid(),
  customer: z.object({ id: z.string().min(1).max(160), email: z.email() }),
  product: z.object({
    id: z.string(),
    billing_type: z.literal("onetime"),
    currency: z.literal("EUR"),
    price: z.number().int().positive(),
  }),
  order: z.object({
    id: z.string().min(1).max(100),
    product: z.string(),
    customer: z.string().optional(),
    status: z.literal("paid"),
    currency: z.literal("EUR"),
    amount: z.number().int().positive(),
    amount_due: optionalAmount,
    amount_paid: optionalAmount,
  }),
  metadata: packMetadata,
});

export function purchasedCreditPack(object: unknown, secret: string) {
  const target = creditPackTarget.safeParse(object);
  if (!target.success) return null;
  const { product, metadata, request_id } = target.data;
  const { datadeal_pack_credits: credits, datadeal_price_cents: price } =
    metadata;
  if ((credits === undefined) !== (price === undefined)) return null;
  // Older checkouts signed the same inputs but only stored the signature in Creem.
  const pack =
    credits === undefined
      ? creditPackConfig()
      : { product, credits: Number(credits), price: Number(price) };
  if (!pack || pack.product !== product) return null;
  const expected = creditPackBinding(
    secret,
    metadata.datadeal_user,
    product,
    request_id,
    pack.credits,
    pack.price,
  );
  return matchesSignature(expected, metadata.datadeal_binding) ? pack : null;
}

export const creemFullRefund = z.object({
  object: z.literal("refund"),
  status: z.literal("succeeded"),
  mode: creemMode.optional(),
  refund_currency: z.literal("EUR"),
  transaction: z.looseObject({
    id: z.string().min(1).max(100),
    status: z.literal("refunded"),
    type: z.literal("payment").optional(),
    mode: creemMode.optional(),
  }),
  subscription: z.nullish(z.never()),
  order: z
    .union([z.string(), z.object({ product: z.string().optional() })])
    .nullish(),
});

export const creemRefundedPayment = z
  .object({
    id: z.string(),
    object: z.literal("transaction"),
    mode: creemMode,
    type: z.literal("payment"),
    currency: z.literal("EUR"),
    status: z.literal("refunded"),
    order: z.string().min(1).max(100),
    amount_paid: optionalAmount,
    refunded_amount: optionalAmount,
  })
  .refine(
    (payment) =>
      payment.refunded_amount == null ||
      payment.amount_paid == null ||
      payment.refunded_amount === payment.amount_paid,
  );
export const creemEnvelope = z.object({
  id: z.string().min(1).max(100),
  eventType: z.string(),
  created_at: z.number().int().positive(),
  object: z.unknown(),
});
export const creemSubscription = z.object({
  id: z.string().min(1).max(100),
  status: z.string().optional(),
  product: reference,
  customer: reference,
  current_period_end_date: z.iso.datetime({ offset: true }).nullish(),
  mode: z
    .enum(["test", "live", "prod", "sandbox"])
    .transform((mode) =>
      mode === "prod" ? "live" : mode === "sandbox" ? "test" : mode,
    )
    .optional(),
  metadata: z
    .object({
      datadeal_user: z.string().max(100).optional(),
      datadeal_binding: z.string().optional(),
    })
    .nullish(),
});
