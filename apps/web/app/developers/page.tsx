import Link from "next/link";
import { AccountLink, AccountIcon } from "../account/account-ui";
import { ApiExample, ApiRates } from "./api-reference";
import { Chip } from "@heroui/react/chip";

export const metadata = {
  title: "Developer API documentation",
  description:
    "Authenticate, read privacy reports, and request scans with the DataDeal developer API.",
};
export const dynamic = "force-dynamic";
const endpoints = [
  [
    "GET",
    "/reports/:domain",
    "reports:read",
    "Read the current published report. A domain without a report returns 404.",
  ],
  [
    "POST",
    "/reports/:domain",
    "reports:read",
    "Save a snapshot of the current public report. Retry with the same idempotency key to retrieve the same result.",
  ],
  [
    "POST",
    "/scans/:domain",
    "scans:request",
    "Queue a new scan. A successful request returns HTTP 202 with a scan ID and a Location header for checking progress.",
  ],
  [
    "GET",
    "/scans/status/:id",
    "scans:request",
    "Check your scan by ID. The status includes the points charged and refunded, and a report path when the result is published. Status checks are free.",
  ],
] as const;
export default function DevelopersPage() {
  return (
    <article className="mx-auto max-w-5xl space-y-8 py-8 md:py-16">
      <header className="max-w-prose space-y-4">
        <span className="grid size-12 place-items-center rounded-xl bg-accent-soft">
          <AccountIcon name="docs" />
        </span>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          API documentation
        </h1>
        <p>
          Read a website’s privacy report or send a domain through the same scan
          queue DataDeal uses on the web.
        </p>
      </header>
      <div className="grid items-start gap-8 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav
          aria-label="On this page"
          className="grid grid-cols-2 gap-3 text-sm md:sticky md:top-5 md:grid-cols-1"
        >
          <a href="#authentication">Authentication</a>
          <a href="#usage">Usage and points</a>
          <a href="#endpoints">Endpoints</a>
          <a href="#errors">Errors and retries</a>
        </nav>
        <div className="min-w-0 space-y-10 wrap-anywhere [&_section]:space-y-4">
          <section id="authentication">
            <h2 className="text-xl font-semibold tracking-tight">
              Authentication
            </h2>
            <p>
              Create a named token in your developer account and copy it when it
              appears. Choose <code>reports:read</code> for reports or{" "}
              <code>scans:request</code> for scan requests and status.
            </p>
            <AccountLink href="/account/developer" secondary>
              Manage API tokens
            </AccountLink>
            <p>Send the token in the Authorization header.</p>
            <ApiExample />
          </section>
          <section id="usage">
            <h2 className="text-xl font-semibold tracking-tight">
              Usage and points
            </h2>
            <ApiRates />
            <p>
              Requests are paid with points, the same points that open reports
              on the site. Buy a pack or earn them by flying the paper plane.
              Your developer account shows the balance and the points each
              request used. Failed or unusable scans are refunded automatically,
              and retries aren't charged twice.
            </p>
          </section>
          <section id="endpoints">
            <h2 className="text-xl font-semibold tracking-tight">Endpoints</h2>
            <p>
              Base path <code>/api/v1/developer</code>
            </p>
            {endpoints.map(([verb, path, scope, description]) => (
              <div
                className="space-y-2 border-t border-separator pt-4"
                key={verb + path}
              >
                <h3 className="flex items-center gap-3">
                  <Chip size="sm">{verb}</Chip>
                  <code>{path}</code>
                </h3>
                <p>{description}</p>
                <small>
                  Token scope <code>{scope}</code>
                </small>
              </div>
            ))}
          </section>
          <section id="errors">
            <h2 className="text-xl font-semibold tracking-tight">
              Errors and retries
            </h2>
            <p>
              Send an <code>Idempotency-Key</code> with each POST. Use 1–160
              letters, digits, periods, underscores, colons or hyphens. Retry
              the same operation with the same key to avoid a second charge.
            </p>
            <dl className="divide-y divide-separator">
              {[
                ["401 / 403", "Check the token and its scope."],
                [
                  "402",
                  "The account has too few points. The response names the points required.",
                ],
                [
                  "409",
                  "Check whether the key was used for another request or a scan is already running.",
                ],
                [
                  "429",
                  "Wait for the Retry-After interval. Each token allows up to 60 requests per minute.",
                ],
                [
                  "503",
                  "The operation is temporarily unavailable. Retry later using the same key.",
                ],
              ].map(([code, msg]) => (
                <div
                  key={code}
                  className="grid grid-cols-[5rem_1fr] gap-3 py-3"
                >
                  <dt>{code}</dt>
                  <dd>{msg}</dd>
                </div>
              ))}
            </dl>
            <Link
              className="text-accent underline underline-offset-2"
              href="/account/developer"
            >
              Open developer account
            </Link>
          </section>
        </div>
      </div>
    </article>
  );
}
