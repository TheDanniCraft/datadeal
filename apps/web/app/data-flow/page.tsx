import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Card } from "@heroui/react/card";
import { buttonVariants } from "@heroui/styles/components/button";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { domain } from "@datadeal/contracts";
import { auth } from "../../lib/auth";
import { database } from "../../lib/reports";
import { Flow } from "../report/[domain]/report-content";
import { ProviderLookup, ProviderDisclosure } from "./provider-lookup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Data flow" };
const pageLayout = "mx-auto max-w-5xl py-9 [overflow-wrap:anywhere] md:py-16";
const pageTitle = "text-4xl font-semibold tracking-tight md:text-6xl";
const introduction =
  "my-4 max-w-prose text-base leading-relaxed text-muted md:text-lg";
const sourceLink =
  "text-foreground underline decoration-foreground/45 underline-offset-4 hover:decoration-foreground";

function ProviderLinks({
  items,
  current,
}: {
  items: { provider: string; sites: number }[];
  current?: string;
}) {
  return (
    <ul className="mt-3 flex list-none flex-wrap gap-2 p-0 md:grid md:gap-1">
      {items.map(({ provider, sites }) => (
        <li key={provider}>
          <Link
            href={"/data-flow?provider=" + encodeURIComponent(provider)}
            aria-current={provider === current ? "page" : undefined}
            className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-surface-secondary aria-[current=page]:bg-surface-secondary aria-[current=page]:font-semibold md:border-0"
          >
            {provider}
            <span className="shrink-0 whitespace-nowrap text-xs text-muted">
              {sites} {sites === 1 ? "site" : "sites"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function DataFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string | string[] }>;
}) {
  const query = await searchParams;
  const parsed = domain.safeParse(query.provider);
  const session = await auth?.api.getSession({ headers: await headers() });
  const pro = session && database && (await database.hasPro(session.user.id));
  const returnTo = parsed.success
    ? "/data-flow?provider=" + parsed.data
    : "/data-flow";
  if (!pro || !database)
    return (
      <article
        className={`${pageLayout} grid items-center gap-6 md:min-h-[52vh] md:grid-cols-[1.12fr_1fr] md:gap-12`}
      >
        <div>
          <h1 className={pageTitle}>Data flow</h1>
          <p className={introduction}>
            See which websites tried to reach the same provider during a browser
            visit. Follow a connection back to the scan that recorded it.
          </p>
          <Link
            className={`${sourceLink} inline-flex min-h-11 items-center gap-2`}
            href="/#recent-reports"
          >
            Browse free website reports <span aria-hidden="true">→</span>
          </Link>
        </div>
        <Card className="p-6 md:p-8">
          <Card.Content className="gap-4">
            <h2 className="text-2xl font-semibold tracking-tight">
              Explore across websites
            </h2>
            <p className="leading-relaxed text-muted">
              Pro includes the interactive network of providers seen in the last
              seven days. Individual reports keep their key findings and
              supporting sources free.
            </p>
            <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center">
              {!session && (
                <Link
                  className={buttonVariants({
                    variant: "primary",
                    className: "w-full sm:w-auto",
                  })}
                  href={"/account?" + new URLSearchParams({ returnTo })}
                >
                  Sign in to explore
                </Link>
              )}
              <Link
                className={buttonVariants({
                  variant: session ? "primary" : "outline",
                  className: "w-full sm:w-auto",
                })}
                href="/pricing"
              >
                See DataDeal Pro
              </Link>
            </div>
          </Card.Content>
        </Card>
      </article>
    );
  const providers = await database.topObservedProviders();
  const invalid = query.provider !== undefined && !parsed.success;
  const provider = parsed.success
    ? parsed.data
    : invalid
      ? undefined
      : providers[0]?.provider;
  const lookupValue = parsed.success
    ? parsed.data
    : typeof query.provider === "string"
      ? query.provider.slice(0, 253)
      : "";
  const current = providers.find((item) => item.provider === provider);
  const visible =
    current && !providers.slice(0, 4).includes(current)
      ? [...providers.slice(0, 3), current]
      : providers.slice(0, 4);
  const more = providers.filter((item) => !visible.includes(item));
  const references = provider
    ? await database.observedProviderReferences(provider)
    : [];
  return (
    <article className={pageLayout}>
      <div>
        <h1 className={pageTitle}>Data flow</h1>
        <p className={introduction}>
          Explore external requests recorded in the latest browser scans from
          the last seven days.
        </p>
      </div>
      <div className="mt-6 grid items-start gap-6 md:mt-8 md:grid-cols-[minmax(13rem,17.5rem)_minmax(0,1fr)] lg:gap-12">
        <aside className="min-w-0" aria-label="Find a provider">
          <ProviderLookup
            key={lookupValue}
            value={lookupValue}
            invalid={invalid}
          />
          {providers.length > 0 && (
            <nav
              aria-label="Observed providers"
              className="mt-5 flex-col items-stretch md:mt-8"
            >
              <h2 className="text-lg font-semibold">Observed providers</h2>
              <ProviderLinks items={visible} current={provider} />
              {more.length > 0 && (
                <ProviderDisclosure label="More providers">
                  <ProviderLinks items={more} current={provider} />
                </ProviderDisclosure>
              )}
            </nav>
          )}
        </aside>
        <Card className="min-w-0 p-3.5 md:p-6">
          <Card.Content className="min-w-0">
            {provider && references.length ? (
              <section aria-labelledby="flow-provider-heading">
                <div className="mb-4">
                  <h2
                    id="flow-provider-heading"
                    className="text-2xl font-semibold tracking-tight"
                  >
                    {provider}
                  </h2>
                  <p className="my-1 text-sm text-muted">
                    {references.length}{" "}
                    {references.length === 1
                      ? "website shown"
                      : "websites shown"}{" "}
                    · Last 7 days
                  </p>
                </div>
                <Flow
                  key={provider}
                  host={provider}
                  direction="incoming"
                  recipients={references.map(
                    ({ domain: site, scanId, evidenceId, responded }) => ({
                      label: site,
                      observed: true,
                      explanation: responded
                        ? `The browser recorded an HTTP response from ${provider}.`
                        : `The browser attempted a request to ${provider}.`,
                      evidenceIds: [],
                      relatedSources: [
                        {
                          href: `/report/${site}?scan=${scanId}#evidence-${evidenceId}`,
                          label: "Open matching observation",
                        },
                      ],
                    }),
                  )}
                />
                <div className="mt-5 border-t border-border pt-2">
                  <ProviderDisclosure label="Evidence by website">
                    <ul className="m-0 list-none p-0">
                      {references.map(
                        ({ domain: site, scanId, evidenceId, responded }) => (
                          <li
                            key={site}
                            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2"
                          >
                            <Link
                              className={sourceLink}
                              href={`/report/${site}?scan=${scanId}#evidence-${evidenceId}`}
                            >
                              {site}
                            </Link>
                            <span className="text-sm text-muted">
                              {responded
                                ? "Response recorded"
                                : "Request attempted"}
                            </span>
                          </li>
                        ),
                      )}
                    </ul>
                  </ProviderDisclosure>
                </div>
              </section>
            ) : (
              <EmptyState className="min-h-64 p-5">
                <EmptyState.Header>
                  <EmptyState.Title>
                    {invalid
                      ? "Choose a provider"
                      : provider
                        ? "No observed connections"
                        : "No recent browser observations"}
                  </EmptyState.Title>
                  <EmptyState.Description>
                    {invalid
                      ? "Enter a valid domain to view matching requests."
                      : provider
                        ? `The latest available visits from the past seven days contain no external request to ${provider}.`
                        : "Connections will appear when a published browser scan records a request to an external provider."}
                  </EmptyState.Description>
                </EmptyState.Header>
                <EmptyState.Content>
                  <Link className={sourceLink} href="/#recent-reports">
                    Browse website reports
                  </Link>
                </EmptyState.Content>
              </EmptyState>
            )}
          </Card.Content>
        </Card>
      </div>
    </article>
  );
}
