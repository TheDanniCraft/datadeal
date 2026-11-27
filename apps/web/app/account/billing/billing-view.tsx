import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@heroui/react/chip";
import { buttonVariants } from "@heroui/styles";
import type { ReactNode } from "react";

import {
  AccountCard,
  AccountRow,
  AccountScreen,
  AccountSection,
  AccountStat,
} from "../account-ui";
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
import { LocalDate } from "../../../lib/local-date";
import { proPlanFeatures } from "../../../lib/pro-plan";

const smallLink = buttonVariants({ variant: "secondary", size: "sm" });

type StatusColor = "default" | "success" | "warning" | "danger";

/** A plan name with a small status chip beside it. */
function PlanTitle({
  name,
  status,
  color,
}: {
  name: ReactNode;
  status: string;
  color: StatusColor;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-base font-semibold">{name}</span>
      <Chip size="sm" variant="soft" color={color}>
        {status}
      </Chip>
    </span>
  );
}

function BenefitList() {
  return (
    <ul className="m-0 grid list-none gap-2 p-4 text-sm sm:grid-cols-2">
      {proPlanFeatures.map((benefit) => (
        <li key={benefit} className="flex items-start gap-2">
          <svg
            className="mt-0.5 shrink-0 text-accent"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12 5 5 9-10" />
          </svg>
          {benefit}
        </li>
      ))}
    </ul>
  );
}

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
          <p role="status" className="m-0 text-sm">
            We couldn’t check your subscription. Keep your receipt and refresh
            this page shortly.
          </p>
        )}
        <AccountCard>
          <AccountRow
            title="Account membership"
            description="See the plan on this account."
          >
            <Link className={smallLink} href="/account/billing">
              View account membership
            </Link>
          </AccountRow>
          <AccountRow
            title="Used another DataDeal account?"
            description="Sign out to check this receipt with that account."
          >
            <div className="[&>form]:my-0">
              <AccountForm signedIn />
            </div>
          </AccountRow>
        </AccountCard>
      </AccountScreen>
    );
  }
  if (!hasSubscription && !choosingPlan) {
    const expired = billing?.status === "expired";
    return (
      <AccountScreen
        title="Your membership"
        description={`Signed in as ${session.user.email}.`}
        current="/account/billing"
      >
        <AccountSection title="Plan" description="Your current DataDeal plan.">
          <AccountCard>
            <AccountRow
              title={
                <PlanTitle
                  name="Free plan"
                  status={expired ? "Pro expired" : "Current"}
                  color="default"
                />
              }
              description={
                expired
                  ? "Your previous Pro subscription expired."
                  : "This account has no active Pro subscription."
              }
            >
              <Link
                className={buttonVariants({ variant: "primary" })}
                href={proPlansPath}
              >
                View Pro plans
              </Link>
            </AccountRow>
            <AccountRow
              title="Check a recent purchase"
              description="Bought Pro and it isn’t showing yet? Check your latest checkout."
            >
              <Link className={smallLink} href={proCheckoutReturnPath}>
                Check purchase
              </Link>
            </AccountRow>
          </AccountCard>
        </AccountSection>
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
  const planStatus: { label: string; color: StatusColor } = billing?.has_access
    ? billing.status === "canceled"
      ? { label: "Not renewing", color: "warning" }
      : billing.status === "past_due"
        ? { label: "Past due", color: "danger" }
        : { label: "Active", color: "success" }
    : billing?.status === "paused"
      ? { label: "Paused", color: "warning" }
      : { label: "Awaiting renewal", color: "warning" };
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
      {reference && receipt && (
        <CheckoutReturnNotice
          key={reference}
          kind="subscription"
          reference={reference}
          receipt={receipt}
        />
      )}
      {hasSubscription ? (
        <>
          <AccountSection
            title="Plan"
            description="Your subscription and when it renews."
          >
            <AccountCard>
              <AccountRow
                title={
                  <PlanTitle
                    name={planName || "Your subscription"}
                    status={planStatus.label}
                    color={planStatus.color}
                  />
                }
                description={
                  billing?.has_access ? (
                    billing.status === "canceled" ? (
                      <>
                        Pro is active until{" "}
                        <LocalDate value={billing.access_until} />. Your
                        subscription will not renew.
                      </>
                    ) : billing.status === "past_due" ? (
                      <>
                        Payment is past due. Pro access continues until{" "}
                        <LocalDate value={billing.access_until} />.
                      </>
                    ) : (
                      <>
                        Pro is active through{" "}
                        <LocalDate
                          value={billing.access_until}
                          options={{ dateStyle: "long" }}
                        />
                        .
                      </>
                    )
                  ) : (
                    <span role="status">
                      {billing?.status === "paused"
                        ? "Your Pro subscription is paused."
                        : "Your paid Pro period has ended. We’re waiting for renewal confirmation."}{" "}
                      {portal
                        ? "Manage your existing subscription to check its status and payment details."
                        : "Subscription management is temporarily unavailable. Try again shortly."}
                    </span>
                  )
                }
              >
                {billing?.customer_id && portal && <BillingPortalButton />}
              </AccountRow>
              {billing?.has_access && (
                <AccountRow
                  title="Data flow"
                  description="Explore evidence-backed data flows."
                >
                  <Link className={smallLink} href="/data-flow">
                    Explore data flow
                  </Link>
                </AccountRow>
              )}
            </AccountCard>
          </AccountSection>
          {billing?.has_access && (
            <AccountSection
              title="Included with Pro"
              description="Ad-free, with every advanced report open."
            >
              <AccountCard>
                <BenefitList />
              </AccountCard>
            </AccountSection>
          )}
        </>
      ) : (
        <AccountSection
          title="Pro membership"
          description="Ad-free everywhere, every advanced report open, watched sites with email alerts and free skip-the-line scans."
        >
          <AccountCard>
            {billing?.status === "expired" && (
              <AccountRow
                title={
                  <PlanTitle
                    name="Free plan"
                    status="Pro expired"
                    color="default"
                  />
                }
                description="Your previous Pro subscription expired."
              />
            )}
            <BenefitList />
            {!checkout ? (
              <>
                <div className="grid grid-cols-2 divide-x divide-separator">
                  <AccountStat
                    label="Monthly"
                    value={format.format(pricing.monthly / 100)}
                    note="per month"
                  />
                  <AccountStat
                    label="Yearly"
                    value={format.format(pricing.yearly / 100)}
                    note="per year"
                  />
                </div>
                <AccountRow
                  title="Checkout"
                  description="Pro checkout is currently unavailable."
                />
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4">
                <div className="grid min-w-0 flex-1 basis-56 gap-0.5">
                  <div className="text-sm font-medium">Choose how to pay</div>
                  <div className="text-sm text-muted">
                    Billed monthly or once a year.
                  </div>
                </div>
                <CheckoutButtons
                  monthly={format.format(pricing.monthly / 100)}
                  yearly={format.format(pricing.yearly / 100)}
                  yearlyBestValue={pricing.yearlyBestValue}
                />
              </div>
            )}
          </AccountCard>
        </AccountSection>
      )}
    </AccountScreen>
  );
}
