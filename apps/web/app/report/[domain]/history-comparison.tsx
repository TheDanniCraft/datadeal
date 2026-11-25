import type { changedScoreDrivers } from "../../../lib/history";
import type { compareVisitDestinations } from "../../../lib/visit-history";
import type { PolicyDisclosureChange } from "../../../lib/policy-history";
import { ProviderDisclosure } from "../../data-flow/provider-lookup";

export type ScanComparison = {
  score: ReturnType<typeof changedScoreDrivers>;
  destinations: ReturnType<typeof compareVisitDestinations>;
  policy: PolicyDisclosureChange[];
};

export function HistoryComparison({
  comparison,
}: {
  comparison?: ScanComparison;
}) {
  if (
    !comparison ||
    (!comparison.score && !comparison.destinations && !comparison.policy.length)
  )
    return null;
  const { score, destinations, policy } = comparison;
  return (
    <div className="mb-5 grid min-w-0 gap-1 wrap-anywhere">
      {score && (
        <ProviderDisclosure label="What changed the score">
          <div className="grid gap-3 sm:grid-cols-2">
            {([score.earlier, score.later] as const).map((visit, index) => (
              <div
                key={visit.scanId}
                className="rounded-xl bg-surface-secondary p-4"
              >
                <p className="mt-0 text-sm text-muted">
                  {index ? "This scan" : "Previous scan"} ·{" "}
                  {visit.date.slice(0, 10)} UTC
                </p>
                <strong className="text-xl tabular-nums">
                  {visit.score}/100
                </strong>
                {visit.reasons.map(({ text, sources }) => (
                  <div key={text} className="mt-2 text-sm">
                    <p>{text}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {sources.map(({ id, label }) => (
                        <a
                          key={id}
                          className="inline-link"
                          href={
                            (index ? "" : "?scan=" + visit.scanId) +
                            "#evidence-" +
                            id
                          }
                        >
                          {label}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </ProviderDisclosure>
      )}
      {destinations && (
        <ProviderDisclosure label="Connections after accepting all">
          <p>
            Outside domains the browser tried to reach on the two visits to{" "}
            {destinations.pageUrl}.
          </p>
          {destinations.earlierOnly.length || destinations.laterOnly.length ? (
            <dl className="my-3 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["Earlier visit only", destinations.earlierOnly],
                  ["Later visit only", destinations.laterOnly],
                ] as const
              ).map(([label, hosts]) => (
                <div key={label}>
                  <dt className="font-medium">{label}</dt>
                  <dd className="text-sm">
                    {hosts.length ? hosts.join(", ") : "None"}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>The recorded destination lists matched.</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <a className="inline-link" href={destinations.previous.href}>
              Earlier browser visit
            </a>
            <a
              className="inline-link"
              href={"#evidence-" + destinations.current.evidenceId}
            >
              Later browser visit
            </a>
          </div>
        </ProviderDisclosure>
      )}
      {policy.length > 0 && (
        <ProviderDisclosure label="Added wording in the privacy policy">
          <ul className="space-y-4">
            {policy.map((change) => (
              <li key={change.current.evidenceId + change.quote}>
                <h4 className="font-medium">{change.heading}</h4>
                <blockquote className="my-2 border-s-2 border-accent ps-3">
                  {change.quote}
                </blockquote>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                  <a className="inline-link" href={change.previous.href}>
                    Earlier policy section
                  </a>
                  <a
                    className="inline-link"
                    href={"#evidence-" + change.current.evidenceId}
                    data-citation-quote={change.quote}
                  >
                    Read added passage
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </ProviderDisclosure>
      )}
    </div>
  );
}
