"use client";
import { Accordion, Card, Chip } from "@heroui/react";
import {
  practiceRubric,
  grades,
  methodologyVersion,
  contextualRulesRevision,
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

export function MethodologyPage() {
  return (
    <article className="mx-auto w-full max-w-4xl space-y-10 py-10 sm:space-y-12 sm:py-16">
      <div className="max-w-2xl">
        <Chip size="sm" variant="soft">
          Methodology {methodologyVersion}
        </Chip>
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
        <p className="max-w-prose leading-relaxed">
          We rate each practice we can verify for the tested visit. The lowest
          supported practice score sets the scenario rating. A cookie and the
          request carrying its value describe one practice. Seeing it on several
          pages does not lower the rating again.
        </p>
        <Accordion className="mt-4">
          <Accordion.Item id="practices">
            <Accordion.Heading>
              <Accordion.Trigger>
                Scores by practice and consent choice
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="space-y-4 text-foreground">
                <p>
                  Each score below requires the observed data, operation and
                  timing described in that row. Claims about the recipient’s
                  role, purpose or necessity require a supporting policy
                  passage.
                </p>
                <ul className="list-none divide-y divide-border">
                  {Object.entries(practiceRubric).map(([rule, item]) => (
                    <li key={rule} className="space-y-2 py-3">
                      <p>{item.label}</p>
                      <dl className="grid max-w-sm grid-cols-3 gap-x-2 text-sm">
                        {(
                          [
                            ["Before choice", item.default],
                            ["Rejected", item.rejected],
                            ["Accepted all", item.accepted],
                          ] as const
                        ).map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-muted">{label}</dt>
                            <dd className="font-medium tabular-nums">
                              {value ?? "Unrated"}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
                <p>
                  The headline normally rates the measured visit after accepting
                  all optional features. If the scanner finds no consent
                  controls, we can rate the signed-out visit when the homepage
                  and sampled pages show no outside requests or end-of-visit
                  storage and the site's visitor policy explicitly rules out
                  cookies and personal data collection. These ratings say “No
                  choice detected.” Unconfirmed choices and incomplete evidence
                  can leave a site unrated.
                </p>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item id="coverage">
            <Accordion.Heading>
              <Accordion.Trigger>
                When a scan qualifies for a rating
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="max-w-prose space-y-3 text-foreground">
                <p>
                  Each scenario needs a completed visit in a fresh browser
                  context. For advertising or analytics we check the data class,
                  purpose, recipient, consent phase and supporting citations. To
                  link a stored identifier to a request we require an exact
                  match inside that visit. Only the match result is retained.
                </p>
                <p>
                  A conditional policy statement explains what may happen. A
                  request attempt, unknown provider or unreadable payload leaves
                  questions open. A payment, conversation or security cookie can
                  support a feature the visitor requested.
                </p>
                <p>
                  Favorable ratings are provisional. They need complete
                  inspection of the selected pages, policy citations about
                  purpose and sharing, and an assessment of each observed
                  practice. Unknown recipients, truncated coverage or missing
                  analysis can leave a visit unrated. Signed-in activity and
                  later server-side processing remain outside the test.
                </p>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </section>
      <footer className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-4 text-sm">
        <strong>Version {methodologyVersion}</strong>
        <span>
          This version uses {contextualRulesRevision}. Each published report
          keeps the evidence and rules used to calculate its rating.
        </span>
      </footer>
    </article>
  );
}
