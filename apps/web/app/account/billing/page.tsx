import { BillingView } from "./billing-view";
import type { CheckoutReturnQuery } from "../../../lib/checkout-return";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<CheckoutReturnQuery>;
}) {
  return <BillingView query={await searchParams} />;
}
