"use client";

import { Button, Toast, toast } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useClientReady } from "../../use-client-ready";
import { ReportIcon } from "./report-icon";

export function RequestScan({
  domain,
  active,
  available,
  label,
  prominent,
  compact = false,
}: {
  domain: string;
  active: boolean;
  available: boolean;
  label: string;
  prominent: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const ready = useClientReady();
  if (active) return null;
  if (!available)
    return prominent ? (
      <p className="text-sm text-muted">
        The scan service is currently unavailable.
      </p>
    ) : null;
  return (
    <div
      className={
        compact ? "inline-flex" : "mt-2 grid justify-items-start gap-2"
      }
    >
      <Button
        className={
          compact ? "gap-1 px-2.5 text-xs [&_svg]:size-3.5" : undefined
        }
        variant="primary"
        size={compact ? "sm" : undefined}
        isDisabled={!ready || busy}
        onPress={async () => {
          setBusy(true);
          try {
            const response = await fetch("/api/v1/domains/" + domain, {
              method: "POST",
            });
            if (response.ok) {
              toast.success("Scan requested");
              router.refresh();
            } else {
              const { code } = await response.json().catch(() => ({}));
              const seconds = Number(response.headers.get("Retry-After"));
              const minutes = Math.ceil(seconds / 60);
              const hours = Math.ceil(seconds / 3600);
              const wait =
                minutes >= 60
                  ? `${hours} ${hours === 1 ? "hour" : "hours"}`
                  : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
              const reason =
                code === "domain_cooldown"
                  ? "A scan was requested for this site recently."
                  : code === "daily_limit"
                    ? "You’ve reached your daily scan limit."
                    : code === "hourly_limit"
                      ? "The hourly scan limit has been reached."
                      : code === "queue_full"
                        ? "The scan queue is full."
                        : code === "origin"
                          ? "This page’s address could not be verified. Reopen the report and try again."
                          : "The scan service is currently unavailable.";
              toast.warning(reason, {
                description:
                  Number.isSafeInteger(seconds) && seconds > 0
                    ? `Try again in about ${wait}.`
                    : undefined,
              });
            }
          } catch {
            toast.danger("Could not reach the scan service");
          } finally {
            setBusy(false);
          }
        }}
      >
        <ReportIcon name="rescan" /> {label}
      </Button>
    </div>
  );
}

export function ScanToastProvider() {
  return <Toast.Provider placement="top end" />;
}
