import Link from "next/link";
import { Card } from "@heroui/react/card";
import { AccountIcon, AccountLink, AccountScreen } from "../account-ui";
import { ApiRates, ApiExample } from "../../developers/api-reference";
import { headers } from "next/headers";
import { auth } from "../../../lib/auth";
import { purchasableCreditPack } from "../../../lib/billing";
import { customerCreditSummary } from "../../../lib/customer-credit-summary";
import {
  developerApiPreview,
  developerScanCost,
} from "../../../lib/developer-token";
import { database } from "../../../lib/reports";
import { ApiTokens } from "./api-tokens";
import { AccountDetails } from "./account-details";
import { CreditPackCheckout } from "../billing/checkout-buttons";
import { CreditReceipt } from "./credit-receipt";
import {
  checkoutReference,
  type CheckoutReturnQuery,
} from "../../../lib/checkout-return";

export const dynamic = "force-dynamic";

const activityLabels = {
  pack: "Credit pack purchase",
  pack_refund: "Credit pack refund",
  scan: "Scan request",
  read: "Report read",
  scan_refund: "Scan credits returned",
  read_refund: "Report credits returned",
};

export default async function DeveloperAccountPage({
  searchParams,
}: {
  searchParams: Promise<CheckoutReturnQuery>;
}) {
  const reference = checkoutReference("credits", await searchParams);
  if (reference) return <CreditReceipt reference={reference} />;
  const session = await auth?.api.getSession({ headers: await headers() });
  const account =
    session && database
      ? await Promise.all([
          database.listApiTokens(session.user.id),
          database.apiCreditSummary(session.user.id),
          customerCreditSummary(database, session.user.id),
          session.user.emailVerified ? purchasableCreditPack() : null,
        ])
      : null;
  const [tokens, legacy, wallet, pack] = account ?? [];
  const activity =
    session && database && wallet?.entries.length
      ? await database.creemCreditActivity(
          session.user.id,
          wallet.entries.map((entry) => entry.transactionId),
        )
      : [];
  const activityByTransaction = new Map(
    activity.map((item) => [item.transactionId, item]),
  );
  if (!session)
    return (
      <div className="mx-auto max-w-5xl space-y-12 py-8 md:py-16">
        <div className="grid items-center gap-8 md:grid-cols-2">
          <div className="space-y-4">
            <span className="grid size-12 place-items-center rounded-xl bg-accent-soft">
              <AccountIcon name="developer" />
            </span>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              Developer API
            </h1>
            <p>
              Bring privacy ratings into your own tools. Read a published
              report, save a snapshot, or request a fresh scan of a domain.
            </p>
            <div className="flex flex-wrap gap-3">
              <AccountLink href="/account?returnTo=/account/developer">
                Sign in
              </AccountLink>
              <AccountLink href="/developers" secondary>
                API documentation
              </AccountLink>
            </div>
          </div>
          <ApiExample />
        </div>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">
            Usage and pricing
          </h2>
          <ApiRates />
          <p>
            Prepaid credits cover saved reports and new scans. You can check a
            scan’s status for free. API credits are separate from a Pro
            subscription.
          </p>
        </section>
      </div>
    );
  return (
    <AccountScreen
      title="Developer API"
      description="Create scoped tokens and track the credits you use for reports and scans."
      current="/account/developer"
    >
      <Card className="p-5">
        <Card.Content className="items-start gap-4">
          <ApiRates />
          <Link
            className="text-accent underline underline-offset-2"
            href="/developers"
          >
            API documentation <span aria-hidden="true">→</span>
          </Link>
        </Card.Content>
      </Card>
      {tokens && legacy && wallet ? (
        <>
          <section className="space-y-4" aria-labelledby="api-credit-activity">
            <h2 id="api-credit-activity">API credits</h2>
            {wallet.state === "unavailable" ? (
              <p>Your credit balance is temporarily unavailable.</p>
            ) : (
              <p>
                Balance: <strong>{wallet.balance}</strong>
              </p>
            )}
            {!session.user.emailVerified ? (
              <p>Verify your email before buying API credits.</p>
            ) : pack && wallet.state !== "unavailable" ? (
              <CreditPackCheckout
                credits={pack.credits}
                price={new Intl.NumberFormat("en-IE", {
                  style: "currency",
                  currency: "EUR",
                }).format(pack.price / 100)}
              />
            ) : (
              <p>Credit packs are currently unavailable.</p>
            )}
            {wallet.entries.length > 0 && (
              <ul className="divide-y divide-separator [&>li]:space-y-2 [&>li]:py-4">
                {wallet.entries.map((entry) => {
                  const item = activityByTransaction.get(entry.transactionId);
                  return (
                    <li key={entry.id}>
                      <strong>
                        {item
                          ? activityLabels[item.kind]
                          : entry.side === "credit"
                            ? "Credits added"
                            : "Credits deducted"}
                      </strong>
                      {entry.side === "credit" ? "+" : "−"}
                      {entry.amount}
                      <p>
                        {item &&
                          item.kind !== "pack" &&
                          item.kind !== "pack_refund" &&
                          item.context + " · "}
                        <time dateTime={entry.createdAt}>
                          {new Date(entry.createdAt)
                            .toISOString()
                            .slice(0, 16)
                            .replace("T", " ")}{" "}
                          UTC
                        </time>
                      </p>
                      <AccountDetails label="Transaction details">
                        {item &&
                          (item.kind === "pack" ||
                            item.kind === "pack_refund") && (
                            <p>
                              Order <code>{item.context}</code>
                            </p>
                          )}
                        <p>
                          Transaction <code>{entry.transactionId}</code>
                        </p>
                      </AccountDetails>
                    </li>
                  );
                })}
              </ul>
            )}
            {wallet.state !== "unavailable" &&
              !wallet.entries.length &&
              !legacy.entries.length && <p>No credit activity yet.</p>}
            {legacy.entries.length > 0 && (
              <>
                <h3 className="pt-5 text-lg font-semibold">
                  Earlier credit activity
                </h3>
                <p>Earlier balance: {legacy.balance}.</p>
                <ul className="divide-y divide-separator [&>li]:space-y-2 [&>li]:py-4">
                  {legacy.entries.map((entry) => (
                    <li key={entry.id}>
                      <strong>
                        {entry.kind === "purchase"
                          ? "Credit purchase"
                          : entry.kind === "scan_refund"
                            ? "Failed-scan refund"
                            : entry.kind === "payment_refund"
                              ? "Credit pack refund"
                              : entry.scanId
                                ? "Scan request"
                                : entry.domain
                                  ? "Report read"
                                  : "API usage"}
                      </strong>
                      {" · "}
                      {entry.delta > 0 ? "+" : ""}
                      {entry.delta}
                      <p>
                        {entry.domain && entry.domain + " · "}
                        <time dateTime={entry.createdAt}>
                          {new Date(entry.createdAt).toISOString().slice(0, 10)}{" "}
                          UTC
                        </time>
                      </p>
                      <AccountDetails label="Transaction details">
                        <p>
                          Reference <code>{entry.reference}</code>
                        </p>
                      </AccountDetails>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <ApiTokens
            records={tokens}
            scansEnabled={developerApiPreview && developerScanCost !== null}
          />
        </>
      ) : (
        <p>Developer account data is temporarily unavailable.</p>
      )}
    </AccountScreen>
  );
}
