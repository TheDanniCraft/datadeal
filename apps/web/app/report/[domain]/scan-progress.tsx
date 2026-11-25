"use client";

import { ChainOfThought } from "@heroui-pro/react/chain-of-thought";
import type { ScanStage, ScanState } from "@datadeal/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const stageLabel: Record<ScanState, string> = {
  requested: "Scan requested",
  queued: "Waiting for a worker",
  discovering: "Discovering source documents",
  fetching: "Worker is gathering evidence",
  rendering: "Measuring the browser visit",
  extracting: "Extracting document excerpts",
  technically_analyzing: "Analyzing browser observations",
  ai_analyzing: "Analyzing cited policy passages",
  scoring: "Calculating the rating",
  completed: "Report published",
  partially_completed: "Partial report published",
  failed: "Scan failed",
};

const phases: Record<ScanStage, string> = {
  homepage: "Homepage retrieval",
  sitemap: "Sitemap discovery",
  policy: "Policy retrieval",
  browser: "Browser measurement",
  analysis: "Policy analysis",
  publication: "Report publication",
};
export function ScanProgress({
  state,
  stages = [],
}: {
  state: ScanState;
  stages?: readonly ScanStage[];
}) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [router]);
  const latest = stages.at(-1);
  const currentLabel = latest ? phases[latest] : stageLabel[state];
  return (
    <ChainOfThought
      isExpanded={expanded}
      onExpandedChange={setExpanded}
      className="my-3 min-w-0"
    >
      <ChainOfThought.Trigger className="max-w-full whitespace-nowrap text-foreground">
        <span className="sr-only">Scan progress. </span>
        <span role="status" className="min-w-0 truncate">
          {currentLabel}
        </span>
      </ChainOfThought.Trigger>
      <ChainOfThought.Content>
        {expanded && (
          <ChainOfThought.Steps>
            <ChainOfThought.Step label="Request received">
              This domain has a scan request.
            </ChainOfThought.Step>
            {stages.length ? (
              stages.map((phase, index) => (
                <ChainOfThought.Step key={phase} label={phases[phase]}>
                  {index === stages.length - 1 ? "Current stage" : "Attempted"}
                </ChainOfThought.Step>
              ))
            ) : (
              <ChainOfThought.Step label="Current status">
                {stageLabel[state]}
              </ChainOfThought.Step>
            )}
          </ChainOfThought.Steps>
        )}
      </ChainOfThought.Content>
    </ChainOfThought>
  );
}
