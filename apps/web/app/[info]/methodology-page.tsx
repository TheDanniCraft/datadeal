"use client";
import { Accordion, Card } from "@heroui/react";
import {
  breadth,
  consentPenalty,
  missingPolicyCost,
  outsideEuFactor,
  outsideEuHosting,
  grades,
  inventoryCosts,
  methodologyVersion,
} from "@datadeal/scoring";
import { ratingGuidance } from "../../lib/rating-guidance";

const ratingColors = {
  Excellent: "text-(--rating-excellent)",
  Good: "text-(--rating-good)",
  Mixed: "text-(--rating-mixed)",
  Concerning: "text-(--rating-concerning)",
  Poor: "text-(--rating-poor)",
  Critical: "text-(--rating-critical)",
} as const;
const headingStyle = "mb-4 text-2xl font-semibold tracking-tight";

const costLabels: [keyof typeof inventoryCosts, string][] = [
  [
    "contactAdvertising",
    "Your email address reaches an ad or tracking company",
  ],
  ["linkedAdvertising", "An ID is sent to an ad or tracking company"],
  ["advertisingId", "An advertising ID is stored in your browser"],
  ["analyticsId", "An analytics ID is stored in your browser"],
  ["independentRecipient", "Data goes to a company that uses it for itself"],
  ["advertisingStorage", "Advertising storage without an ID"],
  ["unknownIdentifier", "An ID we couldn't identify"],
  ["contractAnalytics", "Analytics run for the site, without a lasting ID"],
  ["proportionate", "Needed for the site to work, such as login or a cart"],
];
const extraCosts: [string, string][] = [
  ["No privacy policy found", "−" + missingPolicyCost],
  ["Hosting or CDN outside the EU", "−" + outsideEuHosting],
  [
    "Any item above, when the company is outside the EU",
    "+" + Math.round((outsideEuFactor - 1) * 100) + "%",
  ],
];

export function MethodologyPage() {
  return (
    <article className="mx-auto w-full max-w-4xl space-y-10 py-10 sm:space-y-12 sm:py-16">
      <div className="max-w-2xl">
        <h1 className="my-3 text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          Scoring methodology
        </h1>
        <p className="leading-relaxed">
          DataDeal compares what a website discloses with what happens during a
          browser visit. Each rating links back to the evidence that changed its
          score.
        </p>
      </div>
      <section aria-labelledby="rating-bands">
        <h2 className={headingStyle} id="rating-bands">
          What the ratings mean
        </h2>
        <ul className="grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 sm:gap-3">
          {grades.map(([minimum, grade], index) => (
            <li data-rating={grade.toLowerCase()} key={grade}>
              <Card className="h-full rounded-xl p-4 shadow-none ring-1 ring-inset ring-border sm:p-5">
                <Card.Content className="gap-0">
                  <div className="flex items-baseline gap-1 tabular-nums">
                    <strong
                      className={`text-2xl font-semibold leading-none tracking-tight sm:text-4xl ${ratingColors[grade]}`}
                    >
                      {minimum}–{index === 0 ? 100 : grades[index - 1][0] - 1}
                    </strong>
                    <span className="text-xs text-muted">/100</span>
                  </div>
                  <h3
                    className={`mt-1 text-base font-semibold ${ratingColors[grade]}`}
                  >
                    {grade}
                  </h3>
                  <p className="mt-1 text-sm leading-snug">
                    {ratingGuidance[grade][0]}
                  </p>
                </Card.Content>
              </Card>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-relaxed">
          <strong className="me-1">Unrated</strong> The scan has too little
          verified evidence to publish a number.
        </p>
      </section>
      <section aria-labelledby="calculation">
        <h2 id="calculation" className={headingStyle}>
          How the score is calculated
        </h2>
        <div className="max-w-prose space-y-3 leading-relaxed">
          <p>
            Every site starts at 100. We list each cookie, stored value and
            outside connection from the visit, find out who receives it and why,
            and give each item a cost. A cookie that keeps you logged in costs
            nothing. An advertising ID shared with a data broker costs a lot.
          </p>
          <p>
            The largest cost counts in full. Everything else adds a smaller
            amount that grows slowly with how much there is, up to {breadth.cap}{" "}
            points. Anything that starts before you make a cookie choice costs{" "}
            {Math.round((consentPenalty - 1) * 100)}% more.
          </p>
          <p>
            Where your data goes matters too. An item that reaches a company
            based outside the EU (or Switzerland and the UK) costs{" "}
            {Math.round((outsideEuFactor - 1) * 100)}% more, because EU privacy
            law can&apos;t fully protect it there. Hosting or a CDN outside the
            EU costs {outsideEuHosting} points; EU hosting costs nothing. A site
            with no privacy policy, which EU law requires, costs{" "}
            {missingPolicyCost} points.
          </p>
          <p>
            The headline score rates the visit after you accept all cookies.
            When part of the site could not be tested, the score moves toward
            the middle of the scale, because we can&apos;t vouch for what we
            didn&apos;t see.
          </p>
        </div>
        <Accordion className="mt-4">
          <Accordion.Item id="costs">
            <Accordion.Heading>
              <Accordion.Trigger>
                What each item costs
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="text-foreground">
                <ul className="m-0 list-none divide-y divide-border p-0">
                  {[
                    ...costLabels.map(
                      ([key, label]) =>
                        [label, "−" + inventoryCosts[key]] as [string, string],
                    ),
                    ...extraCosts,
                  ].map(([label, value]) => (
                    <li
                      key={label}
                      className="flex items-baseline justify-between gap-4 py-2.5"
                    >
                      <span>{label}</span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {value}
                      </span>
                    </li>
                  ))}
                </ul>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item id="coverage">
            <Accordion.Heading>
              <Accordion.Trigger>
                When a site stays unrated
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="max-w-prose space-y-3 text-foreground">
                <p>
                  We need a completed visit with a working &ldquo;Accept
                  all&rdquo; button. Without one, the report still shows what we
                  found but doesn&apos;t give a number. A missing privacy policy
                  doesn&apos;t stop the rating; it costs points instead.
                </p>
                <p>
                  What happens after you sign in, or on the company&apos;s
                  servers later, is outside what a browser visit can see.
                </p>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </section>
      <footer className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-4 text-sm">
        <strong>Version {methodologyVersion}</strong>
        <span>Each report keeps the evidence behind its rating.</span>
      </footer>
    </article>
  );
}
