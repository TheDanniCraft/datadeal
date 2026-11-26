import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { localPointsEnabled } from "../../lib/local-reward";
import { database } from "../../lib/reports";
import { accountReturnPath } from "../../lib/account-return";
import {
  creditCheckoutReturnPrefix,
  proCheckoutReturnPath,
} from "../../lib/checkout-return";
import { AccountForm } from "./account-form";
import { DeleteAccount } from "./delete-account";
import { PrivacyProfile } from "./privacy-profile";
import { AccountIcon, AccountScreen } from "./account-ui";
import { localOutboxName } from "./local-mail";
import { AccountOverview } from "./overview";
import { ItemCard } from "@heroui-pro/react/item-card";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[]; error?: string }>;
}) {
  const query = await searchParams;
  const returnTo = accountReturnPath(query.returnTo);
  const returningFromProCheckout =
    returnTo.startsWith(proCheckoutReturnPath) ||
    returnTo.startsWith("/account/billing?subscription_id=");
  const returningFromCreditCheckout =
    returnTo.startsWith(creditCheckoutReturnPrefix) ||
    returnTo.startsWith("/account/developer?order_id=");
  const checkingMembership = returnTo === "/account/billing";
  let heading = "Sign in to DataDeal";
  let instructions =
    "Enter your email to sign in or create an account. Your one-time link expires in 10 minutes.";
  if (checkingMembership || returningFromProCheckout) {
    heading = checkingMembership
      ? "Sign in to view your membership"
      : "Check your Pro subscription";
    instructions =
      "Use the email you used for DataDeal. If you’ve already paid, signing in opens your existing membership.";
  } else if (returningFromCreditCheckout) {
    heading = "Check your credit purchase";
    instructions =
      "Sign in to the DataDeal account that ordered the credits to see your balance and receipt.";
  }
  const session = await auth?.api.getSession({ headers: await headers() });
  if (session && returnTo !== "/account") redirect(returnTo);
  const outbox = localOutboxName();
  if (!session)
    return (
      <div className="mx-auto grid min-h-[65vh] w-full max-w-md grid-cols-1 content-center gap-5 py-10">
        <ItemCard className="block w-full min-w-0 p-6 shadow-surface md:p-9">
          <ItemCard.Content className="gap-3">
            <ItemCard.Icon>
              <AccountIcon name="mail" />
            </ItemCard.Icon>
            <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
            <ItemCard.Description className="whitespace-normal">
              {instructions}
            </ItemCard.Description>
            {query.error && (
              <p role="alert">
                Your sign-in link is invalid or has expired. Request a new one
                below.
              </p>
            )}
            {auth ? (
              <AccountForm
                signedIn={false}
                returnTo={returnTo}
                localOutbox={outbox}
              />
            ) : (
              <p role="status">Sign-in is unavailable in this environment.</p>
            )}
          </ItemCard.Content>
        </ItemCard>
        <p className="text-center text-sm text-muted">
          Building with DataDeal?{" "}
          <Link
            className="text-accent underline underline-offset-2"
            href="/developers"
          >
            Read the API docs
          </Link>
        </p>
      </div>
    );
  const profile =
    database && (await database.hasPro(session.user.id))
      ? ((await database.privacyProfile(session.user.id)) ?? "standard")
      : null;
  return (
    <AccountScreen
      title="Account"
      description={"Signed in as " + session.user.email}
      current="/account"
    >
      <AccountOverview userId={session.user.id} points={localPointsEnabled()} />
      <h2 className="border-t border-separator pt-8 text-lg font-semibold tracking-tight">
        Settings
      </h2>
      <Link href="/account/developer" className="block">
        <ItemCard className="hover:bg-surface-secondary">
          <ItemCard.Icon>
            <AccountIcon name="developer" />
          </ItemCard.Icon>
          <ItemCard.Content>
            <ItemCard.Title>Developer API</ItemCard.Title>
            <ItemCard.Description className="whitespace-normal">
              Tokens and credit activity for the DataDeal API.
            </ItemCard.Description>
          </ItemCard.Content>
        </ItemCard>
      </Link>
      {profile && (
        <section className="space-y-3" aria-label="Privacy profile">
          <h3 className="text-base font-semibold">Privacy profile</h3>
          <PrivacyProfile saved={profile} />
        </section>
      )}
      <section className="space-y-3">
        <h3 className="text-base font-semibold">Account data</h3>
        <p className="text-sm text-muted">
          Your download includes your profile, Pro billing records, unlocked
          reports and API credit activity.
        </p>
        <a
          href="/api/v1/account/export"
          className="text-accent underline underline-offset-2"
        >
          Download account data
        </a>
      </section>
      <section className="space-y-3">
        <h3 className="text-base font-semibold">Account access</h3>
        <AccountForm signedIn />
        <DeleteAccount localOutbox={outbox} />
      </section>
    </AccountScreen>
  );
}
