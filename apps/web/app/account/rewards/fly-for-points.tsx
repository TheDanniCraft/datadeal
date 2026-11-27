"use client";

import { Button, Spinner, buttonVariants, toast } from "@heroui/react";
import { useState } from "react";
import { flightCap } from "@datadeal/contracts/paper-plane";
import { useTcfConsent } from "../../../lib/ads/use-tcf-consent";
import { PrivacySettingsLink } from "../../../lib/ads/privacy-settings";
import { useRewardedAd } from "../../../lib/ads/rewarded-ad";
import { RewardModal } from "../../rewards/reward-modal";
import { ReportIcon } from "../../report/[domain]/report-icon";

/**
 * Earn points without a report: every fully watched ad gives one
 * paper-plane flight.
 */
export function FlyForPoints({ freeFlights }: { freeFlights: string[] }) {
  const consent = useTcfConsent();
  // Flights already earned (e.g. chosen after an ad on a report) fly free.
  const [played, setPlayed] = useState(0);
  const remaining = freeFlights.slice(played);
  const flyFree = () => {
    const next = remaining[0];
    if (!next) return;
    setPlayed((count) => count + 1);
    setRewardId(next);
  };
  const [requested, setRequested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [intent, setIntent] = useState("");
  const [rewardId, setRewardId] = useState<string | null>(null);

  useRewardedAd(requested, {
    onOpen: () => {},
    onGranted: () => void complete(intent),
    onStop: () => setRequested(false),
  });

  async function complete(id: string) {
    setRequested(false);
    setSaving(true);
    try {
      const response = await fetch("/api/v1/rewards/local-sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completionId: id }),
      });
      if (!response.ok) throw Error();
      setRewardId((await response.json()).id);
    } catch {
      toast.danger("Flight not saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function start() {
    setRewardId(null);
    setSaving(true);
    try {
      const response = await fetch("/api/v1/rewards/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reserveFlight" }),
      });
      if (!response.ok) throw Error();
      setIntent((await response.json()).id);
      setRequested(true);
    } catch {
      toast.danger("Flight not reserved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const busy = requested || saving;
  return (
    <section
      id="fly"
      aria-labelledby="fly-title"
      className="grid scroll-mt-24 gap-3 rounded-2xl border border-separator p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
    >
      <div className="grid gap-1">
        <h2 id="fly-title" className="m-0 text-lg font-semibold">
          Fly for points
        </h2>
        <p className="m-0 text-sm leading-relaxed text-muted">
          Watch a short ad, then fly the paper plane. Collect before it flies
          away for{" "}
          <span className="whitespace-nowrap">1–{flightCap} points</span>, or
          miss and get nothing.
        </p>
        {remaining.length > 0 && (
          <p className="m-0 text-sm font-medium text-accent">
            {remaining.length === 1
              ? "You have 1 free flight."
              : `You have ${remaining.length} free flights.`}
          </p>
        )}
      </div>
      {remaining.length > 0 ? (
        <Button className="min-h-11 gap-2" onPress={flyFree}>
          <ReportIcon name="play" />
          Fly for free
        </Button>
      ) : consent === "denied" ? (
        <PrivacySettingsLink
          className={buttonVariants({
            variant: "secondary",
            className: "min-h-11",
          })}
        >
          Review advertising consent
        </PrivacySettingsLink>
      ) : (
        <Button
          className="min-h-11 gap-2"
          isDisabled={busy || consent === "pending"}
          onPress={() => void start()}
        >
          {busy ? (
            <Spinner size="sm" color="current" aria-hidden="true" />
          ) : (
            <ReportIcon name="play" />
          )}
          {saving
            ? "One moment…"
            : requested
              ? "Loading video…"
              : "Watch an ad to fly"}
        </Button>
      )}
      <RewardModal
        rewardId={rewardId}
        signedIn
        standalone
        onClose={() => {
          setRewardId(null);
          window.location.reload();
        }}
        replayLabel={
          remaining.length > 0
            ? `Fly again for free (${remaining.length} left)`
            : undefined
        }
        onReplay={() => {
          setRewardId(null);
          if (remaining.length > 0) flyFree();
          else void start();
        }}
      />
    </section>
  );
}
