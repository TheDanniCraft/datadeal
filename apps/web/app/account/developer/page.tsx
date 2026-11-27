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
import {
  describePointPacks,
  purchasablePointPacks,
} from "../../../lib/point-packs";
import { localPointsEnabled } from "../../../lib/local-reward";
import {
  developerApiPreview,
  developerReportReadCost,
  developerScanCost,
} from "../../../lib/developer-token";
import { database } from "../../../lib/reports";
import { ApiTokens } from "./api-tokens";
import { AccountDetails } from "./account-details";
import { BuyPoints } from "../rewards/buy-points";
import { CreditReceipt } from "./credit-receipt";
import {
  checkoutReference,
  type CheckoutReturnQuery,
} from "../../../lib/checkout-return";
import { LocalDate } from "../../../lib/local-date";

export const dynamic = "force-dynamic";

function pointCost(amount: number | null) {
  return amount === null
    ? "Unavailable"
    : amount.toLocaleString("en") + (amount === 1 ? " point" : " points");
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

const activityLabels = { report_read: "Saved report", scan: "Scan request" };

export default async function DeveloperAccountPage({
  searchParams,
}: {
  searchParams: Promise<CheckoutReturnQuery>;
}) {
  const reference = checkoutReference("credits", await searchParams);
  if (reference) return <CreditReceipt reference={reference} />;
  const session = await auth?.api.getSession({ headers: await headers() });
  const points = localPointsEnabled();
  // API credits were merged into points. The earlier local credit ledger is
  // listed for history; the Creem-held wallet is only in the account export.
  const account =
    session && database
      ? await Promise.all([
          database.listApiTokens(session.user.id),
          database.apiCreditSummary(session.user.id),
          points ? database.reportPointWallet(session.user.id) : null,
          points ? database.pointApiOperations(session.user.id, 25) : [],
        ])
      : null;
  const [tokens, legacy, wallet, operations] = account ?? [];
  const packs =
    session?.user.emailVerified && wallet
      ? purchasablePointPacks()?.packs
      : null;
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
            Points cover saved reports and new scans: the same points that open
            reports on the site. Buy a pack or earn them by flying the paper
            plane. You can check a scan’s status for free.
          </p>
        </section>
      </div>
    );
  return (
    <AccountScreen
      title="Developer API"
      description="Create scoped tokens and track the points you use for reports and scans."
      current="/account/developer"
    >
      {tokens && legacy && (
        <AccountSection
          title="Points"
          description="Points pay for saved reports and new scans. They are the same points that open reports on the site."
        >
          <AccountCard>
            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="grid min-w-0 gap-1">
                <span className="text-xs text-muted">Balance</span>
                {wallet ? (
                  <span className="text-3xl leading-none font-semibold tabular-nums">
                    {wallet.balance.toLocaleString("en")}
                    <span className="ml-1.5 text-sm font-normal text-muted">
                      {wallet.balance === 1 ? "point" : "points"}
                    </span>
                  </span>
                ) : (
                  <span className="text-sm">
                    Points are currently unavailable.
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!wallet ? null : !session.user.emailVerified ? (
                  <span className="text-sm text-muted">
                    Verify your email before buying points.
                  </span>
                ) : packs ? (
                  <BuyPoints
                    packs={describePointPacks(packs)}
                    returnTo="/account/developer"
                  />
                ) : (
                  <span className="text-sm text-muted">
                    Point packs are currently unavailable.
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
              value={pointCost(developerReportReadCost)}
            />
            <AccountStat
              label="New scan"
              value={pointCost(developerScanCost)}
            />
          </div>
        </AccountCard>
      </AccountSection>
      {tokens && legacy && operations ? (
        <>
          <ApiTokens
            records={tokens}
            scansEnabled={developerApiPreview && developerScanCost !== null}
          />
          <AccountSection
            title="Point activity"
            description="The points your API requests used, and what failed scans returned."
          >
            <AccountCard>
              {operations.map((entry) => (
                <AccountRow
                  key={entry.id}
                  title={activityLabels[entry.kind]}
                  description={
                    <>
                      <span className="block">
                        {entry.domain} ·{" "}
                        <time
                          dateTime={new Date(entry.createdAt).toISOString()}
                        >
                          <LocalDate value={entry.createdAt} />
                        </time>
                        {entry.refundedAt && " · points returned"}
                      </span>
                      <AccountDetails label="Request details">
                        <p className="m-0">
                          Idempotency key <code>{entry.requestKey}</code>
                        </p>
                        {entry.scanId && (
                          <p className="m-0">
                            Scan <code>{entry.scanId}</code>
                          </p>
                        )}
                      </AccountDetails>
                    </>
                  }
                >
                  <Amount
                    value={
                      entry.refundedAt
                        ? "±0"
                        : "−" + entry.points.toLocaleString("en")
                    }
                  />
                </AccountRow>
              ))}
              {!operations.length && (
                <AccountRow
                  title="No API point activity yet"
                  description={
                    points ? (
                      <>
                        Saved reports and scans you request will appear here.
                        Purchases and other point activity are on the{" "}
                        <Link
                          className="text-accent underline-offset-2 hover:underline"
                          href="/account/rewards"
                        >
                          Points
                        </Link>{" "}
                        page.
                      </>
                    ) : (
                      "Saved reports and scans you request will appear here."
                    )
                  }
                />
              )}
            </AccountCard>
          </AccountSection>
          {legacy.entries.length > 0 && (
            <AccountSection
              title="Earlier credit activity"
              description={
                Number(legacy.balance) > 0
                  ? `API credits were replaced by points. The remaining ${legacy.balance} credits were converted at 100 points per credit.`
                  : "API credits were replaced by points."
              }
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
