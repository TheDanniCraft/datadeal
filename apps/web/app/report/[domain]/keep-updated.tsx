"use client";

import { Button, Popover, Spinner } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { monitorDailyCost } from "@datadeal/contracts/paper-plane";

/**
 * "Keep me updated": points pay each day for a weekly rescan of the site,
 * and every new report of it stays open for this account.
 */
export function KeepUpdated({
  host,
  monitoring,
  balance,
}: {
  host: string;
  monitoring: boolean;
  balance: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const change = async (monitor: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: host, monitor }),
      });
      const { code } = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      if (code === "monitoring" || code === "stopped") {
        setOpen(false);
        router.refresh();
      } else
        setMessage(
          code === "insufficient"
            ? "Your balance is too low."
            : "Could not change this. Try again.",
        );
    } catch {
      setMessage("Could not reach DataDeal. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="ghost"
        className={
          "gap-1.5 [&_svg]:size-4" + (monitoring ? " text-accent" : "")
        }
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="fill-none stroke-current"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 17h16l-2-3v-4a6 6 0 0 0-12 0v4z M10 20a2 2 0 0 0 4 0" />
        </svg>
        {monitoring ? "Updating" : "Keep updated"}
      </Button>
      <Popover.Content placement="bottom end" className="w-80 max-w-[90vw]">
        <Popover.Dialog
          aria-label="Keep this report updated"
          className="grid gap-3 p-4 text-sm"
        >
          <p className="m-0 font-semibold">
            {monitoring ? `You keep ${host} updated` : `Keep ${host} updated`}
          </p>
          <p className="m-0 leading-relaxed text-muted">
            DataDeal rescans the site every week, and each new report stays open
            for you. It costs {monitorDailyCost} points a day and stops on its
            own when your points run out.
          </p>
          {monitoring ? (
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy}
              onPress={() => void change(false)}
            >
              Stop updates
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-2"
              isDisabled={busy || balance < monitorDailyCost}
              onPress={() => void change(true)}
            >
              {busy && <Spinner size="sm" color="current" aria-hidden="true" />}
              Start for {monitorDailyCost} points a day
            </Button>
          )}
          {!monitoring && (
            <p className="m-0 text-xs text-muted">You have {balance} points.</p>
          )}
          {message && (
            <p role="status" className="m-0 text-xs text-danger">
              {message}
            </p>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
