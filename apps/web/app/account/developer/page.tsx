import Link from "next/link";
import {
  AccountCard,
  AccountIcon,
  AccountLink,
  AccountRow,
  AccountScreen,
  AccountSection,
  AccountStat,
} from "../account-ui";
import { ApiRates, ApiExample } from "../../developers/api-reference";
import { headers } from "next/headers";
import { auth } from "../../../lib/auth";
import { purchasableCreditPack } from "../../../lib/billing";
import { customerCreditSummary } from "../../../lib/customer-credit-summary";
import {
  developerApiPreview,
  developerReportReadCost,
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
import { LocalDate } from "../../../lib/local-date";

export const dynamic = "force-dynamic";

function creditCost(amount: number | null) {
  return amount === null
    ? "Unavailable"
    : amount + (amount === 1 ? " credit" : " credits");
}

function Amount({ value }: { value: string }) {
  return (
    <span
      className={
        "text-sm font-semibold tabular-nums " +
        (value.startsWith("+") ? "text-success" : "")
      }
    >
      {value}
    </span>
  );
}

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
      {tokens && legacy && wallet && (
        <AccountSection
          title="Credits"
          description="Prepaid credits cover saved reports and new scans. API credits are separate from a Pro subscription."
        >
          <AccountCard>
            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="grid min-w-0 gap-1">
                <span className="text-xs text-muted">Balance</span>
                {wallet.state === "unavailable" ? (
                  <span className="text-sm">
                    Your credit balance is temporarily unavailable.
                  </span>
                ) : (
                  <span className="text-3xl leading-none font-semibold tabular-nums">
                    {wallet.balance}
                    <span className="ml-1.5 text-sm font-normal text-muted">
                      credits
                    </span>
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!session.user.emailVerified ? (
                  <span className="text-sm text-muted">
                    Verify your email before buying API credits.
                  </span>
                ) : pack && wallet.state !== "unavailable" ? (
                  <CreditPackCheckout
                    credits={pack.credits}
                    price={new Intl.NumberFormat("en-IE", {
                      style: "currency",
                      currency: "EUR",
                    }).format(pack.price / 100)}
                  />
                ) : (
                  <span className="text-sm text-muted">
                    Credit packs are currently unavailable.
                  </span>
                )}
              </div>
            </div>
          </AccountCard>
        </AccountSection>
      )}
      <AccountSection
        title="Prices"
        description={
          <>
            What each request costs. Checking a scan’s status is free. See the{" "}
            <Link
              className="text-accent underline-offset-2 hover:underline"
              href="/developers"
            >
              API documentation
            </Link>
            .
          </>
        }
      >
        <AccountCard>
          <div className="grid divide-y divide-separator sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <AccountStat label="Current report" value="Free" />
            <AccountStat
              label="Saved report"
              value={creditCost(developerReportReadCost)}
            />
            <AccountStat
              label="New scan"
              value={creditCost(developerScanCost)}
            />
          </div>
        </AccountCard>
      </AccountSection>
      {tokens && legacy && wallet ? (
        <>
          <ApiTokens
            records={tokens}
            scansEnabled={developerApiPreview && developerScanCost !== null}
          />
          <AccountSection
            title="Credit activity"
            description="Purchases, refunds and the credits your requests used."
          >
            <AccountCard>
              {wallet.entries.map((entry) => {
                const item = activityByTransaction.get(entry.transactionId);
                return (
                  <AccountRow
                    key={entry.id}
                    title={
                      item
                        ? activityLabels[item.kind]
                        : entry.side === "credit"
                          ? "Credits added"
                          : "Credits deducted"
                    }
                    description={
                      <>
                        <span className="block">
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
                        </span>
                        <AccountDetails label="Transaction details">
                          {item &&
                            (item.kind === "pack" ||
                              item.kind === "pack_refund") && (
                              <p className="m-0">
                                Order <code>{item.context}</code>
                              </p>
                            )}
                          <p className="m-0">
                            Transaction <code>{entry.transactionId}</code>
                          </p>
                        </AccountDetails>
                      </>
                    }
                  >
                    <Amount
                      value={
                        (entry.side === "credit" ? "+" : "−") + entry.amount
                      }
                    />
                  </AccountRow>
                );
              })}
              {wallet.state !== "unavailable" &&
                !wallet.entries.length &&
                !legacy.entries.length && (
                  <AccountRow
                    title="No credit activity yet"
                    description="Purchases and API usage will appear here."
                  />
                )}
              {wallet.state === "unavailable" && !wallet.entries.length && (
                <AccountRow
                  title="Activity unavailable"
                  description="Your credit activity is temporarily unavailable."
                />
              )}
              {wallet.state !== "unavailable" &&
                !wallet.entries.length &&
                legacy.entries.length > 0 && (
                  <AccountRow
                    title="No recent credit activity"
                    description="Your earlier activity is listed below."
                  />
                )}
            </AccountCard>
          </AccountSection>
          {legacy.entries.length > 0 && (
            <AccountSection
              title="Earlier credit activity"
              description={<>Earlier balance: {legacy.balance}.</>}
            >
              <AccountCard>
                {legacy.entries.map((entry) => (
                  <AccountRow
                    key={entry.id}
                    title={
                      entry.kind === "purchase"
                        ? "Credit purchase"
                        : entry.kind === "scan_refund"
                          ? "Failed-scan refund"
                          : entry.kind === "payment_refund"
                            ? "Credit pack refund"
                            : entry.scanId
                              ? "Scan request"
                              : entry.domain
                                ? "Report read"
                                : "API usage"
                    }
                    description={
                      <>
                        <span className="block">
                          {entry.domain && entry.domain + " · "}
                          <time dateTime={entry.createdAt}>
                            <LocalDate value={entry.createdAt} />
                          </time>
                        </span>
                        <AccountDetails label="Transaction details">
                          <p className="m-0">
                            Reference <code>{entry.reference}</code>
                          </p>
                        </AccountDetails>
                      </>
                    }
                  >
                    <Amount
                      value={(entry.delta > 0 ? "+" : "") + entry.delta}
                    />
                  </AccountRow>
                ))}
              </AccountCard>
            </AccountSection>
          )}
        </>
      ) : (
        <p role="status" className="m-0 text-sm text-muted">
          Developer account data is temporarily unavailable.
        </p>
      )}
    </AccountScreen>
  );
}
