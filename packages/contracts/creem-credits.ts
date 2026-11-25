import { z } from "zod";

export const creditAmount = z.string().regex(/^\d+$/);
export const accountBalance = z.object({
  balance: z.string().regex(/^-?\d+$/),
});
export const creditId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
export const nativeAccount = z.object({
  id: creditId,
  customer_id: creditId,
  name: z.string(),
  unit_label: z.string().nullish(),
});
export const nativeEntry = z.object({
  id: creditId,
  account_id: creditId,
  transaction_id: creditId,
  side: z.enum(["debit", "credit"]),
  amount: creditAmount,
  created_at: z.iso.datetime({ offset: true }),
});
export const nativeTransaction = z.object({
  id: creditId,
  reference: z.string().nullish(),
  idempotency_key: z.string().nullish(),
  reversal_of: creditId.nullish(),
  entries: z.array(nativeEntry),
});
export const accountPage = z.object({
  data: z.array(nativeAccount),
  has_more: z.boolean(),
});
export const entryPage = z.object({
  data: z.array(nativeEntry),
  has_more: z.boolean(),
});
export const txPage = z.object({
  data: z.array(nativeTransaction),
  has_more: z.boolean(),
});
export const creditFailure = z.object({
  error: z.object({ code: z.string() }),
});

// DataDeal submits one event per operation so every warning belongs to index 0.
export const usageEventReceipt = z.object({
  accepted: z.literal(1),
  event_ids: z.tuple([z.string()]),
  warnings: z
    .array(z.object({ index: z.literal(0), code: z.string().min(1) }))
    .default([]),
});
