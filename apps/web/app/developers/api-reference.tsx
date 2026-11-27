import { Card } from "@heroui/react/card";
import {
  developerReportReadCost,
  developerScanCost,
} from "../../lib/developer-token";

function cost(amount: number | null) {
  return amount === null
    ? "Unavailable"
    : amount.toLocaleString("en") + (amount === 1 ? " point" : " points");
}
export function ApiRates() {
  return (
    <dl className="grid w-full grid-cols-3 gap-3">
      {[
        ["Current report", "Free"],
        ["Saved report", cost(developerReportReadCost)],
        ["New scan", cost(developerScanCost)],
      ].map(([name, value]) => (
        <div key={name}>
          <dt className="text-sm text-muted">{name}</dt>
          <dd className="mt-1 font-semibold md:text-xl">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function ApiExample() {
  return (
    <Card variant="secondary" className="min-w-0 p-5">
      <Card.Header>
        <Card.Title>Request a published report</Card.Title>
      </Card.Header>
      <Card.Content>
        <pre className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">
          <code>
            {
              'curl "https://datadeal.app/api/v1/developer/reports/example.org" \\\n  -H "Authorization: Bearer $DATADEAL_TOKEN"'
            }
          </code>
        </pre>
      </Card.Content>
    </Card>
  );
}
