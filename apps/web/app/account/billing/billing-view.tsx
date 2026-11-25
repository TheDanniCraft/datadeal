import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Card } from "@heroui/react/card";

import { AccountScreen, AccountLink } from "../account-ui";
import { AccountForm } from "../account-form";
import { getPricing } from "@datadeal/config";
import { auth } from "../../../lib/auth";
import { billingConfig, creemConnection } from "../../../lib/billing";
import { database } from "../../../lib/reports";
import { BillingPortalButton } from "./billing-portal-button";
import { CheckoutButtons } from "./checkout-buttons";
import { CheckoutReturnNotice } from "./checkout-return-notice";
import {
  checkoutAccountPath,
  proCheckoutReference,
  proCheckoutReturnPath,
  proPlansPath,
  type CheckoutReturnQuery,
} from "../../../lib/checkout-return";

export async function BillingView({
  query,
  fromCheckout = false,
  requestId,
}: {
  query: CheckoutReturnQuery;
  fromCheckout?: boolean;
  requestId?: string;
}) {
  const reference = requestId ?? proCheckoutReference(query);
  const returning = fromCheckout || Boolean(reference);
  const choosingPlan = !returning && query.view === "plans";
  const pricing = getPricing();
  const checkout = auth && database && billingConfig();
  const portal = auth && database && creemConnection();
  const session = await auth?.api.getSession({ headers: await headers() });
  if (!session) {
    const target = choosingPlan
      ? proPlansPath
      : returning && !reference
        ? proCheckoutReturnPath
        : checkoutAccountPath("subscription", reference);
    redirect("/account?returnTo=" + encodeURIComponent(target));
  }
  const billing = database
    ? await database.billingSummary(session.user.id, reference)
    : null;
  const receipt =
    !reference || !database
      ? null
      : !billing
        ? "pending"
        : billing.has_access
          ? "confirmed"
          : "inactive";
  const hasSubscription = billing?.has_access || billing?.needs_management;
  const waitingForAccount = returning && !reference && !hasSubscription;
  if (waitingForAccount || (reference && receipt !== "confirmed")) {
    return (
      <AccountScreen
        title="Your Pro checkout"
        description={`Signed in as ${session.user.email}.`}
        current="/account/billing"
      >
        {receipt || waitingForAccount ? (
          <CheckoutReturnNotice
            key={reference}
            kind="subscription"
            reference={reference}
            receipt={receipt ?? "pending"}
          />
        ) : (
          <p role="status">
            We couldn’t check your subscription. Keep your receipt and refresh
            this page shortly.
          </p>
        )}
        <div className="space-y-3 text-sm text-muted">
          <AccountLink secondary href="/account/billing">
            View account membership
          </AccountLink>
          <p>
            Used another DataDeal account? Sign out to check this receipt with
            that account.
          </p>
          <AccountForm signedIn />
        </div>
      </AccountScreen>
    );
  }
  if (!hasSubscription && !choosingPlan) {
    return (
      <AccountScreen
        title="Your membership"
        description={`Signed in as ${session.user.email}.`}
        current="/account/billing"
      >
        <Card className="p-5 md:p-7">
          <Card.Content className="items-start gap-4">
            <h2 className="text-xl font-semibold">Free plan</h2>
            <p>
              {billing?.status === "expired"
                ? "Your previous Pro subscription expired."
                : "This account has no active Pro subscription."}
            </p>
            <AccountLink href={proCheckoutReturnPath}>
              Check a recent purchase
            </AccountLink>
            <AccountLink secondary href={proPlansPath}>
              View Pro plans
            </AccountLink>
          </Card.Content>
        </Card>
      </AccountScreen>
    );
  }
  const format = new Intl.NumberFormat("en", {
    style: "currency",
    currency: pricing.currency,
  });
  const planName =
    billing &&
    checkout &&
    (billing.product_id === checkout.yearly
      ? "Annual Pro"
      : billing.product_id === checkout.monthly
        ? "Monthly Pro"
        : null);
  const accessThrough =
    billing &&
    new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(billing.access_until);
  return (
    <AccountScreen
      title="DataDeal Pro"
      description={
        hasSubscription && session
          ? `Subscription for ${session.user.email}.`
          : "Manage your subscription and get ad-free access to available advanced reports."
      }
      current={session ? "/account/billing" : undefined}
    >
      <Card className="p-5 md:p-7">
        <Card.Content className="items-start gap-4">
          {reference && receipt && (
            <CheckoutReturnNotice
              key={reference}
              kind="subscription"
              reference={reference}
              receipt={receipt}
            />
          )}
          <h2 className="text-xl font-semibold tracking-tight">
            {hasSubscription
              ? planName || "Your subscription"
              : "Pro membership"}
          </h2>
          {!hasSubscription && (
            <p>
              Explore evidence-backed data flows and deeper findings wherever an
              advanced report is available.
            </p>
          )}
          {!hasSubscription && !checkout && (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <span>
                <strong>{format.format(pricing.monthly / 100)}</strong> / month
              </span>
              <span>
                <strong>{format.format(pricing.yearly / 100)}</strong> / year
              </span>
            </div>
          )}
          {billing?.has_access ? (
            billing.status === "canceled" ? (
              <p>
                Pro is active until{" "}
                {billing.access_until.toISOString().slice(0, 10)} UTC. Your
                subscription will not renew.
              </p>
            ) : billing.status === "past_due" ? (
              <p>
                Payment is past due. Pro access continues until{" "}
                {billing.access_until.toISOString().slice(0, 10)} UTC.
              </p>
            ) : (
              <p>
                Pro is active through {accessThrough}. Your reports are ad-free
                and include the advanced analysis wherever available.
              </p>
            )
          ) : billing?.needs_management ? (
            <p role="status">
              {billing.status === "paused"
                ? "Your Pro subscription is paused."
                : "Your paid Pro period has ended. We’re waiting for renewal confirmation."}{" "}
              {portal
                ? "Manage your existing subscription to check its status and payment details."
                : "Subscription management is temporarily unavailable. Try again shortly."}
            </p>
          ) : !checkout ? (
            <p>Pro checkout is currently unavailable.</p>
          ) : (
            <>
              {checkout.mode === "test" &&
                process.env.NODE_ENV !== "production" && (
                  <p>Sandbox checkout is available for testing.</p>
                )}
              <CheckoutButtons
                monthly={format.format(pricing.monthly / 100)}
                yearly={format.format(pricing.yearly / 100)}
                yearlyBestValue={pricing.yearlyBestValue}
              />
            </>
          )}
          {billing && !billing.has_access && billing.status === "expired" && (
            <p>Your previous Pro subscription expired.</p>
          )}
          {billing?.has_access && (
            <AccountLink href="/data-flow">Explore data flow</AccountLink>
          )}
          {billing?.customer_id && portal && <BillingPortalButton />}
        </Card.Content>
      </Card>
    </AccountScreen>
  );
}
