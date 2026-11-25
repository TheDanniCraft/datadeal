import type { ReactNode } from "react";
import { Button, Card, Disclosure, buttonVariants } from "@heroui/react";

import { ReportIcon } from "./report-icon";

import type { ProFeature } from "../../../lib/pro-features";

export function AdvancedPreview({
  graph,
  reward,
  features,
}: {
  graph: ReactNode;
  reward?: ReactNode;
  /** What the full report holds for this site, from its actual data. */
  features: ProFeature[];
}) {
  return (
    <Card
      role="region"
      aria-label="Pro report features"
      className="report-preview mt-3 gap-0 overflow-hidden rounded-2xl border border-separator bg-surface p-0 shadow-none"
    >
      <Card.Content className="grid gap-0 p-0 sm:grid-cols-[1.15fr_1fr]">
        <div className="flex flex-col items-start justify-center px-5 pt-6 pb-3 sm:py-8 sm:ps-8 sm:pe-2">
          <h3 className="m-0 text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
            Follow your data
          </h3>
          <p className="mt-2 max-w-80 text-sm leading-relaxed text-muted">
            See every connection on a map and the evidence behind each finding.
          </p>
          <a
            className={buttonVariants({
              variant: "primary",
              size: "sm",
              className: "mt-4 min-h-10 gap-2",
            })}
            href="/pricing"
          >
            View Pro plans <ReportIcon name="forward" />
          </a>
        </div>
        <figure className="relative m-0 flex min-w-0 flex-col justify-center bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--accent)_9%,transparent),transparent_70%)] px-6 pt-3 pb-4 sm:ps-1 sm:pe-5">
          <div className="mx-auto w-full max-w-88 [&_.flow-network]:h-36! sm:[&_.flow-network]:h-44! [&_.flow-root]:border-accent/30 [&_.flow-root]:shadow-sm">
            {graph}
          </div>
          <figcaption className="mt-1 text-center text-xs text-muted">
            Sample data flow
          </figcaption>
        </figure>
      </Card.Content>
      {reward}
      {features.length > 0 && (
        <Disclosure className="border-t border-separator">
          <Disclosure.Heading>
            <Button
              slot="trigger"
              variant="ghost"
              className="flex min-h-12 w-full justify-between gap-3 rounded-none bg-surface-secondary/60 px-5 py-2 text-left sm:px-8"
            >
              <span className="inline-flex items-center gap-2 text-sm font-medium">
                <ReportIcon name="glance" />
                What&apos;s in the full report
              </span>
              <span className="inline-flex items-center gap-2 text-xs font-normal text-muted">
                {features.length} {features.length === 1 ? "part" : "parts"}{" "}
                <Disclosure.Indicator />
              </span>
            </Button>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body className="border-t border-separator p-5 sm:p-6">
              <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
                {features.map(({ label, detail }) => (
                  <li key={label} className="flex gap-2.5 text-sm">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      className="mt-0.5 size-4 shrink-0 text-accent"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                    <span className="grid gap-0.5">
                      <span className="font-medium">{label}</span>
                      <span className="text-muted">{detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      )}
    </Card>
  );
}
