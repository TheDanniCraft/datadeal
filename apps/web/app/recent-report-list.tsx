"use client";

import Link from "next/link";
import { ItemCard } from "@heroui-pro/react/item-card";
import { Avatar } from "@heroui/react/avatar";
import { Chip } from "@heroui/react/chip";
import { noChoiceVisitLabel, scenarioLabel } from "@datadeal/contracts";
import { ReportIcon } from "./report/[domain]/report-icon";
import { bundledSiteFavicon } from "../lib/site-favicon";

export function RecentReportList({
  reports,
}: {
  reports: {
    domain: string;
    scanId: string;
    score: number | null;
    grade: string;
    headlineScenario: keyof typeof scenarioLabel;
    noChoiceVisit?: boolean;
    hasFavicon: boolean;
  }[];
}) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {reports.map(
        ({
          domain,
          score,
          grade,
          hasFavicon,
          headlineScenario,
          noChoiceVisit,
        }) => (
          <li key={domain}>
            <Link
              className="group block rounded-2xl"
              href={`/report/${domain}`}
            >
              <ItemCard className="min-h-16 px-4 group-hover:bg-surface-secondary">
                <ItemCard.Icon className="size-8 shrink-0 rounded-none! bg-transparent! p-0!">
                  <Avatar
                    size="sm"
                    aria-hidden="true"
                    className="size-8 rounded-none! bg-transparent!"
                  >
                    {(hasFavicon || bundledSiteFavicon(domain)) && (
                      <Avatar.Image
                        className="size-full rounded-none! object-contain!"
                        alt=""
                        src={
                          hasFavicon
                            ? `/api/v1/domains/${domain}/favicon`
                            : bundledSiteFavicon(domain)!
                        }
                      />
                    )}
                    <Avatar.Fallback className="bg-transparent! text-muted">
                      <ReportIcon name="globe" />
                    </Avatar.Fallback>
                  </Avatar>
                </ItemCard.Icon>
                <ItemCard.Content>
                  <ItemCard.Title className="break-all">
                    {domain}
                  </ItemCard.Title>
                  <ItemCard.Description>
                    {score === null
                      ? "Accept-all rating unavailable"
                      : noChoiceVisit
                        ? noChoiceVisitLabel
                        : scenarioLabel[headlineScenario]}
                  </ItemCard.Description>
                </ItemCard.Content>
                <ItemCard.Action>
                  <Chip
                    data-rating={grade.toLowerCase()}
                    className="h-auto rounded-lg bg-[color-mix(in_oklab,var(--rating)_12%,var(--surface))]! px-2.5 py-1 text-[var(--rating)]!"
                    aria-label={
                      score === null
                        ? "Unrated"
                        : `${score} out of 100, ${grade}`
                    }
                  >
                    <Chip.Label className="flex items-baseline gap-1.5 whitespace-nowrap">
                      {score !== null && (
                        <span className="tabular-nums">
                          <strong className="text-base leading-none">
                            {score}
                          </strong>
                          <span className="text-xs">/100</span>
                        </span>
                      )}
                      <span className="text-xs font-medium">{grade}</span>
                    </Chip.Label>
                  </Chip>
                </ItemCard.Action>
              </ItemCard>
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}
