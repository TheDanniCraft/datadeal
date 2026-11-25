"use client";

import {
  isPolicyDocument,
  readingBlockKind,
} from "../../../lib/report-documents";
import { storageEvidence } from "../../../lib/storage-evidence";

import { Button, Modal } from "@heroui/react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { ScanReport } from "@datadeal/contracts";
import { contentPageEvidenceTitle } from "../../../lib/content-pages";

type Evidence = ScanReport["evidence"][number];

export const citationColors = [
  "[--cite:light-dark(var(--color-sky-700),var(--color-sky-300))]",
  "[--cite:light-dark(var(--color-rose-700),var(--color-rose-300))]",
  "[--cite:light-dark(var(--color-violet-700),var(--color-violet-300))]",
  "[--cite:light-dark(var(--color-teal-700),var(--color-teal-300))]",
  "[--cite:light-dark(var(--color-amber-800),var(--color-amber-300))]",
] as const;

const provenance = {
  observed_technical: "Browser or technical observation",
  declared_first_party: "Website policy",
  declared_processor: "Provider disclosure",
  inferred_infrastructure: "Infrastructure inference",
  third_party_reference: "Third-party source",
  unknown: "Source",
};

function sourceLabel(source: Evidence) {
  if (source.documentKind === "imprint") return "Publisher’s legal notice";
  if (source.documentKind === "contact") return "Publisher’s contact page";
  if (source.documentKind === "other") return "Publisher document";
  return provenance[source.kind];
}

export function documentTitle(sources: readonly Evidence[], privacy = false) {
  const root = sources.find((source) =>
    source.documentLayout?.some((b) => b.kind === "title"),
  );
  const title = root?.documentLayout?.find((b) => b.kind === "title");
  if (root && title) return root.excerpt.slice(title.start, title.end);
  const headingRoot = sources.find(
    (item) => item.documentLayout?.[0]?.kind === "heading",
  );
  const headingBlock = headingRoot?.documentLayout?.[0];
  if (headingRoot && headingBlock)
    return headingRoot.excerpt.slice(headingBlock.start, headingBlock.end);
  const first = sources[0];
  if (first?.observation?.type === "processing_document") {
    return first.observation.document === "dpa"
      ? "Data processing agreement"
      : "Subprocessor list";
  }
  if (first?.observation?.type === "provider_policy")
    return first.observation.providerHost + " privacy policy";
  const path = first?.url ? new URL(first.url).pathname : "";
  if (/cookie|storage/i.test(path)) return "Storage and cookies";
  if (privacy || /privacy|datenschutz/i.test(path)) return "Privacy policy";
  if (/terms|nutzung/i.test(path)) return "Terms of use";
  return "Policy document";
}

const highlightClass =
  "rounded-sm bg-[color-mix(in_oklab,var(--cite,var(--accent))_18%,transparent)] py-0.5 text-foreground";

export function DocumentPassages({
  sources,
  quote,
  tone,
}: {
  sources: Evidence[];
  quote?: string;
  tone?: string;
}) {
  const marked = useRef<HTMLElement>(null);
  useEffect(() => {
    marked.current?.scrollIntoView({ block: "center" });
  }, [quote]);
  let highlighted = false;
  function passage(text: string) {
    const offset = quote && !highlighted ? text.indexOf(quote) : -1;
    if (!quote || offset < 0) return text;
    highlighted = true;
    return (
      <>
        {text.slice(0, offset)}
        <mark ref={marked} className={highlightClass}>
          {quote}
        </mark>
        {text.slice(offset + quote.length)}
      </>
    );
  }
  const root = sources.find((item) => !item.observation);
  const layout = root?.documentLayout;
  const sections = sources.filter(
    (item) =>
      item.observation?.type === "policy_section" ||
      item.observation?.type === "provider_policy" ||
      item.observation?.type === "processing_document",
  );
  // Use the snapshot's document order. Some older reports contain only selected sections.
  const compact = (text: string) => text.replace(/\s+/gu, "");
  const recordedText = root && compact(root.excerpt);
  const extraSections = sections.filter(
    (item) => !layout || !recordedText?.includes(compact(item.excerpt)),
  );
  const headings = new Set<string>();
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flushList = () => {
    if (list.length)
      blocks.push(
        <ul key={"list-" + blocks.length} className="list-disc space-y-1 ps-6">
          {list}
        </ul>,
      );
    list = [];
  };
  if (root && layout?.length) {
    let cursor = 0;
    for (const { kind: originalKind, start, end } of layout) {
      if (start < cursor || end <= start || end > root.excerpt.length) continue;
      const text = root.excerpt.slice(start, end);
      cursor = end;
      // Earlier captures were clipped at 4,000 characters, including in the middle of a word.
      if (
        originalKind === "paragraph" &&
        end === 4000 &&
        end === root.excerpt.length &&
        !root.excerpt.includes("\n") &&
        !/[.!?…]["'”’)]?$/u.test(text.trim())
      )
        continue;
      const kind = readingBlockKind(text, originalKind);
      if (kind === "heading") headings.add(text);
      if (kind !== "item") flushList();
      if (kind === "heading" && text === documentTitle(sources)) {
        continue;
      }
      if (kind === "heading" && /^\d+[.)]\s/u.test(text))
        blocks.push(
          <h4 className="pt-2 text-base font-semibold" key={start}>
            {passage(text)}
          </h4>,
        );
      else if (kind === "heading")
        blocks.push(
          <h3
            className="border-t border-separator pt-4 text-lg font-semibold"
            key={start}
          >
            {passage(text)}
          </h3>,
        );
      else if (kind === "item") list.push(<li key={start}>{passage(text)}</li>);
      else if (kind === "metadata")
        blocks.push(
          <span className="me-3 inline-block text-xs text-muted" key={start}>
            {text}
          </span>,
        );
      else if (kind !== "title")
        blocks.push(<p key={start}>{passage(text)}</p>);
    }
    flushList();
  } else if (root && !sections.length)
    blocks.push(<p key={root.id}>{passage(root.excerpt)}</p>);
  for (const item of extraSections) {
    const observation = item.observation;
    if (
      observation?.type !== "policy_section" &&
      observation?.type !== "provider_policy" &&
      observation?.type !== "processing_document"
    )
      continue;
    blocks.push(
      <section key={item.id}>
        {observation.heading.toLowerCase() !==
          documentTitle(sources).toLowerCase() && (
          <h3 className="mb-2 text-base font-semibold">
            {observation.heading}
            {headings.has(observation.heading) && " · Additional passage"}
          </h3>
        )}
        <p>{passage(item.excerpt)}</p>
      </section>,
    );
  }
  return (
    <article
      lang={root?.language ?? sources[0]?.language}
      className={`space-y-3 text-[.9375rem] leading-relaxed font-normal whitespace-pre-line text-foreground wrap-anywhere ${tone ?? ""}`}
    >
      {quote && !highlighted && (
        <blockquote>
          <mark ref={marked} className={highlightClass}>
            {quote}
          </mark>
        </blockquote>
      )}
      {blocks}
    </article>
  );
}

export type VisitStats = {
  id: string;
  requests: number;
  cookies: number;
  storage?: { localEntries: number; sessionEntries: number };
  outside: number;
};

export function ReportCitations({
  evidence,
  visits,
  children,
}: {
  evidence?: readonly Evidence[];
  // Measured counts per visit; the public evidence projection omits the raw
  // observation, so the dialog reads its numbers from here.
  visits?: readonly VisitStats[];
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<{
    source: Evidence;
    quote: string;
    tone?: string;
    document: boolean;
    readingCitation?: boolean;
    group?: { source: Evidence; quote: string; label: string }[];
  } | null>(null);

  const isOpen = Boolean(selection);
  useEffect(() => {
    if (!isOpen) return;
    // React Aria moves focus into its portal after mounting. Escape may arrive
    // while the page body still has focus on a keyboard-opened citation.
    const closeWhileEntering = (event: KeyboardEvent) => {
      if (event.key === "Escape" && document.activeElement === document.body) {
        event.preventDefault();
        setSelection(null);
      }
    };
    document.addEventListener("keydown", closeWhileEntering);
    return () => document.removeEventListener("keydown", closeWhileEntering);
  }, [isOpen]);

  function openCitation(event: MouseEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a[href^="#evidence-"]')
        : null;
    if (!link || link.target === "_blank") return;
    const source = evidence?.find(
      (item) => link.hash === "#evidence-" + item.id,
    );
    if (!source) return;
    event.preventDefault();
    link.focus({ preventScroll: true });
    const quote = link.dataset.citationQuote;
    const group: NonNullable<NonNullable<typeof selection>["group"]> = [];
    if (link.dataset.citationGroup) {
      try {
        const references: unknown = JSON.parse(link.dataset.citationGroup);
        if (Array.isArray(references))
          for (const ref of references) {
            const item = evidence?.find(
              (row) => row.id === ref?.source && row.scanId === source.scanId,
            );
            if (item && typeof ref.label === "string")
              group.push({
                source: item,
                label: ref.label,
                quote:
                  typeof ref.quote === "string" &&
                  item.excerpt.includes(ref.quote)
                    ? ref.quote
                    : item.excerpt,
              });
          }
      } catch {
        /* The primary evidence link remains usable. */
      }
    }
    setSelection({
      source,
      group,
      document: link.dataset.documentReader !== undefined,
      tone: citationColors[Number(link.dataset.citationTone)],
      quote: quote && source.excerpt.includes(quote) ? quote : source.excerpt,
    });
  }

  const source = selection?.source;
  const storage = source && storageEvidence(source);
  const sourceUrl = source?.url ? new URL(source.url) : null;
  const documentSources =
    source?.url && isPolicyDocument(source)
      ? (evidence?.filter(
          (item) =>
            item.scanId === source.scanId &&
            item.url === source.url &&
            item.kind === source.kind,
        ) ?? [])
      : [];
  const heading =
    (source && contentPageEvidenceTitle(source)) ??
    (source?.observation?.type === "browser_request_fields"
      ? "Request to " + source.observation.targetDomain
      : source?.observation?.type === "policy_section" ||
          source?.observation?.type === "provider_policy" ||
          source?.observation?.type === "processing_document"
        ? source.observation.heading
        : source?.consentScenario === "default"
          ? "Default homepage visit"
          : source?.consentScenario === "rejected"
            ? "Visit with optional consent rejected"
            : source?.consentScenario === "accepted"
              ? "Visit with optional consent accepted"
              : source
                ? sourceLabel(source)
                : "");
  const start = selection
    ? selection.source.excerpt.indexOf(selection.quote)
    : 0;
  // Browser visits are measurements, not prose: show their numbers instead
  // of highlighting a long generated description.
  const observed =
    source?.observation?.type === "browser_consent_counts" ||
    source?.observation?.type === "browser_content_page"
      ? source.observation
      : undefined;
  const counted = source && visits?.find((row) => row.id === source.id);
  const visit: VisitView | undefined = observed
    ? {
        requests: observed.requests,
        cookies: observed.cookies,
        storage: observed.storage,
        domains: [
          ...new Set([
            ...observed.externalDomains,
            ...(observed.afterChoice?.externalDomains ?? []),
          ]),
        ],
        capped:
          observed.externalDomains.length >= 20 ||
          (observed.afterChoice?.externalDomains.length ?? 0) >= 20,
      }
    : counted
      ? { ...counted, domains: [], capped: counted.outside >= 20 }
      : undefined;

  return (
    <>
      <div className="contents" onClick={openCitation}>
        {children}
      </div>
      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSelection(null);
          }
        }}
      >
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog
            className={
              selection?.document ? "min-w-0 sm:max-w-[46rem]" : "min-w-0"
            }
          >
            <Modal.CloseTrigger aria-label="Close evidence" autoFocus />
            {selection && source && (
              <>
                <Modal.Header className="pe-8">
                  <p className="text-sm text-muted">
                    {selection.document
                      ? sourceUrl?.hostname + " · Saved passages"
                      : sourceLabel(source)}
                  </p>
                  <Modal.Heading
                    className={
                      selection.document
                        ? "text-xl font-semibold tracking-tight sm:text-2xl"
                        : undefined
                    }
                  >
                    {selection.document
                      ? documentTitle(documentSources)
                      : heading}
                  </Modal.Heading>
                </Modal.Header>
                <Modal.Body className="space-y-4">
                  {selection.group && selection.group.length > 1 && (
                    <div
                      className="flex flex-wrap gap-2"
                      role="group"
                      aria-label="Evidence for this statement"
                    >
                      {selection.group.map((entry, index) => (
                        <Button
                          key={entry.source.id}
                          size="sm"
                          variant={
                            source.id === entry.source.id
                              ? "secondary"
                              : "ghost"
                          }
                          aria-pressed={source.id === entry.source.id}
                          onPress={() =>
                            setSelection({
                              ...selection,
                              source: entry.source,
                              quote: entry.quote,
                              document: false,
                              readingCitation: false,
                            })
                          }
                        >
                          {index + 1}. {entry.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {selection.document ? (
                    <DocumentPassages
                      sources={documentSources}
                      quote={
                        selection.readingCitation ? selection.quote : undefined
                      }
                      tone={selection.tone}
                    />
                  ) : visit ? (
                    <VisitSummary
                      visit={visit}
                      notes={source.excerpt}
                      storage={storage}
                    />
                  ) : (
                    <blockquote
                      lang={source.language}
                      className="m-0 whitespace-pre-line text-sm leading-relaxed wrap-anywhere"
                    >
                      {source.excerpt.slice(0, start)}
                      <mark
                        className={`${highlightClass} ${selection.tone ?? ""}`}
                      >
                        {selection.quote}
                      </mark>
                      {source.excerpt.slice(start + selection.quote.length)}
                    </blockquote>
                  )}
                  <div className="grid gap-1 border-t border-separator pt-3 text-sm">
                    {storage && !visit && <p className="mb-2">{storage}</p>}
                    {!visit &&
                      (source.observation?.type === "browser_content_page" ||
                        source.observation?.type ===
                          "browser_consent_counts") &&
                      source.observation.externalDomains.length > 0 && (
                        <p className="mb-2 wrap-anywhere">
                          <strong>Outside domains in this visit</strong>{" "}
                          {source.observation.externalDomains.join(", ")}
                        </p>
                      )}
                    {source.observation?.type === "processing_document" && (
                      <div className="mb-2 grid gap-2">
                        <p>
                          These terms describe how the publisher processes data
                          for customers of its service.
                        </p>
                        {source.observation.referral && (
                          <>
                            <blockquote>
                              {source.observation.referral.excerpt}
                            </blockquote>
                            <a
                              className="inline-link w-fit"
                              href={source.observation.referral.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Website policy linking the provider
                            </a>
                          </>
                        )}
                      </div>
                    )}
                    {sourceUrl && !selection.document && (
                      <a
                        className="inline-link w-fit wrap-anywhere"
                        href={sourceUrl.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {sourceUrl.hostname + sourceUrl.pathname}
                      </a>
                    )}
                    <time
                      className="text-xs text-muted"
                      dateTime={source.retrievedAt}
                    >
                      Retrieved{" "}
                      {new Intl.DateTimeFormat("en", {
                        dateStyle: "medium",
                        timeZone: "UTC",
                      }).format(new Date(source.retrievedAt))}{" "}
                      UTC
                    </time>
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  {documentSources.length > 0 && !selection.document && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() =>
                        setSelection({
                          ...selection,
                          document: true,
                          readingCitation: true,
                        })
                      }
                    >
                      Read saved document
                    </Button>
                  )}
                  {selection.document && sourceUrl ? (
                    <a
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-default px-4 text-sm font-medium text-foreground"
                      href={sourceUrl.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open original document ↗
                    </a>
                  ) : (
                    <a
                      className="inline-link text-sm"
                      href={"#evidence-" + source.id}
                      onClick={() => setSelection(null)}
                    >
                      View evidence in report
                    </a>
                  )}
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}

type VisitView = {
  requests: number;
  cookies: number;
  storage?: { localEntries: number; sessionEntries: number };
  // Domain names are part of the advanced report; free readers get a count.
  domains: string[];
  outside?: number;
  capped: boolean;
};

function VisitSummary({
  visit,
  notes,
  storage,
}: {
  visit: VisitView;
  notes: string;
  storage?: string | null;
}) {
  const outside = visit.domains.length || visit.outside || 0;
  const stats: [string, string][] = [
    ["Requests", String(visit.requests)],
    ["Domains", outside + (visit.capped ? "+" : "")],
    ["Cookies", String(visit.cookies)],
    [
      "Storage",
      visit.storage
        ? String(visit.storage.localEntries + visit.storage.sessionEntries)
        : "–",
    ],
  ];
  return (
    <div className="grid gap-4">
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-default/60 px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="m-0 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-2 text-xs text-muted">
        Requests attempted, outside domains contacted, and cookies and web
        storage entries left at the end of the visit.
      </p>
      {visit.domains.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">Outside domains contacted</p>
          <ul className="m-0! flex list-none flex-wrap gap-1.5 p-0!">
            {visit.domains.map((domain) => (
              <li
                key={domain}
                className="rounded-full bg-default px-2.5 py-0.5 text-xs wrap-anywhere"
              >
                {domain}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">
          Full capture notes
        </summary>
        <p className="mt-2 whitespace-pre-line leading-relaxed text-muted wrap-anywhere">
          {notes}
        </p>
        {storage && (
          <p className="mt-2 leading-relaxed text-muted wrap-anywhere">
            {storage}
          </p>
        )}
      </details>
    </div>
  );
}
