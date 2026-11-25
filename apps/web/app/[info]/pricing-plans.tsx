"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonVariants } from "@heroui/styles/components/button";

type Billing = "monthly" | "yearly";

function Check() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="mt-1 size-4 shrink-0 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

function Features({ items }: { items: readonly string[] }) {
  return (
    <ul className="m-0! grid list-none gap-2.5 p-0! text-sm">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <Check />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function PricingPlans({
  free,
  monthly,
  yearly,
  yearlyPerMonth,
  savingPercent,
  checkoutHref,
}: {
  free: string;
  monthly: string;
  yearly: string;
  yearlyPerMonth: string;
  savingPercent: number;
  checkoutHref: string | null;
}) {
  const [billing, setBilling] = useState<Billing>("yearly");
  const yearlySelected = billing === "yearly";
  return (
    <div className="grid gap-8">
      <div
        role="group"
        aria-label="Billing period"
        className="mx-auto inline-flex rounded-full bg-default p-1 text-sm"
      >
        {(
          [
            ["monthly", "Monthly"],
            ["yearly", "Yearly"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={billing === value}
            onClick={() => setBilling(value)}
            className="flex min-h-9 items-center gap-2 rounded-full px-4 font-medium text-muted transition-colors aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-sm focus-visible:outline-2 focus-visible:outline-focus"
          >
            {label}
            {value === "yearly" && savingPercent > 0 && (
              <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
                −{savingPercent}%
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mx-auto grid w-full max-w-4xl gap-4 md:grid-cols-2">
        <section
          aria-labelledby="plan-free"
          className="flex flex-col gap-6 rounded-3xl border border-separator bg-surface p-6 md:p-8"
        >
          <div className="grid gap-1">
            <h2 id="plan-free" className="m-0! text-lg font-semibold">
              Free
            </h2>
            <p className="m-0! text-sm text-muted">
              The rating and the evidence behind it.
            </p>
          </div>
          <p className="m-0! flex items-baseline gap-1.5">
            <strong className="text-5xl font-semibold tracking-tight">
              {free}
            </strong>
            <span className="text-sm text-muted">forever</span>
          </p>
          <Link
            className={buttonVariants({
              variant: "secondary",
              className: "w-full",
            })}
            href="/"
          >
            Check a website
          </Link>
          <Features
            items={[
              "Privacy rating and verdict",
              "Key findings with linked sources",
              "Browser extension for quick checks",
            ]}
          />
        </section>

        <section
          aria-labelledby="plan-pro"
          className="relative flex flex-col gap-6 rounded-3xl border border-accent/40 bg-linear-to-b from-accent-soft to-surface p-6 shadow-sm md:p-8"
        >
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-3">
              <h2 id="plan-pro" className="m-0! text-lg font-semibold">
                DataDeal Pro
              </h2>
              {yearlySelected && savingPercent > 0 && (
                <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                  Best value
                </span>
              )}
            </div>
            <p className="m-0! text-sm text-muted">
              Every advanced report, without ads.
            </p>
          </div>
          <div className="grid gap-1">
            <p className="m-0! flex items-baseline gap-1.5">
              <strong className="text-5xl font-semibold tracking-tight tabular-nums">
                {yearlySelected ? yearlyPerMonth : monthly}
              </strong>
              <span className="text-sm text-muted">/ month</span>
            </p>
            <p className="m-0! text-sm text-muted">
              {yearlySelected
                ? `${yearly} billed yearly`
                : "Billed monthly, cancel anytime"}
            </p>
          </div>
          {checkoutHref ? (
            <Link
              className={buttonVariants({
                variant: "primary",
                className: "w-full",
              })}
              href={checkoutHref}
            >
              Get Pro
            </Link>
          ) : (
            <p className="m-0! rounded-xl bg-default px-3 py-2.5 text-center text-sm text-muted">
              Pro is not available right now.
            </p>
          )}
          <Features
            items={[
              "Everything in Free",
              "Every advanced report",
              "Interactive data flows",
              "Scan history and policy changes",
              "Ad-free browsing",
            ]}
          />
        </section>
      </div>
    </div>
  );
}
