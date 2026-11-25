import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MethodologyPage } from "./methodology-page";
import { PrivacyPage } from "./privacy-page";
import { getPricing } from "@datadeal/config";
import { ConsentDialogLink } from "@c15t/nextjs";
import { AdvertisingFaq, AdvertisingPrivacyHelp } from "./advertising-faq";
import { Card } from "@heroui/react/card";
import { buttonVariants } from "@heroui/styles/components/button";
import { database } from "../../lib/reports";
import { auth } from "../../lib/auth";
import { billingConfig } from "../../lib/billing";
import { proPlansPath } from "../../lib/checkout-return";

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
  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: getPricing().currency,
    }).format(cents / 100);
  return (
    <section
      className={
        info === "pricing"
          ? "py-12 md:py-20"
          : "mx-auto max-w-3xl space-y-4 py-12 md:py-20 [&>h2]:mt-8 [&>h2]:text-2xl"
      }
    >
      <h1 className="text-4xl leading-tight font-semibold tracking-tight md:text-6xl">
        {title}
      </h1>
      <p className="mt-4 mb-7 max-w-2xl text-lg leading-relaxed text-muted">
        {summary}
      </p>
      {info === "pricing" && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-5 md:p-8">
              <Card.Content className="flex h-full flex-col items-start">
                <Card.Title
                  role="heading"
                  aria-level={2}
                  className="text-xl font-semibold"
                >
                  Free
                </Card.Title>
                <p className="mt-4 flex items-baseline gap-2 text-sm text-muted [&_strong]:text-5xl [&_strong]:tracking-tight [&_strong]:text-foreground">
                  <strong>{formatPrice(0)}</strong>
                  <span>forever</span>
                </p>
                <ul className="my-5 list-disc space-y-2 ps-5">
                  <li>Privacy rating and verdict</li>
                  <li>Key findings, warnings and sources</li>
                  <li>Browser extension for quick checks</li>
                </ul>
                <Link
                  className={buttonVariants({
                    variant: "secondary",
                    className: "mt-auto",
                  })}
                  href="/"
                >
                  Check a website
                </Link>
              </Card.Content>
            </Card>
            <Card className="border border-accent/30 bg-linear-to-br from-accent-soft to-surface p-5 md:p-8">
              <Card.Content className="flex h-full flex-col items-start">
                <Card.Title
                  role="heading"
                  aria-level={2}
                  className="text-xl font-semibold"
                >
                  DataDeal Pro
                </Card.Title>
                <p className="mt-4 flex items-baseline gap-2 text-sm text-muted [&_strong]:text-5xl [&_strong]:tracking-tight [&_strong]:text-foreground">
                  <strong>{formatPrice(getPricing().monthly)}</strong>
                  <span>/ month</span>
                </p>
                <p className="mt-2 text-sm text-muted">
                  Or {formatPrice(getPricing().yearly)} billed yearly. Renews
                  automatically.
                </p>
                <ul className="my-5 list-disc space-y-2 ps-5">
                  <li>Every available advanced report</li>
                  <li>
                    Interactive data flows, scan history and policy changes
                  </li>
                  <li>Ad-free browsing</li>
                </ul>
                {checkout ? (
                  <Link
                    className={buttonVariants({
                      variant: "primary",
                      className: "mt-auto",
                    })}
                    href={proPlansPath}
                  >
                    See subscription options
                  </Link>
                ) : (
                  <p>Pro checkout is currently unavailable.</p>
                )}
              </Card.Content>
            </Card>
          </div>
          <section className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-6 [&_h2]:text-xl [&_p]:mt-2 [&_p]:max-w-prose [&_p]:text-muted">
            <div>
              <h2>One-domain unlock</h2>
              <p>
                When a rewarded ad is available, watch it to open one advanced
                report. See the recorded consent choices, data flows and
                providers for that domain. This browser can open the latest scan
                for 24 hours. Sign in from this browser during that window to
                keep the scan you unlocked in your account. Pro adds comparisons
                with earlier scans and policy wording.
              </p>
            </div>
            <Link className="inline-link" href="/advertising-disclosure">
              How ads work ↗
            </Link>
          </section>
          <p className="mt-4 text-sm text-muted">
            Building with DataDeal?{" "}
            <Link className="inline-link" href="/developers">
              Explore the API and prepaid credits
            </Link>
          </p>
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
      )}
      {info === "advertising-disclosure" && (
        <>
          <h2>Where ads appear</h2>
          <p>
            A free report can show Google ads when you allow advertising and an
            ad is available. With Global Privacy Control, a separate limited-ads
            preference allows contextual Google ads on eligible reports. A
            rewarded unlock requires a separate choice.
          </p>
          <h2>What remains free</h2>
          <p>
            The score, verdict, summary, key findings, critical warnings, and
            source links are free to read. Pro members see ad-free reports when
            signed in.
          </p>
          <ConsentDialogLink>Review your privacy settings</ConsentDialogLink>
          <AdvertisingPrivacyHelp />
          <h2>Frequently asked questions</h2>
          <AdvertisingFaq />
        </>
      )}
    </section>
  );
}
