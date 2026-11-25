import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../../lib/auth";
import {
  checkoutAccountPath,
  isCreditRequestId,
} from "../../../lib/checkout-return";
import { database } from "../../../lib/reports";
import { AccountForm } from "../account-form";
import { AccountLink, AccountScreen } from "../account-ui";
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
        <p role="status">
          Your purchase record is temporarily unavailable. Keep your receipt and
          refresh this page shortly.
        </p>
      )}
      {receipt && receipt.status !== "pending" ? (
        <AccountLink href="/account/developer">View API credits</AccountLink>
      ) : (
        <div className="text-sm text-muted">
          <p>
            Used another DataDeal account for checkout? Sign out to check this
            purchase with that account.
          </p>
          <AccountForm signedIn />
        </div>
      )}
    </AccountScreen>
  );
}
