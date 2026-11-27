"use client";

import { Button, Spinner } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { queueBoostCost } from "@datadeal/contracts/paper-plane";

/** Spend points (or a Pro free boost) to move a waiting scan to the front of the queue. */
export function BoostScan({
  scanId,
  balance,
  freeLeft = 0,
}: {
  scanId: string;
  balance: number;
  /** Pro's free boosts left this month. */
  freeLeft?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const affordable = freeLeft > 0 || balance >= queueBoostCost;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        size="sm"
        variant="secondary"
        className="gap-1.5"
        isDisabled={busy || !affordable}
        onPress={async () => {
          setBusy(true);
          setMessage("");
          try {
            const response = await fetch("/api/v1/rewards/boost", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scanId }),
            });
            const { code } = (await response.json().catch(() => ({}))) as {
              code?: string;
            };
            if (code === "boosted" || code === "already_boosted")
              router.refresh();
            else
              setMessage(
                code === "insufficient"
                  ? "Your balance is too low."
                  : "This scan has already started.",
              );
          } catch {
            setMessage("Could not reach DataDeal. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner size="sm" color="current" aria-hidden="true" />}
        {freeLeft > 0
          ? `Skip the line, free (${freeLeft} left this month)`
          : `Skip the line for ${queueBoostCost} points`}
      </Button>
      {!affordable && (
        <span className="text-xs text-muted">You have {balance} points.</span>
      )}
      {message && (
        <span role="status" className="text-xs text-danger">
          {message}
        </span>
      )}
    </span>
  );
}
