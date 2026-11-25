"use client";

import { Tooltip } from "@heroui/react";
import type { ReportSignals } from "@datadeal/scoring";
import { isEuropean } from "@datadeal/contracts";
import { ReportIcon } from "./report-icon";

type Signal = {
  key: string;
  icon?: Parameters<typeof ReportIcon>[0]["name"];
  label: string;
  tone: string;
  text?: string;
};

// One neutral style: the icon and its tooltip carry the meaning, not colour.
const neutral = "text-foreground";
const tones = { neutral, good: neutral, warn: neutral, bad: neutral };

export function signalList(signals: ReportSignals): Signal[] {
  const list: Signal[] = [
    signals.scenario === "accepted"
      ? {
          key: "scenario",
          icon: "cookie",
          label: "Rated after accepting all cookies",
          tone: tones.neutral,
        }
      : signals.scenario === "before_choice"
        ? {
            key: "scenario",
            icon: "hourglass",
            label:
              "Rated before any cookie choice: Accept all couldn't be tested",
            tone: tones.neutral,
          }
        : {
            key: "scenario",
            icon: "cookieOff",
            label: "No cookie choice offered; rated as every visitor sees it",
            tone: tones.neutral,
          },
  ];
  if (signals.noPolicy)
    list.push({
      key: "policy",
      icon: "noPolicy",
      label: "No privacy policy found",
      tone: tones.bad,
    });
  if (signals.beforeChoice)
    list.push({
      key: "before",
      icon: "eye",
      label: "Tracking starts before you choose",
      tone: tones.warn,
    });
  if (signals.advertising)
    list.push({
      key: "ads",
      icon: "target",
      label: "Advertising or profiling IDs",
      tone: tones.bad,
    });
  if (signals.host) {
    const european = isEuropean(signals.host.country);
    list.push({
      key: "host",
      // Just the region as text: EU, or the country code outside Europe.
      text: european ? "EU" : signals.host.country || "?",
      label:
        `Hosted by ${signals.host.name}` +
        (signals.host.country ? ` (${signals.host.country})` : "") +
        (european ? ", in Europe" : ", outside the EU"),
      tone: european ? tones.good : tones.warn,
    });
  }
  if (signals.outsideEu && !(signals.host && !isEuropean(signals.host.country)))
    list.push({
      key: "outside",
      icon: "globe",
      label: "Data goes to companies outside the EU",
      tone: tones.warn,
    });
  return list;
}

function Badge({ signal }: { signal: Signal }) {
  return (
    <span
      className={
        "inline-flex h-5 items-center gap-0.5 text-[.68rem] font-semibold [&_svg]:size-4 " +
        signal.tone
      }
    >
      {signal.icon && <ReportIcon name={signal.icon} />}
      {signal.text}
    </span>
  );
}

/**
 * Icons with a tooltip each. `plain` skips the tooltip (for use inside a
 * link, where a second focus stop would be wrong) and relies on the title
 * and the visually hidden text instead.
 */
export function ReportSignalIcons({
  signals,
  plain = false,
  className = "",
}: {
  signals: ReportSignals;
  plain?: boolean;
  className?: string;
}) {
  const list = signalList(signals);
  return (
    <ul
      className={"m-0! flex list-none flex-wrap gap-2.5 p-0! " + className}
      aria-label="Report highlights"
    >
      {list.map((signal) =>
        plain ? (
          <li key={signal.key} title={signal.label}>
            <Badge signal={signal} />
            <span className="sr-only">{signal.label}</span>
          </li>
        ) : (
          <li key={signal.key}>
            <Tooltip delay={150} closeDelay={100}>
              <Tooltip.Trigger
                aria-label={signal.label}
                className="rounded-md focus-visible:outline-2 focus-visible:outline-focus"
              >
                <Badge signal={signal} />
              </Tooltip.Trigger>
              <Tooltip.Content showArrow>
                <Tooltip.Arrow />
                <p className="text-xs">{signal.label}</p>
              </Tooltip.Content>
            </Tooltip>
          </li>
        ),
      )}
    </ul>
  );
}
