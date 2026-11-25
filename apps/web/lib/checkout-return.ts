export type CheckoutKind = "subscription" | "credits";
export type CheckoutReceipt = "pending" | "confirmed" | "refunded" | "inactive";
export const proCheckoutReturnPath = "/account/billing/return";
export const proCheckoutReturnPrefix = proCheckoutReturnPath + "/";
export const proPlansPath = "/account/billing?view=plans";
export const creditCheckoutReturnPrefix = "/account/developer/return/";
export function isCheckoutRequestId(
  value: unknown,
): value is `${string}-${string}-${string}-${string}-${string}` {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  );
}
export const isCreditRequestId = isCheckoutRequestId;
export type CheckoutReturnQuery = {
  view?: string | string[];
  checkout_id?: string | string[];
  subscription_id?: string | string[];
  order_id?: string | string[];
};

export function proCheckoutReference(query: CheckoutReturnQuery) {
  return (
    checkoutReference("subscription", query) ??
    (typeof query.checkout_id === "string" &&
    /^ch_[a-zA-Z0-9_-]{1,100}$/.test(query.checkout_id)
      ? query.checkout_id
      : null) ??
    checkoutReference("credits", query)
  );
}

export function checkoutReference(
  kind: CheckoutKind,
  query: CheckoutReturnQuery,
) {
  const subscription = kind === "subscription";
  const reference = subscription ? query.subscription_id : query.order_id;
  const format = subscription
    ? /^sub_[a-zA-Z0-9_-]{1,100}$/
    : /^ord_[a-zA-Z0-9_-]{1,100}$/;
  return typeof reference === "string" && format.test(reference)
    ? reference
    : null;
}

export function checkoutAccountPath(
  kind: CheckoutKind,
  reference: string | null,
) {
  if (kind === "subscription" && reference) {
    if (isCheckoutRequestId(reference))
      return proCheckoutReturnPrefix + reference;
    if (reference.startsWith("ch_"))
      return proCheckoutReturnPath + "?checkout_id=" + reference;
    if (reference.startsWith("ord_"))
      return proCheckoutReturnPath + "?order_id=" + reference;
  }
  if (kind === "credits" && isCreditRequestId(reference))
    return creditCheckoutReturnPrefix + reference;
  const path =
    kind === "subscription" ? "/account/billing" : "/account/developer";
  const key = kind === "subscription" ? "subscription_id" : "order_id";
  return reference ? path + "?" + key + "=" + reference : path;
}
