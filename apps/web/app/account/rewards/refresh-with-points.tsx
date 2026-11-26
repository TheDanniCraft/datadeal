"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { domain, siteDomain } from "@datadeal/contracts";
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
  const parsed = siteDomain.safeParse(host);
  return (
    <section
      aria-labelledby="point-refresh"
      className="grid gap-4 rounded-2xl border border-separator p-5"
    >
      <div className="grid gap-1">
        <h2 id="point-refresh" className="m-0 text-lg font-semibold">
          Refresh a report
        </h2>
        <p className="m-0 text-sm leading-relaxed text-muted">
          Spend {cost} points on a new scan of a site that already has a report.
          If the scan finds nothing usable, you get the points back.
        </p>
      </div>
      <form
        className="grid gap-3"
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
          className="min-w-0"
        >
          <Label className="sr-only">Report domain</Label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              className="min-h-11"
              placeholder="example.com"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="submit"
              variant="secondary"
              className="min-h-11"
              isDisabled={busy || !parsed.success || balance < cost}
            >
              {busy ? "Requesting refresh…" : `Refresh for ${cost} points`}
            </Button>
          </div>
        </TextField>
        {(parsed.success || balance < cost || message) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {parsed.success && (
              <Link href={"/report/" + parsed.data} className="inline-link">
                Open the free report
              </Link>
            )}
            {balance < cost && (
              <span className="text-muted">You need {cost} points.</span>
            )}
            <span role="status">{message}</span>
          </div>
        )}
      </form>
    </section>
  );
}
