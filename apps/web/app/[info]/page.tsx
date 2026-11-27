import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MethodologyPage } from "./methodology-page";
import { PrivacyPage } from "./privacy-page";
import { getPricing } from "@datadeal/config";
import { PrivacySettingsLink } from "../../lib/ads/privacy-settings";
import { AdvertisingFaq, AdvertisingPrivacyHelp } from "./advertising-faq";
import { database } from "../../lib/reports";
import { auth } from "../../lib/auth";
import { billingConfig } from "../../lib/billing";
import { proPlansPath } from "../../lib/checkout-return";
import { PricingPlans } from "./pricing-plans";
import { PointsPricing } from "./points-pricing";
import { localPointsEnabled, pointsEnabled } from "../../lib/local-reward";
import { developerApiPreview } from "../../lib/developer-token";
import {
  defaultReportPointCost,
  flightCap,
} from "@datadeal/contracts/paper-plane";

const pages = {
  methodology: [
    "Scoring methodology",
    "DataDeal uses the same scoring rules for every site and links each finding to its source.",
  ],
  learn: [
    "Understand privacy findings",
    "A first-party claim describes what the operator says. A technical observation describes what the scanner saw within a specific scenario.",
  ],
  pricing: [
    "DataDeal plans",
    "Get the essentials for free. Choose Pro for deeper reports and ad-free browsing.",
  ],
  terms: [
    "Terms",
    "DataDeal offers informational research to help you assess privacy practices. Website behavior and policies can change.",
  ],
  "advertising-disclosure": [
    "Advertising disclosure",
    "Labeled ads and DataDeal Pro help fund privacy reports.",
  ],
} as const;

export default async function InfoPage({
  params,
}: {
  params: Promise<{ info: string }>;
}) {
  const { info } = await params;
  if (info === "explore" || info === "history") redirect("/#recent-reports");
  if (info === "privacy") return <PrivacyPage />;
  if (!Object.hasOwn(pages, info)) notFound();
  if (info === "methodology") return <MethodologyPage />;
  const [title, summary] = pages[info as keyof typeof pages];
  const checkout = info === "pricing" && auth && database && billingConfig();
  const points = pointsEnabled();
  // Earning points and rewarded unlocks need the sample ad unit (local only).
  const sampleAds = localPointsEnabled();
  const pricing = getPricing();
  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: pricing.currency,
      ...(cents % 100 === 0 && { maximumFractionDigits: 0 }),
    }).format(cents / 100);
  return (
    <section
      className={
        info === "pricing"
          ? "py-12 md:py-20"
          : "mx-auto max-w-3xl space-y-4 py-12 md:py-20 [&>h2]:mt-8 [&>h2]:text-2xl"
      }
    >
      <h1
        className={
          "text-4xl leading-tight font-semibold tracking-tight md:text-6xl" +
          (info === "pricing" ? " text-center" : "")
        }
      >
        {title}
      </h1>
      <p
        className={
          "mt-4 mb-7 max-w-2xl text-lg leading-relaxed text-muted" +
          (info === "pricing" ? " mx-auto mb-10 text-center" : "")
        }
      >
        {summary}
      </p>
      {info === "pricing" && (
        <>
          <PricingPlans
            free={formatPrice(0)}
            monthly={formatPrice(pricing.monthly)}
            yearly={formatPrice(pricing.yearly)}
            yearlyPerMonth={formatPrice(Math.floor(pricing.yearly / 12))}
            savingPercent={Math.max(
              0,
              Math.floor(100 - (pricing.yearly / (pricing.monthly * 12)) * 100),
            )}
            checkoutHref={checkout ? proPlansPath : null}
          />
          <div className="mx-auto mt-6 grid w-full max-w-4xl gap-4 md:grid-cols-2">
            <section className="grid content-start gap-2 rounded-3xl border border-separator p-6">
              <h2 className="m-0! text-base font-semibold">
                Unlock one report
              </h2>
              <p className="m-0! text-sm leading-relaxed text-muted">
                {sampleAds
                  ? "Watch a short ad to open the advanced report for one domain for 24 hours. Sign in to keep it in your account."
                  : points
                    ? `Spend ${defaultReportPointCost} points to open the advanced report for one scan and keep it in your account.`
                    : "Free reports show the rating, verdict and key findings. Pro opens every advanced report."}
              </p>
              {sampleAds ? (
                <Link
                  className="inline-link text-sm"
                  href="/advertising-disclosure"
                >
                  How ads work
                </Link>
              ) : (
                points && (
                  <Link className="inline-link text-sm" href="#points-title">
                    How points work
                  </Link>
                )
              )}
            </section>
            <section className="grid content-start gap-2 rounded-3xl border border-separator p-6">
              <h2 className="m-0! text-base font-semibold">
                Building with DataDeal?
              </h2>
              <p className="m-0! text-sm leading-relaxed text-muted">
                {developerApiPreview
                  ? "Query ratings and findings from your own tools, paid in points."
                  : "Query ratings and findings from your own tools. The API is in preview and not open yet."}
              </p>
              <Link className="inline-link text-sm" href="/developers">
                Explore the API
              </Link>
            </section>
          </div>
          {points && (
            <PointsPricing earn={sampleAds} formatPrice={formatPrice} />
          )}
        </>
      )}
      {info === "learn" && (
        <dl className="divide-y divide-border [&>div]:grid [&>div]:gap-2 [&>div]:py-5 md:[&>div]:grid-cols-[1fr_2.5fr] [&_dt]:font-semibold">
          <div>
            <dt>Browser observation</dt>
            <dd>
              Read which page and consent choice were tested. A connection
              identifies a destination. Its contents can remain unknown.
            </dd>
          </div>
          <div>
            <dt>Policy disclosure</dt>
            <dd>
              Open the cited passage to see what the operator describes
              collecting and when a provider gets involved.
            </dd>
          </div>
          <div>
            <dt>Coverage</dt>
            <dd>
              An unavailable consent control or incomplete visit limits what
              DataDeal can verify.{" "}
              <Link className="inline-link" href="/methodology">
                Read the scoring rules
              </Link>
            </dd>
          </div>
        </dl>
      )}
      {info === "terms" && (
        <>
          <p>
            Each report identifies its scan date and evidence.{" "}
            <Link className="inline-link" href="/methodology">
              Review the methodology
            </Link>{" "}
            to understand its scope, or{" "}
            <Link className="inline-link" href="/pricing">
              view the access and subscription terms
            </Link>
            .
            {process.env.NODE_ENV === "production" && (
              <>
                {" "}
                <a
                  className="inline-link"
                  href="/_next/static/licenses/third-party-notices.txt"
                >
                  Third-party software notices
                </a>
              </>
            )}
          </p>
          <h2>Points</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              Points pay for DataDeal features, such as opening an advanced
              report, skipping the scan queue, rechecking a watched site or a
              Developer API request. They have no cash value and can’t be
              exchanged for money.
            </li>
            <li>
              Points belong to your account and can’t be transferred, sold or
              moved to another account.
            </li>
            <li>
              Bought points are not refundable, except that a pack you haven’t
              used any points from can be refunded in full through the payment
              provider. A refund removes the pack’s points.
            </li>
            <li>
              Paper-plane flights are a free bonus, not a purchase. Each flight
              ends at a random point drawn evenly from 1 to {flightCap}. Collect
              before it ends to keep the points shown; if it ends first, the
              flight pays 0 points.
            </li>
            <li>
              When you delete your account, its points are deleted with it and
              can’t be restored.
            </li>
            <li>
              Prices in points and point packs can change. We announce changes
              on the pricing page before they apply; points you already hold
              keep their balance.
            </li>
          </ul>
        </>
      )}
      {info === "advertising-disclosure" && (
        <>
          <h2>Where ads appear</h2>
          <p>
            Visitors without Pro can see Google AdSense ads on free reports. In
            the EEA, the UK and Switzerland, Google’s certified consent message
            (IAB TCF) asks first whether ads may use cookies or personal data;
            without consent Google shows only limited, non-personalized ads.
            Rewarded ads for points are not live yet.
          </p>
          <h2>What remains free</h2>
          <p>
            The score, verdict, summary, key findings, critical warnings, and
            source links are free to read. Pro members see ad-free reports when
            signed in.
          </p>
          <PrivacySettingsLink className="inline-link">
            Review your privacy settings
          </PrivacySettingsLink>
          <AdvertisingPrivacyHelp />
          <h2>Frequently asked questions</h2>
          <AdvertisingFaq />
        </>
      )}
    </section>
  );
}
