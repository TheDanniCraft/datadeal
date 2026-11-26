"use client";

import { Button, Spinner, buttonVariants } from "@heroui/react";
import { ConsentDialogLink } from "@c15t/nextjs";
import { useState } from "react";
import { flightCap } from "@datadeal/contracts/paper-plane";
import { useAdvertisingConsent } from "../../../lib/ads/use-advertising-consent";
import { useRewardedAd } from "../../../lib/ads/rewarded-ad";
import { RewardModal } from "../../rewards/reward-modal";
import { ReportIcon } from "../../report/[domain]/report-icon";

/**
 * Earn report points without a report: every fully watched ad gives one
 * paper-plane flight.
 */
export function FlyForPoints() {
  const consent = useAdvertisingConsent();
  const [requested, setRequested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [intent, setIntent] = useState("");
  const [notice, setNotice] = useState("");
  const [rewardId, setRewardId] = useState<string | null>(null);
  const limited = consent === "limited";

  useRewardedAd(requested, limited, {
    onOpen: () => setNotice(""),
    onGranted: () => void complete(intent),
    onStop: (message) => {
      setNotice(message);
      setRequested(false);
    },
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
      setNotice("");
    } catch {
      setNotice("Your ad is complete, but the flight could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function start() {
    setRewardId(null);
    setNotice("");
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
      setNotice("A flight could not be reserved. Try again.");
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
          away for 1–{flightCap} points, or miss and get nothing.
        </p>
      </div>
      {consent === "allowed" || consent === "limited" ? (
        <Button
          className="min-h-11 gap-2"
          isDisabled={busy}
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
      ) : (
        <ConsentDialogLink
          className={buttonVariants({
            variant: "secondary",
            className: "min-h-11",
          })}
        >
          Review advertising consent
        </ConsentDialogLink>
      )}
      {notice && (
        <p role="status" className="m-0 text-sm sm:col-span-2">
          {notice}
        </p>
      )}
      <RewardModal
        rewardId={rewardId}
        signedIn
        onClose={() => {
          setRewardId(null);
          window.location.reload();
        }}
        onReplay={() => {
          setRewardId(null);
          void start();
        }}
      />
    </section>
  );
}
