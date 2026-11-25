import { notFound } from "next/navigation";
import { isCreditRequestId } from "../../../../../lib/checkout-return";
import { CreditReceipt } from "../../credit-receipt";

export const dynamic = "force-dynamic";

export default async function CreditCheckoutReturn({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  if (!isCreditRequestId(requestId)) notFound();
  return <CreditReceipt reference={requestId} />;
}
