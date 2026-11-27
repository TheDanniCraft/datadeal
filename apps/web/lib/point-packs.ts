import { z } from "zod";
import {
  creemConnection,
  creemMode,
  matchesSignature,
  purchasedCreditPack,
  signature,
} from "./billing";
import { pointsEnabled } from "./local-reward";

export type PointPack = { points: number; price: number; product: string };

const pointsPattern = /^[1-9]\d{0,8}$/;
const pricePattern = /^[1-9]\d{2,8}$/;
const productPattern = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Parse `points:priceCents:productId,...`. Any malformed or repeated entry
 * withholds every pack, so a typo can never sell the wrong amount.
 */
export function parsePointPacks(value: string | undefined) {
  if (!value?.trim()) return null;
  const packs: PointPack[] = [];
  for (const entry of value.split(",")) {
    const parts = entry.trim().split(":");
    if (parts.length !== 3) return null;
    const [points, price, product] = parts.map((part) => part.trim());
    if (
      !pointsPattern.test(points) ||
      !pricePattern.test(price) ||
      !productPattern.test(product)
    )
      return null;
    packs.push({ points: Number(points), price: Number(price), product });
  }
  if (new Set(packs.map((pack) => pack.product)).size !== packs.length)
    return null;
  if (new Set(packs.map((pack) => pack.points)).size !== packs.length)
    return null;
  return packs.sort((a, b) => a.points - b.points);
}

/** The single earlier credit pack, sold as points (1 credit = 100 points). */
function legacyCreditPack(env: NodeJS.ProcessEnv) {
  const {
    CREEM_CREDIT_PACK_PRODUCT: product,
    CREEM_CREDIT_PACK_CREDITS: credits,
    CREEM_CREDIT_PACK_PRICE_CENTS: price,
  } = env;
  if (
    !product ||
    !productPattern.test(product) ||
    !/^[1-9]\d{0,6}$/.test(credits ?? "") ||
    !pricePattern.test(price ?? "")
  )
    return null;
  return [{ points: Number(credits) * 100, price: Number(price), product }];
}

/** Point packs for either Creem mode, never sharing a Pro product. */
export function pointPackConfig(env: NodeJS.ProcessEnv = process.env) {
  const connection = creemConnection();
  if (!connection) return null;
  const packs = env.CREEM_POINT_PACKS?.trim()
    ? parsePointPacks(env.CREEM_POINT_PACKS)
    : legacyCreditPack(env);
  if (
    !packs?.length ||
    packs.some(
      (pack) =>
        pack.product === env.CREEM_MONTHLY_PRODUCT ||
        pack.product === env.CREEM_YEARLY_PRODUCT,
    )
  )
    return null;
  return { ...connection, packs };
}

/** Packs a signed-in buyer may open a checkout for, while points are on. */
export function purchasablePointPacks() {
  return pointsEnabled() ? pointPackConfig() : null;
}

export function pointPackBinding(
  secret: string,
  user: string,
  product: string,
  requestId: string,
  points: number,
  price: number,
) {
  return signature(
    secret,
    JSON.stringify([
      "datadeal-point-pack",
      user,
      product,
      requestId,
      points,
      price,
      "EUR",
    ]),
  );
}

export type PointPackOffer = PointPack & {
  /** Price of 1,000 points in cents, rounded to a whole cent. */
  perThousand: number;
  /** Whole percent saved per point against the smallest pack. */
  save: number;
};

export function describePointPacks(packs: PointPack[]): PointPackOffer[] {
  const sorted = [...packs].sort((a, b) => a.points - b.points);
  const base = sorted[0] ? sorted[0].price / sorted[0].points : 0;
  return sorted.map((pack) => {
    const rate = pack.price / pack.points;
    return {
      ...pack,
      perThousand: Math.round(rate * 1000),
      save: base ? Math.max(0, Math.floor((1 - rate / base) * 100 + 1e-9)) : 0,
    };
  });
}

const packCheckout = z.object({
  object: z.literal("checkout"),
  mode: creemMode,
  request_id: z.uuid(),
  product: z.union([
    z.string().min(1).max(100),
    z.object({ id: z.string().min(1).max(100) }).transform((item) => item.id),
  ]),
  metadata: z.object({
    datadeal_user: z.string().min(1).max(100),
    datadeal_binding: z.string(),
    datadeal_pack_points: z.string().regex(pointsPattern).optional(),
    datadeal_price_cents: z.string().regex(pricePattern).optional(),
  }),
});

/**
 * The pack a completed checkout was signed for. A checkout opened for
 * the earlier credit pack is honoured in points (1 credit = 100 points).
 */
export function purchasedPointPack(
  object: unknown,
  secret: string,
): PointPack | null {
  const target = packCheckout.safeParse(object);
  if (!target.success) return null;
  const { product, metadata, request_id } = target.data;
  const { datadeal_pack_points: points, datadeal_price_cents: price } =
    metadata;
  if (points === undefined || price === undefined) {
    const legacy = purchasedCreditPack(object, secret);
    return legacy
      ? {
          product: legacy.product,
          points: legacy.credits * 100,
          price: legacy.price,
        }
      : null;
  }
  const pack = { product, points: Number(points), price: Number(price) };
  const expected = pointPackBinding(
    secret,
    metadata.datadeal_user,
    product,
    request_id,
    pack.points,
    pack.price,
  );
  return matchesSignature(expected, metadata.datadeal_binding) ? pack : null;
}
