import Link from "next/link";
import { ConsentDialogLink } from "@c15t/nextjs";
import { buttonVariants } from "@heroui/styles/components/button";
import { z } from "zod";
import { umamiConfig } from "../../lib/umami";

const sections = [
  ["reports", "Reports and ads"],
  ["scans", "Website scans"],
  ["account", "Your account"],
  ["payments", "Payments and API credits"],
  ["extension", "Browser extension"],
] as const;

export function PrivacyPage() {
  const operator = process.env.DATADEAL_OPERATOR_NAME?.trim();
  const email = z.email().safeParse(process.env.DATADEAL_PRIVACY_EMAIL?.trim());
  const hasContact = Boolean(operator || email.success);
  const topics = hasContact
    ? [...sections, ["contact", "Privacy contact"]]
    : sections;
  return (
    <article className="mx-auto max-w-5xl space-y-9 py-10 md:space-y-12 md:py-16">
      <header className="max-w-2xl space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
          Privacy at DataDeal
        </h1>
        <p className="text-lg leading-relaxed text-muted">
          You can read a privacy report without an account. When you look up a
          website, DataDeal receives its domain. Signing in, allowing ads and
          paying for Pro each involve different information.
        </p>
      </header>
      <div className="grid gap-12 md:grid-cols-[12rem_minmax(0,1fr)] lg:gap-20">
        <nav
          aria-label="Privacy topics"
          className="hidden self-start md:sticky md:top-6 md:block"
        >
          <p className="mb-3 text-sm font-semibold">On this page</p>
          <ul className="space-y-1 text-sm">
            {topics.map(([id, label]) => (
              <li key={id}>
                <a
                  href={"#" + id}
                  className="inline-block py-2 text-muted hover:text-foreground hover:underline"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="max-w-prose space-y-10 leading-relaxed [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:mt-3 [&_section]:scroll-mt-6">
          <section aria-labelledby="reports">
            <h2 id="reports">Reports and ads</h2>
            <p>
              On your first visit, our consent tool creates a browser identifier
              called <code>c15t-sid</code>. It stays in a first-party cookie and
              local storage across visits, including when you decline ads. A
              separate entry called <code>c15t</code> remembers your choice.
            </p>
            {umamiConfig() && (
              <p>
                If you enable Analytics, our self-hosted Umami service counts
                visits to public page types. All report domains appear as one
                category. Umami receives your IP address and browser information
                with each request. We omit search terms, referring pages and
                account activity. You can turn Analytics off in Privacy
                settings.
              </p>
            )}
            <p>
              On free reports, allowing advertising can connect your browser to
              Google to request an ad. Google then receives technical
              information such as your IP address. If you decline, you can still
              read the score, findings and sources.
            </p>
            <p>
              With Global Privacy Control on, only a separate choice for limited
              Google ads can enable contextual ads, where available. A rewarded
              ad starts when you also choose to watch it. A guest unlock uses a
              cookie to give this browser access to one domain for 24 hours. If
              you request a sign-in link from this browser during that time,
              opening the link saves eligible unlocked scans to your account.
              Signed-in Pro members read reports without Google ad scripts.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <ConsentDialogLink
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                Privacy settings
              </ConsentDialogLink>
              <Link className="inline-link" href="/advertising-disclosure">
                How ads work
              </Link>
            </div>
          </section>
          <section aria-labelledby="scans">
            <h2 id="scans">Website scans</h2>
            <p>
              When you request a scan, we queue the domain. To limit repeated
              requests we use the domain, your account ID if signed in, and
              rotating codes derived from an IP address when available. The
              scanner visits public pages in its own browser. It records
              destinations, cookie and storage observations, and excerpts from
              public policies.
            </p>
            <p>
              We send selected public policy text and browser measurements to
              OpenAI to explain the findings. For example, the analysis can
              identify that a request field resembled an email address. The
              browser evidence sent for analysis excludes the address itself,
              raw request bodies and cookie values.
            </p>
            <p>
              We publish reports and cited evidence by domain and keep earlier
              scans for comparison. Downloadable capture records, where
              available, expire after 30 days. The published reports have a
              separate history.
            </p>
          </section>
          <section aria-labelledby="account">
            <h2 id="account">Your account</h2>
            <p>
              We use your email address to send a one-time sign-in link. In
              production, Resend receives the address and email to deliver it.
              The link expires in 10 minutes. A session cookie keeps you signed
              in. Session records include dates and may include your IP address
              and browser information.
            </p>
            <p>
              Your account stores the features you use, including saved sites,
              privacy preferences and reward activity. In account settings you
              can download your data or request deletion by email. Confirming
              deletion closes your DataDeal account and ends its Pro
              subscriptions.
            </p>
            <p>
              <Link className="inline-link" href="/account">
                Open account settings
              </Link>
            </p>
          </section>
          <section aria-labelledby="payments">
            <h2 id="payments">Payments and API credits</h2>
            <p>
              When you start checkout, DataDeal sends Creem your account email,
              account ID, selected product and a purchase reference. You enter
              payment details on Creem’s checkout page. Creem sends payment and
              subscription updates to DataDeal so we can match a receipt to your
              account, grant access and track renewals.
            </p>
            <p>
              If you buy or use prepaid API credits, we keep purchase and usage
              records for your account. Creem handles the credit balance.
              DataDeal stores a hash of each developer token and lets you revoke
              it.
            </p>
          </section>
          <section aria-labelledby="extension">
            <h2 id="extension">Browser extension</h2>
            <p>
              Opening the extension sends the current site’s domain to DataDeal
              for a rating. The lookup omits cookies, page paths, query strings
              and form entries. A separate signed-in request retrieves your
              account preferences without including the site’s domain.
            </p>
            <p>
              If you enable automatic ratings for a site, the extension saves
              that choice on your device and checks the domain when you visit.
              It can show the score on the toolbar and near sign-in,
              registration or checkout forms. Turn automatic ratings off in the
              extension popup at any time.
            </p>
          </section>
          {hasContact && (
            <section aria-labelledby="contact">
              <h2 id="contact">Privacy contact</h2>
              {operator && <p>DataDeal is operated by {operator}.</p>}
              {email.success && (
                <p>
                  For questions about how we handle your data, email{" "}
                  <a
                    className="inline-link"
                    href={
                      "mailto:" +
                      encodeURIComponent(email.data).replace("%40", "@")
                    }
                  >
                    {email.data}
                  </a>
                  .
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </article>
  );
}
