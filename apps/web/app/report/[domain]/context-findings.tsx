import { Accordion, Button } from "@heroui/react";
import { scenarioLabel } from "@datadeal/contracts";
import { useState } from "react";
import {
  groupPracticeTakeaways,
  type PracticeTakeaway,
} from "../../../lib/practice-takeaways";

type Citation = PracticeTakeaway["citations"][number];

function citationLinks(citations: Citation[]) {
  const unique = Array.from(
    new Map(
      citations.map((item) => [JSON.stringify([item.id, item.quote]), item]),
    ).values(),
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
      {unique.map(({ id, label, quote }) => (
        <a
          className="inline-link inline-flex min-h-8 items-center wrap-anywhere"
          key={JSON.stringify([id, quote])}
          href={"#evidence-" + id}
          aria-haspopup="dialog"
          data-citation-quote={quote}
        >
          {label}
        </a>
      ))}
    </div>
  );
}

function timing(row: PracticeTakeaway) {
  switch (row.control) {
    case "before_choice":
      return scenarioLabel.default;
    case "after_accept":
      return scenarioLabel.accepted;
    case "after_reject":
      return scenarioLabel.rejected;
    default:
      return row.trigger;
  }
}

function choiceEvidence(rows: PracticeTakeaway[]) {
  const visits = new Map<string, { label: string; items: Citation[] }>();
  const sources = new Map<string, Citation>();
  for (const row of rows) {
    const { visitId, mechanism } = row.choiceStorage!;
    for (const citation of row.citations) {
      if (citation.id !== visitId) {
        sources.set(JSON.stringify([citation.id, citation.quote]), citation);
        continue;
      }
      const location = citation.label.startsWith("Sampled visit · ")
        ? citation.label.slice("Sampled visit · ".length)
        : "Homepage";
      const visit = visits.get(visitId) ?? {
        label: location + " · " + timing(row),
        items: [],
      };
      if (
        !visit.items.some(
          (item) =>
            item.quote === citation.quote &&
            item.label === mechanismLabel(mechanism),
        )
      ) {
        visit.items.push({ ...citation, label: mechanismLabel(mechanism) });
      }
      visits.set(visitId, visit);
    }
  }
  return (
    <>
      {Array.from(visits, ([id, visit]) => (
        <div key={id} className="grid gap-1.5">
          <p className="m-0! wrap-anywhere font-medium">{visit.label}</p>
          {citationLinks(visit.items)}
        </div>
      ))}
      {citationLinks([...sources.values()])}
    </>
  );
}

function mechanismLabel(mechanism: "cookie" | "local_storage") {
  return mechanism === "cookie" ? "Cookie record" : "Local storage record";
}

function LinkedVisit({ row }: { row: PracticeTakeaway }) {
  const sampled = row.citations.find((item) =>
    item.label.startsWith("Sampled visit · "),
  );
  const path = sampled?.label.slice("Sampled visit · ".length);
  const segments = path?.split("/").filter(Boolean);
  const section =
    segments && segments.length > 1
      ? "/" + segments.slice(0, -1).join("/") + "/…"
      : path;
  const references = row.citations.map(({ id, quote, label }) => ({
    source: id,
    quote,
    label: id === sampled?.id ? "Page visit" : label,
  }));
  const primary =
    references.find((item) => item.source === sampled?.id) ?? references[0]!;
  return (
    <div className="grid gap-1">
      <a
        className="inline-link inline-flex min-h-9 w-fit items-center wrap-anywhere font-medium"
        aria-haspopup="dialog"
        href={"#evidence-" + primary.source}
        data-citation-quote={primary.quote}
        data-citation-group={JSON.stringify([
          primary,
          ...references.filter((item) => item !== primary),
        ])}
        title={path}
      >
        {section ? "Visit to " + section : "Visit evidence"}
      </a>
      <p className="m-0!">{row.significance}</p>
      {row.unknowns.length > 0 && (
        <p className="m-0! text-xs text-muted">{row.unknowns.join(" ")}</p>
      )}
    </div>
  );
}

function observationHeadline(row: PracticeTakeaway) {
  // The capture describes the phase separately. Keep the original wording for
  // older interpretations where the opening clause carries other information.
  const prefix = row.trigger + ", ";
  if (!row.summary.startsWith(prefix)) return row.summary;
  const text = row.summary.slice(prefix.length);
  return text.replace(
    /^(?:the|a|an|this)\b/u,
    (word) => word.charAt(0).toUpperCase() + word.slice(1),
  );
}

export function ContextFindings({ rows }: { rows: PracticeTakeaway[] }) {
  const [showAll, setShowAll] = useState(false);
  const groups = groupPracticeTakeaways(rows);
  if (!groups.length) return null;
  const visible = showAll ? groups : groups.slice(0, 3);
  return (
    <section
      className="report-drill mt-8"
      aria-labelledby="data-practices-title"
    >
      <h2 id="data-practices-title" className="mb-2 text-xl! font-semibold!">
        Browser findings
      </h2>
      <Accordion className="w-full">
        {visible.map(({ id, choice, observations }) => {
          const first = observations[0]!;
          const linked = !first.mismatch && first.linkedRequest;
          const headline = choice
            ? "Your browser remembers your cookie choice"
            : linked
              ? "An ID in your browser also reached " + linked.recipient
              : first.quietVisit && !first.mismatch
                ? "No outside requests on the tested " +
                  (observations.length > 1 ? "pages" : "page")
                : observationHeadline(first);
          const scenarios = [...new Set(observations.map(timing))];
          const unknowns = [
            ...new Set(observations.flatMap((row) => row.unknowns)),
          ];
          return (
            <Accordion.Item key={id} id={id}>
              <Accordion.Heading>
                <Accordion.Trigger className="items-center gap-4 py-3 text-left">
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="wrap-anywhere text-sm font-medium leading-snug">
                      {headline}
                    </span>
                    <span className="text-xs font-normal leading-relaxed text-muted">
                      {first.mismatch
                        ? "Policy conflict · "
                        : first.provenance === "Policy"
                          ? "Policy disclosure · "
                          : ""}
                      {scenarios.join(" · ")}
                    </span>
                  </span>
                  <Accordion.Indicator className="shrink-0" />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="grid gap-3 pb-4 text-sm leading-relaxed">
                  {linked ? (
                    observations.map((row) => (
                      <LinkedVisit key={row.factId} row={row} />
                    ))
                  ) : (
                    <>
                      <p className="m-0!">
                        {choice
                          ? "The site’s cookie policy explains that it saves this preference so it can apply your choice."
                          : first.quietVisit
                            ? "The browser also had no cookies or web storage at the end of each recorded visit."
                            : first.significance}
                      </p>
                      {first.mismatch && (
                        <p className="m-0! text-warning">{first.mismatch}</p>
                      )}
                      {choice
                        ? choiceEvidence(observations)
                        : citationLinks(
                            observations
                              .flatMap((row) => row.citations)
                              .map((citation) =>
                                first.quietVisit &&
                                citation.label === "Browser observation"
                                  ? { ...citation, label: "Homepage visit" }
                                  : citation,
                              ),
                          )}
                      {!!unknowns.length && (
                        <p className="m-0! text-xs leading-relaxed text-muted">
                          {unknowns.join(" ")}
                        </p>
                      )}
                    </>
                  )}
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
      {groups.length > 3 && (
        <Button size="sm" variant="ghost" onPress={() => setShowAll(!showAll)}>
          {showAll
            ? "Show fewer findings"
            : `Show ${groups.length - 3} more findings`}
        </Button>
      )}
    </section>
  );
}
