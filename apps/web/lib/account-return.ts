import { domain } from "@datadeal/contracts";
import {
  checkoutAccountPath,
  checkoutReference,
  creditCheckoutReturnPrefix,
  isCreditRequestId,
  proCheckoutReturnPath,
  proCheckoutReturnPrefix,
  proCheckoutReference,
  proPlansPath,
} from "./checkout-return";
export function accountReturnPath(value: unknown) {
  if (
    value === "/account/rewards" ||
    (typeof value === "string" &&
      /^\/rewards\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(
        value,
      )) ||
    value === "/account/billing" ||
    value === proCheckoutReturnPath ||
    value === proPlansPath ||
    value === "/account/developer" ||
    value === "/account/library" ||
    value === "/data-flow"
  )
    return value;
  // Back to a report after signing in (e.g. to send a browser scan).
  if (typeof value === "string" && value.startsWith("/report/")) {
    const site = domain.safeParse(value.slice("/report/".length));
    if (site.success) return "/report/" + site.data;
  }
  const prefix = "/data-flow?provider=";
  if (typeof value === "string" && value.startsWith(prefix)) {
    const provider = domain.safeParse(value.slice(prefix.length));
    if (provider.success) return prefix + provider.data;
  }
  if (typeof value === "string") {
    if (
      value.startsWith(proCheckoutReturnPrefix) &&
      isCreditRequestId(value.slice(proCheckoutReturnPrefix.length))
    )
      return value;
    if (value.startsWith(proCheckoutReturnPath + "?")) {
      const reference = proCheckoutReference(
        Object.fromEntries(
          new URLSearchParams(value.slice(proCheckoutReturnPath.length + 1)),
        ),
      );
      if (reference && value === checkoutAccountPath("subscription", reference))
        return value;
    }
    if (
      value.startsWith(creditCheckoutReturnPrefix) &&
      isCreditRequestId(value.slice(creditCheckoutReturnPrefix.length))
    )
      return value;
    for (const kind of ["subscription", "credits"] as const) {
      const key = kind === "subscription" ? "subscription_id" : "order_id";
      const prefix = checkoutAccountPath(kind, null) + "?" + key + "=";
      if (!value.startsWith(prefix)) continue;
      const reference = checkoutReference(kind, {
        [key]: value.slice(prefix.length),
      });
      if (reference) return checkoutAccountPath(kind, reference);
    }
  }
  return "/account";
}
