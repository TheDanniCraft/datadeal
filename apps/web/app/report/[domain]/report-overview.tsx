import type {
  CompanyFinding,
  CompanyPurpose,
} from "../../../lib/company-findings";

type Visit = {
  scenario: "default" | "rejected" | "accepted";
  outside: number;
  cookies: number;
};

const scenarioNames = {
  default: "Before you choose",
  rejected: "After rejecting",
  accepted: "After accepting all",
} as const;

// Ordered by how much the purpose costs a visitor: darkest = worst.
const purposeOrder: [CompanyPurpose, string, string][] = [
  ["advertising", "Advertising", "var(--chart-1)"],
  ["analytics", "Analytics", "var(--chart-2)"],
  ["unknown", "Unidentified", "var(--chart-3)"],
  ["hosting", "Hosting", "var(--chart-4)"],
  ["needed", "Needed for the site", "var(--chart-5)"],
];

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="grid content-start gap-1 rounded-2xl border border-separator p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 text-2xl leading-none font-semibold tabular-nums">
        {value}
      </dd>
      {note && <dd className="m-0 text-xs text-muted">{note}</dd>}
    </div>
  );
}

function Panel({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      className={
        "grid content-start gap-3 rounded-2xl border border-separator p-4 sm:p-5" +
        (wide ? " md:col-span-2" : "")
      }
    >
      <h3 className="m-0! text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** Horizontal bars with the value written at the end. */
function Bars({
  rows,
  max,
  format = String,
}: {
  rows: { key: string; label: string; value: number; title?: string }[];
  max: number;
  format?: (value: number) => string;
}) {
  return (
    <ul className="m-0! grid list-none gap-2 p-0!">
      {rows.map((row) => (
        <li
          key={row.key}
          className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-xs"
          title={row.title}
        >
          <span className="truncate text-foreground">{row.label}</span>
          <span className="h-2.5 rounded-full bg-default/60">
            <span
              className="block h-full rounded-full bg-(--chart-2)"
              style={{
                width: max ? Math.max(3, (row.value / max) * 100) + "%" : 0,
              }}
            />
          </span>
          <span className="min-w-8 text-right font-medium tabular-nums">
            {format(row.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The report at a glance: counts first, then what drives the score, what
 * the cookie choice changes and why companies get data.
 */
export function ReportOverview({
  companies,
  visits,
  headline,
}: {
  companies: CompanyFinding[];
  visits: Visit[];
  headline?: { cookies: number; outside: number };
}) {
  const outside = companies.filter((c) => !c.firstParty);
  const ads = companies.filter((c) => c.purpose === "advertising").length;
  const outsideEu = companies.filter((c) => c.outsideEu).length;
  const costly = companies
    .filter((c) => c.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);
  const purposeCounts = purposeOrder
    .map(([purpose, label, color]) => ({
      purpose,
      label,
      color,
      count: companies.filter((c) => c.purpose === purpose).length,
    }))
    .filter(({ count }) => count > 0);
  const measured = (["default", "rejected", "accepted"] as const).flatMap(
    (scenario) => visits.filter((v) => v.scenario === scenario).slice(0, 1),
  );
  if (!companies.length && !headline) return null;

  return (
    <section aria-label="Report at a glance" className="grid gap-3">
      <dl className="m-0! grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Companies"
          value={String(outside.length || (headline?.outside ?? 0))}
          note={
            companies.length ? "besides the site itself" : "outside domains"
          }
        />
        <Tile
          label="Advertising"
          value={String(ads)}
          note={ads === 1 ? "company" : "companies"}
        />
        <Tile
          label="Outside the EU"
          value={String(outsideEu)}
          note={outsideEu === 1 ? "company" : "companies"}
        />
        <Tile
          label="Cookies"
          value={headline ? String(headline.cookies) : "–"}
          note="after Accept all"
        />
      </dl>

      <div className="grid gap-3 md:grid-cols-2">
        {costly.length > 0 && (
          <Panel title="Who costs the most points">
            <Bars
              max={costly[0]?.cost ?? 0}
              format={(value) => "−" + Math.round(value)}
              rows={costly.map((company) => ({
                key: company.key,
                label: company.name,
                value: company.cost,
              }))}
            />
            <a className="inline-link text-xs" href="#companies-title">
              See every company
            </a>
          </Panel>
        )}

        {measured.length > 1 && (
          <Panel title="What your cookie choice changes">
            {(
              [
                ["Outside domains", (v: Visit) => v.outside],
                ["Cookies", (v: Visit) => v.cookies],
              ] as const
            ).map(([label, pick]) => {
              const values = measured.map(pick);
              return (
                <div key={label} className="grid gap-1.5">
                  <p className="m-0! text-xs text-muted">{label}</p>
                  <Bars
                    max={Math.max(...values)}
                    format={(value) =>
                      label === "Outside domains" && value >= 20
                        ? "20+"
                        : String(value)
                    }
                    rows={measured.map((visit) => ({
                      key: visit.scenario,
                      label: scenarioNames[visit.scenario],
                      value: pick(visit),
                    }))}
                  />
                </div>
              );
            })}
          </Panel>
        )}

        {purposeCounts.length > 0 && (
          <Panel title="Why companies get your data" wide>
            <div
              className="flex h-3 gap-0.5 overflow-hidden rounded-full"
              role="img"
              aria-label={purposeCounts
                .map(({ label, count }) => `${label}: ${count}`)
                .join(", ")}
            >
              {purposeCounts.map(({ purpose, color, count }) => (
                <span
                  key={purpose}
                  className="h-full first:rounded-s-full last:rounded-e-full"
                  style={{ flexGrow: count, background: color }}
                />
              ))}
            </div>
            <ul className="m-0! flex list-none flex-wrap gap-x-5 gap-y-1.5 p-0! text-xs">
              {purposeCounts.map(({ purpose, label, color, count }) => (
                <li key={purpose} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ background: color }}
                  />
                  <span className="truncate">{label}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </section>
  );
}
