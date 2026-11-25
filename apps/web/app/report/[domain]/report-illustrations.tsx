import type { ReactNode } from "react";
import { Button, Card, Disclosure, buttonVariants } from "@heroui/react";
import { Timeline } from "@heroui-pro/react/timeline";
import { LineChart } from "@heroui-pro/react/line-chart";
import { ConsentTable } from "./consent-table";

import { ReportIcon } from "./report-icon";

const exampleVisits = [
  { label: "Default", outside: 2, cookies: 3 },
  { label: "Reject optional", outside: 1, cookies: 1 },
  { label: "Accept optional", outside: 4, cookies: 6 },
];
const exampleHistory = [
  { period: "Earlier scan", rating: 64 },
  { period: "Policy update", rating: 68 },
  { period: "Later scan", rating: 73 },
];
const exampleFindings = [
  ["First-party host", "The example policy names the operator as the host."],
  ["Booking service", "The example flow includes a scheduling provider."],
  ["Policy excerpt", "Look up the wording behind a policy claim."],
  ["Browser observation", "Inspect the source for a measured browser visit."],
];

// This component accepts an illustrative graph and a separate entitlement control.
// Every table, chart, timeline and finding below uses only the local examples.
export function AdvancedPreview({
  graph,
  reward,
}: {
  graph: ReactNode;
  reward?: ReactNode;
}) {
  return (
    <Card
      role="region"
      aria-label="Advanced report preview"
      className="report-preview mt-3 gap-0 overflow-hidden rounded-2xl border border-separator bg-surface p-0 shadow-none"
    >
      <Card.Content className="grid gap-0 p-0 sm:grid-cols-[1.15fr_1fr]">
        <div className="flex flex-col items-start justify-center px-5 pt-6 pb-3 sm:py-8 sm:ps-8 sm:pe-2">
          <h3 className="m-0 text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
            Follow your data
          </h3>
          <p className="mt-2 max-w-80 text-sm leading-relaxed text-muted">
            Explore recipient connections, compare consent choices and see what
            changed between scans.
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
            Example data flow
          </figcaption>
        </figure>
      </Card.Content>
      {reward}
      <Disclosure className="border-t border-separator">
        <Disclosure.Heading>
          <Button
            slot="trigger"
            variant="ghost"
            className="flex min-h-12 w-full justify-between gap-3 rounded-none bg-surface-secondary/60 px-5 py-2 text-left sm:px-8"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <ReportIcon name="glance" />
              Explore the example
            </span>
            <span className="inline-flex items-center gap-2 text-xs font-normal text-muted">
              Fictional data <Disclosure.Indicator />
            </span>
          </Button>
        </Disclosure.Heading>
        <Disclosure.Content>
          <Disclosure.Body className="report-preview-backdrop grid min-w-0 gap-6 border-t border-separator p-5 sm:grid-cols-2 sm:p-6">
            <p className="m-0 text-sm leading-relaxed text-muted sm:col-span-2">
              These examples show how a report works for a fictional website.
            </p>
            <div className="min-w-0">
              <h4 className="text-sm font-semibold">Consent comparison</h4>
              <ConsentTable
                label="Example consent measurements"
                rows={exampleVisits}
              />
            </div>
            <div className="min-w-0">
              <h4 className="mb-2 text-sm font-semibold">
                Providers and evidence
              </h4>
              <dl className="grid gap-2 text-sm">
                {exampleFindings.map(([title, description]) => (
                  <div key={title}>
                    <dt className="font-medium">{title}</dt>
                    <dd className="text-muted">{description}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="preview-timeline min-w-0">
              <h4 className="mb-1 text-sm font-semibold">Scan history</h4>
              <LineChart data={exampleHistory} height={62}>
                <LineChart.Line
                  dataKey="rating"
                  name="Example rating"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
              <Timeline size="sm" density="compact">
                {["Earlier scan", "Policy update", "Later scan"].map(
                  (label) => (
                    <Timeline.Item key={label}>
                      <Timeline.Rail>
                        <Timeline.Marker />
                        <Timeline.Connector />
                      </Timeline.Rail>
                      <Timeline.Content>{label}</Timeline.Content>
                    </Timeline.Item>
                  ),
                )}
              </Timeline>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <h4 className="mb-2 text-sm font-semibold">
                Example policy change
              </h4>
              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
                <dt className="font-medium">Previous wording</dt>
                <dd>“We keep booking details for one year.”</dd>
                <dt className="font-medium">Revised wording</dt>
                <dd>“We keep booking details for 30 days.”</dd>
              </dl>
            </div>
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
    </Card>
  );
}
