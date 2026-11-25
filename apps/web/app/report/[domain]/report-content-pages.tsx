import { Accordion } from "@heroui/react";
import { biggestContentPageDifference } from "../../../lib/content-page-difference";
import {
  domainCount,
  pageScenarioLabels,
  type PublicContentPageSample,
} from "../../../lib/content-pages";

const coverageLabels = {
  control_unavailable: "No matching consent control found",
  inconclusive: "Could not confirm this visit",
  untested: "Not tested",
  measured: "Measurement unavailable",
};

export function ReportContentPages({
  sample,
  homepage,
}: {
  sample: PublicContentPageSample;
  homepage?: { id: string; outside: number };
}) {
  const greatest = biggestContentPageDifference(sample, homepage);
  if (!sample.pages.length) return null;
  const measured = sample.pages.filter((page) =>
    page.visits.some((visit) => visit.measurement),
  );
  const gaps = sample.pages.flatMap((page) =>
    page.visits
      .filter((visit) => !visit.measurement)
      .map((visit) => ({ path: page.path, ...visit })),
  );

  return (
    <section
      aria-labelledby="content-pages-title"
      className="min-w-0 py-4 [&_a]:text-foreground! [&_a]:decoration-accent [&_a]:underline-offset-4"
    >
      <h2 id="content-pages-title" className="text-xl! font-semibold!">
        {measured.length ? "How visits differ across pages" : "Page coverage"}
      </h2>
      {homepage && greatest && (
        <p className="mt-2 text-sm leading-relaxed">
          Before any consent choice, the browser attempted requests to{" "}
          <a
            className="inline-link wrap-anywhere"
            href={"#evidence-" + greatest.id}
          >
            {domainCount(greatest.outside)} on {greatest.finalPath}
          </a>{" "}
          and{" "}
          <a className="inline-link" href={"#evidence-" + homepage.id}>
            {domainCount(homepage.outside)} on the homepage
          </a>
          .
        </p>
      )}
      <p className="my-2 text-sm text-muted">
        Recorded visits on {measured.length} of {sample.pages.length} selected
        pages.
      </p>
      <Accordion>
        {measured.map((page) => (
          <Accordion.Item key={page.path} id={page.path}>
            <Accordion.Heading>
              <Accordion.Trigger className="gap-3">
                <span className="min-w-0 grow text-start wrap-anywhere">
                  {page.path}
                </span>
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body>
                <p className="mb-2 text-xs text-muted">
                  Found{" "}
                  {page.source === "sitemap"
                    ? "in the sitemap"
                    : "on the homepage"}
                  .
                </p>
                <dl className="grid gap-2 text-sm text-foreground">
                  {page.visits.map(
                    ({ scenario, measurement }) =>
                      measurement && (
                        <div
                          key={scenario}
                          className="grid gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)]"
                        >
                          <dt className="font-medium">
                            {pageScenarioLabels[scenario]}
                          </dt>
                          <dd className="min-w-0 wrap-anywhere">
                            <a
                              className="inline-link"
                              aria-label={`${pageScenarioLabels[scenario]} evidence for ${page.path}, ${domainCount(measurement.outside)}`}
                              href={"#evidence-" + measurement.id}
                            >
                              {domainCount(measurement.outside)}
                            </a>{" "}
                            across {measurement.requests} attempted requests.
                            {measurement.afterChoiceOutside !== undefined && (
                              <>
                                {" "}
                                After the choice, the browser tried to reach{" "}
                                {domainCount(measurement.afterChoiceOutside)}.
                              </>
                            )}
                            {measurement.examples.length > 0 && (
                              <span className="block text-xs text-muted">
                                {measurement.examples.join(" · ")}
                                {measurement.outside >
                                  measurement.examples.length && " · …"}
                              </span>
                            )}
                            {measurement.finalPath !== page.path && (
                              <span className="block text-xs text-muted">
                                Visit ended at {measurement.finalPath}.
                              </span>
                            )}
                          </dd>
                        </div>
                      ),
                  )}
                </dl>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
        {gaps.length > 0 && (
          <Accordion.Item id="coverage">
            <Accordion.Heading>
              <Accordion.Trigger>
                Page sampling details
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body>
                <p>
                  Selected from {sample.discoveryLimited ? "at least " : ""}
                  {sample.discovered} eligible URLs.
                </p>
                <dl className="mt-2 space-y-2 text-sm text-muted">
                  {sample.pages.map((page) => {
                    const missing = gaps.filter(
                      (gap) => gap.path === page.path,
                    );
                    if (!missing.length) return null;
                    return (
                      <div key={page.path}>
                        <dt className="font-medium wrap-anywhere">
                          {page.path}
                        </dt>
                        {missing.map((visit) => (
                          <dd key={visit.scenario}>
                            {pageScenarioLabels[visit.scenario]} ·{" "}
                            {coverageLabels[visit.outcome]}
                          </dd>
                        ))}
                      </div>
                    );
                  })}
                </dl>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        )}
      </Accordion>
    </section>
  );
}
