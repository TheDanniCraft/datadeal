import { biggestContentPageDifference } from "../../../lib/content-page-difference";
import {
  domainCount,
  pageName,
  type PublicContentPageSample,
} from "../../../lib/content-pages";

const columns = [
  ["default", "Before you choose"],
  ["rejected", "After rejecting"],
  ["accepted", "After accepting"],
] as const;
type Scenario = (typeof columns)[number][0];
type Visit = { id: string; outside: number };

function Count({ visit, label }: { visit?: Visit; label: string }) {
  if (!visit) return <span className="text-muted">–</span>;
  return (
    <a
      href={"#evidence-" + visit.id}
      aria-haspopup="dialog"
      aria-label={label + ", " + domainCount(visit.outside)}
      className="inline-flex min-h-7 items-center rounded-full px-2 font-medium tabular-nums text-foreground no-underline hover:bg-accent/10"
    >
      {visit.outside === 20 ? "20+" : visit.outside}
    </a>
  );
}

export function ReportContentPages({
  sample,
  homepage,
  homepageAccepted,
}: {
  sample: PublicContentPageSample;
  homepage?: Visit;
  homepageAccepted?: Visit;
}) {
  if (!sample.pages.length) return null;
  const greatest = biggestContentPageDifference(sample, homepage);
  const names = new Map<string, string>();
  const used = new Map<string, number>();
  for (const { path } of sample.pages) {
    const name = pageName(path);
    const n = (used.get(name) ?? 0) + 1;
    used.set(name, n);
    names.set(path, n > 1 ? `${name} ${n}` : name);
  }
  const rows: {
    key: string;
    name: string;
    path?: string;
    visits: Partial<Record<Scenario, Visit>>;
  }[] = [
    {
      key: "home",
      name: "Homepage",
      visits: { default: homepage, accepted: homepageAccepted },
    },
    ...sample.pages.map((page) => ({
      key: page.path,
      name: names.get(page.path)!,
      path: page.path,
      visits: Object.fromEntries(
        page.visits.flatMap(({ scenario, measurement }) =>
          measurement
            ? [[scenario, { id: measurement.id, outside: measurement.outside }]]
            : [],
        ),
      ) as Partial<Record<Scenario, Visit>>,
    })),
  ];
  const shown = columns.filter(([scenario]) =>
    rows.some((row) => row.visits[scenario]),
  );
  const greatestName = greatest
    ? sample.pages.find((page) =>
        page.visits.some((v) => v.measurement?.id === greatest.id),
      )
    : undefined;

  return (
    <section aria-labelledby="content-pages-title" className="min-w-0 py-4">
      <h2 id="content-pages-title" className="text-xl! font-semibold!">
        Other pages we visited
      </h2>
      <p className="mt-1 mb-3 text-sm text-muted">
        {greatest && homepage && greatestName
          ? `The ${names.get(greatestName.path)} page reached ${domainCount(greatest.outside)} before you choose, the homepage ${homepage.outside}.`
          : "Outside domains the browser reached on each page."}
      </p>
      <div className="overflow-x-auto rounded-2xl border border-separator">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            Outside domains reached on each visited page
          </caption>
          <thead>
            <tr className="text-xs text-muted">
              <th className="px-4 py-2 text-left font-normal">Page</th>
              {shown.map(([scenario, label]) => (
                <th
                  key={scenario}
                  className="px-2 py-2 text-center font-normal"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="[&>*]:border-t [&>*]:border-separator"
              >
                <th
                  scope="row"
                  className="px-4 py-2 text-left font-medium"
                  title={row.path}
                >
                  {row.name}
                </th>
                {shown.map(([scenario, label]) => (
                  <td key={scenario} className="px-2 py-2 text-center">
                    <Count
                      visit={row.visits[scenario]}
                      label={`${row.name}, ${label}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
