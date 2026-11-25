"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { domain } from "@datadeal/contracts";
import { defaultRefreshPointCost } from "@datadeal/contracts/paper-plane";
import { Button, Input, Label, TextField } from "@heroui/react";

const cost = defaultRefreshPointCost;
const messages: Record<string, string> = {
  accepted: "Refresh queued.",
  refunded:
    "This scan produced no usable evidence. Its points have been returned.",
  scan_in_progress:
    "A scan is already running. Your points are still available.",
  domain_cooldown:
    "This report was scanned recently. Try again after its cooldown.",
  insufficient_points: "Your balance is too low for this refresh.",
  no_report: "There is no published report to refresh for this domain.",
  daily_limit: "You’ve reached your daily scan limit.",
  hourly_limit: "The hourly scan limit has been reached.",
  queue_full: "The scan queue is full. Try again later.",
  unauthorized: "Sign in to use report points.",
};

export function RefreshWithPoints({ balance }: { balance: number }) {
  const router = useRouter();
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<{ host: string; id: string } | null>(null);
  const parsed = domain.safeParse(host);
  return (
    <section aria-labelledby="point-refresh" className="space-y-3">
      <h2 id="point-refresh" className="text-xl">
        Refresh a report
      </h2>
      <p className="text-sm">
        Spend {cost} report points to request a new scan of an existing report.
        The regular Rescan button is free. Both use the same queue and cooldown.
        If the scan fails to produce usable evidence, your points are returned.
      </p>
      <form
        className="grid max-w-md gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !parsed.success) return;
          if (pending.current?.host !== parsed.data)
            pending.current = { host: parsed.data, id: crypto.randomUUID() };
          const attempt = pending.current;
          setBusy(true);
          setMessage("");
          try {
            const response = await fetch("/api/v1/rewards/refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                domain: attempt.host,
                requestId: attempt.id,
                spendPoints: true,
              }),
            });
            const result = await response.json();
            if (response.status >= 500) throw new Error();
            pending.current = null;
            setMessage(messages[result.code] ?? "This refresh is unavailable.");
            if (result.code === "accepted" || result.code === "refunded")
              router.refresh();
          } catch {
            setMessage(
              "Couldn’t confirm this refresh. Retry to check the same request.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField
          isRequired
          value={host}
          onChange={(value) => {
            setHost(value);
            setMessage("");
          }}
          isDisabled={busy}
        >
          <Label>Report domain</Label>
          <Input
            placeholder="example.com"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
          />
        </TextField>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="secondary"
            isDisabled={busy || !parsed.success || balance < cost}
          >
            {busy ? "Requesting refresh…" : `Refresh for ${cost} points`}
          </Button>
          {parsed.success && (
            <Link
              href={"/report/" + parsed.data}
              className="inline-link text-sm"
            >
              Open free report
            </Link>
          )}
        </div>
        {balance < cost && (
          <p className="text-sm text-muted">
            This refresh requires {cost} points.
          </p>
        )}
        <p role="status" className="text-sm">
          {message}
        </p>
      </form>
    </section>
  );
}
