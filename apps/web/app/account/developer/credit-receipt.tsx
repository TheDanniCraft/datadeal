import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../../lib/auth";
import {
  checkoutAccountPath,
  isCreditRequestId,
} from "../../../lib/checkout-return";
import { database } from "../../../lib/reports";
import { AccountForm } from "../account-form";
import Link from "next/link";
import { buttonVariants } from "@heroui/styles";
import { AccountCard, AccountRow, AccountScreen } from "../account-ui";
import { CheckoutReturnNotice } from "../billing/checkout-return-notice";

export async function CreditReceipt({ reference }: { reference: string }) {
  const session = await auth?.api.getSession({ headers: await headers() });
  if (!session) {
    const target = checkoutAccountPath("credits", reference);
    redirect("/account?returnTo=" + encodeURIComponent(target));
  }
  const receipt = database
    ? await database.creditReceiptDetails(
        session.user.id,
        isCreditRequestId(reference)
          ? { requestId: reference }
          : { orderId: reference },
      )
    : null;
  return (
    <AccountScreen
      current="/account/developer"
      title="Your credit purchase"
      description={`Signed in as ${session.user.email}.`}
    >
      {receipt ? (
        <CheckoutReturnNotice
          key={reference}
          kind="credits"
          reference={reference}
          receipt={receipt.status}
          credits={receipt.credits}
        />
      ) : (
        <p role="status" className="m-0 text-sm">
          Your purchase record is temporarily unavailable. Keep your receipt and
          refresh this page shortly.
        </p>
      )}
      <AccountCard>
        {receipt && receipt.status !== "pending" ? (
          <AccountRow
            title="API credits"
            description="See your balance and credit activity."
          >
            <Link
              className={buttonVariants({ variant: "primary", size: "sm" })}
              href="/account/developer"
            >
              View API credits
            </Link>
          </AccountRow>
        ) : (
          <AccountRow
            title="Used another DataDeal account for checkout?"
            description="Sign out to check this purchase with that account."
          >
            <div className="[&>form]:my-0">
              <AccountForm signedIn />
            </div>
          </AccountRow>
        )}
      </AccountCard>
    </AccountScreen>
  );
}
