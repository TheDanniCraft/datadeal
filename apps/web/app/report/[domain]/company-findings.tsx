"use client";

import { Accordion, Button } from "@heroui/react";
import { useState } from "react";
import type {
  CompanyFinding,
  CompanyPurpose,
} from "../../../lib/company-findings";

const purposeLabels: Record<CompanyPurpose, string> = {
  advertising: "Advertising",
  analytics: "Analytics",
  needed: "Needed for the site",
  unknown: "Unidentified",
};
const purposeTone: Record<CompanyPurpose, string> = {
  advertising: "bg-danger/12 text-danger",
  analytics: "bg-warning/15 text-warning",
  needed: "bg-success/12 text-success",
  unknown: "bg-default text-muted",
};
const timingLabels = {
  after_reject: "Even after you reject",
  before_choice: "Before you choose",
  after_accept: "After you accept",
  on_use: "When you use a feature",
} as const;
const expiryLabels = {
  within_day: "up to a day",
  within_month: "up to a month",
  within_year: "up to a year",
  over_year: "over a year",
} as const;
const fieldLabels = {
  email: "your email address",
  advertising_id: "an advertising ID",
  identifier: "an ID",
  page_url: "the pages you visit",
  event_name: "what you do on the page",
} as const;

function plural(count: number, word: string) {
  if (count === 1) return `1 ${word}`;
  return `${count} ${word.endsWith("y") ? word.slice(0, -1) + "ie" : word}s`;
}

function headline(company: CompanyFinding) {
  const sent = company.received;
  const stored = company.cookies + company.otherStorage;
  if (company.purpose === "needed")
    return stored
      ? "Stores " + plural(stored, "item") + " in your browser"
      : company.timing === "on_use"
        ? "Named in the privacy policy"
        : "Your browser connects to it";
  if (sent.includes("email")) return "Gets your email address";
  if (
    company.linkedIdentifier ||
    sent.includes("identifier") ||
    sent.includes("advertising_id")
  )
    return "Gets an ID that recognizes you";
  if (company.lastingIds) return "Stores an ID in your browser";
  if (sent.includes("page_url")) return "Sees which pages you visit";
  if (sent.includes("event_name")) return "Sees what you do";
  if (company.cookies || company.otherStorage)
    return (
      "Stores " +
      plural(company.cookies + company.otherStorage, "item") +
      " in your browser"
    );
  return company.timing === "on_use"
    ? "Named in the privacy policy"
    : "Your browser connects to it";
}

function costTone(cost: number) {
  if (cost >= 15) return "text-danger";
  if (cost >= 5) return "text-warning";
  return "text-muted";
}

function Monogram({ company }: { company: CompanyFinding }) {
  return (
    <span
      aria-hidden="true"
      className={
        "grid size-9 shrink-0 place-items-center rounded-xl text-sm font-semibold " +
        purposeTone[company.purpose]
      }
    >
      {company.name
        .replace(/^www\./, "")
        .charAt(0)
        .toUpperCase()}
    </span>
  );
}

function Details({
  company,
  evidence,
}: {
  company: CompanyFinding;
  evidence: ReadonlySet<string>;
}) {
  const stored = company.cookies + company.otherStorage;
  const visit = company.evidenceIds.find((id) => evidence.has(id));
  const rows: [string, string][] = [];
  if (stored)
    rows.push([
      "Stored in your browser",
      [
        company.cookies && plural(company.cookies, "cookie"),
        company.otherStorage && plural(company.otherStorage, "other item"),
      ]
        .filter(Boolean)
        .join(", ") +
        (company.longestExpiry
          ? `, kept ${expiryLabels[company.longestExpiry]}`
          : ""),
    ]);
  if (company.received.length)
    rows.push([
      "Receives",
      company.received
        .map((field) => fieldLabels[field])
        .join(", ")
        .replace(/^./, (c) => c.toUpperCase()),
    ]);
  rows.push(["When", timingLabels[company.timing]]);
  if (company.domains.length)
    rows.push(["Domains", company.domains.slice(0, 6).join(", ")]);
  return (
    <div className="grid gap-3 ps-12 pb-4 text-sm">
      <p className="m-0! leading-relaxed text-muted">{company.reason}</p>
      <dl className="m-0! grid gap-x-6 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="m-0 wrap-anywhere">{value}</dd>
          </div>
        ))}
      </dl>
      {(visit || company.citation) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {visit && (
            <a
              className="inline-link"
              href={"#evidence-" + visit}
              aria-haspopup="dialog"
            >
              Visit evidence
            </a>
          )}
          {company.citation && evidence.has(company.citation.evidenceId) && (
            <a
              className="inline-link"
              href={"#evidence-" + company.citation.evidenceId}
              data-citation-quote={company.citation.quote}
              aria-haspopup="dialog"
            >
              Policy passage
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function CompanyFindings({
  companies,
  evidenceIds,
}: {
  companies: CompanyFinding[];
  evidenceIds: readonly string[];
}) {
  const [filter, setFilter] = useState<CompanyPurpose | "all">("all");
  const [showAll, setShowAll] = useState(false);
  if (!companies.length) return null;
  const evidence = new Set(evidenceIds);
  const counts = new Map<CompanyPurpose, number>();
  for (const { purpose } of companies)
    counts.set(purpose, (counts.get(purpose) ?? 0) + 1);
  const filtered =
    filter === "all"
      ? companies
      : companies.filter(({ purpose }) => purpose === filter);
  const visible = showAll ? filtered : filtered.slice(0, 6);
  const tabs = [
    ["all", "All", companies.length] as const,
    ...(["advertising", "analytics", "unknown", "needed"] as const)
      .filter((purpose) => counts.get(purpose))
      .map(
        (purpose) =>
          [purpose, purposeLabels[purpose], counts.get(purpose)!] as const,
      ),
  ];
  return (
    <section className="mt-8 grid gap-3" aria-labelledby="companies-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="companies-title" className="m-0! text-xl! font-semibold!">
          Who gets your data
        </h2>
        <span className="text-sm text-muted">
          {plural(companies.length, "company")} after accepting all
        </span>
      </div>
      {tabs.length > 2 && (
        <div
          role="group"
          aria-label="Filter by purpose"
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
        >
          {tabs.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setShowAll(false);
              }}
              className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-separator px-3 text-sm text-muted transition-colors hover:text-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background focus-visible:outline-2 focus-visible:outline-focus"
            >
              {label}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-separator">
        <Accordion className="w-full" hideSeparator>
          {visible.map((company) => (
            <Accordion.Item
              key={company.key}
              id={company.key}
              className="border-b border-separator last:border-b-0"
            >
              <Accordion.Heading>
                <Accordion.Trigger className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 text-left hover:bg-default/50 sm:px-5">
                  <Monogram company={company} />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate font-medium">{company.name}</span>
                    <span className="text-xs leading-snug text-muted">
                      {purposeLabels[company.purpose]} · {headline(company)}
                      {company.purpose !== "needed" &&
                      (company.timing === "before_choice" ||
                        company.timing === "after_reject")
                        ? " · " + timingLabels[company.timing].toLowerCase()
                        : ""}
                    </span>
                  </span>
                  <span
                    className={
                      "text-sm font-semibold tabular-nums " +
                      costTone(company.cost)
                    }
                    aria-label={
                      company.cost
                        ? `Costs ${Math.round(company.cost)} points`
                        : "Costs no points"
                    }
                  >
                    {company.cost ? "−" + Math.round(company.cost) : "0"}
                  </span>
                  <Accordion.Indicator className="shrink-0" />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="px-4 sm:px-5">
                  <Details company={company} evidence={evidence} />
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </div>
      {filtered.length > 6 && (
        <Button
          size="sm"
          variant="ghost"
          className="justify-self-start"
          onPress={() => setShowAll(!showAll)}
        >
          {showAll ? "Show fewer" : `Show all ${filtered.length}`}
        </Button>
      )}
    </section>
  );
}
