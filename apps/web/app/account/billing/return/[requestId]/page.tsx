import { notFound } from "next/navigation";
import { isCheckoutRequestId } from "../../../../../lib/checkout-return";
import { BillingView } from "../../billing-view";

export const dynamic = "force-dynamic";

export default async function ProPurchaseReturn({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  if (!isCheckoutRequestId(requestId)) notFound();
  return <BillingView query={{}} fromCheckout requestId={requestId} />;
}
