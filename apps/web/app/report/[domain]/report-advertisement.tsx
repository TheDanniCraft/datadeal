"use client";

import { useAdvertisingConsent } from "../../../lib/ads/use-advertising-consent";
import { Button } from "@heroui/react";
import Link from "next/link";
import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  mountGoogleDisplayAd,
  type DisplayAdFailure,
} from "../../../lib/ads/google-display";

const dismissalKey = "datadeal-ad-notice-dismissed";

function FundingNotice() {
  const [visible, setVisible] = useState(false);
  const title = useId();
  useLayoutEffect(() => {
    try {
      setVisible(sessionStorage.getItem(dismissalKey) !== "1");
    } catch {
      setVisible(true);
    }
  }, []);
  function dismiss() {
    setVisible(false);
    try {
      sessionStorage.setItem(dismissalKey, "1");
    } catch {
      /* Storage can be disabled. */
    }
  }
  if (!visible) return null;
  return (
    <dialog
      open
      aria-modal="false"
      aria-labelledby={title}
      onKeyDown={(event) => {
        if (event.key === "Escape") dismiss();
      }}
      className="fixed inset-auto end-3 bottom-3 z-40 m-0 w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl bg-surface p-5 text-sm text-foreground shadow-lg ring-1 ring-border sm:end-6 sm:bottom-6"
    >
      <h2 id={title} className="mb-1 text-base! font-semibold!">
        Help fund the next scan
      </h2>
      <p className="m-0 leading-relaxed">
        The ad could not load. If you use an ad blocker, you can allow DataDeal
        to help cover browser scans and analysis. The free report is still
        available.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link
          className="inline-link"
          href="/advertising-disclosure#browser-privacy"
        >
          Ad settings
        </Link>
        <Link className="inline-link" href="/pricing">
          Ad-free Pro
        </Link>
        <Button size="sm" variant="secondary" onPress={dismiss}>
          Close
        </Button>
      </div>
    </dialog>
  );
}

function DisplaySlot({
  path,
  testAd,
  limited,
  format,
  side,
}: {
  path: string;
  testAd: boolean;
  limited: boolean;
  format: "banner" | "rail";
  side?: "left" | "right";
}) {
  const id = "gpt-" + useId();
  const slot = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<DisplayAdFailure>();
  useLayoutEffect(() => {
    if (!failure && slot.current)
      return mountGoogleDisplayAd(
        slot.current,
        path,
        setFailure,
        testAd,
        limited,
        format,
      );
  }, [path, failure, testAd, limited, format]);

  if (failure)
    return failure === "load_failed" && format === "banner" ? (
      <FundingNotice />
    ) : null;
  if (format === "rail")
    // Only on wide screens, outside the 50rem report column.
    return (
      <aside
        aria-label="Advertisement"
        className={
          "fixed top-24 hidden w-[160px] min-[1280px]:block " +
          (side === "left"
            ? "left-[calc(50%-25rem-160px-2rem)]"
            : "right-[calc(50%-25rem-160px-2rem)]")
        }
      >
        <small className="text-xs text-muted">Advertisement</small>
        <div id={id} ref={slot} className="mt-1 min-h-[600px]" />
      </aside>
    );
  return (
    <aside className="my-6" aria-label="Advertisement">
      <small className="text-sm text-muted">Advertisement</small>
      <div id={id} ref={slot} className="mt-1 flex justify-center" />
    </aside>
  );
}

export function ReportAdvertisement({
  path,
  limitedPath,
  testAd = false,
  format = "banner",
  side,
}: {
  path?: string;
  limitedPath?: string;
  testAd?: boolean;
  format?: "banner" | "rail";
  side?: "left" | "right";
}) {
  const consent = useAdvertisingConsent();
  const limited = consent === "limited";
  const unit = limited ? limitedPath : consent === "allowed" ? path : undefined;
  return unit ? (
    <DisplaySlot
      key={unit + (limited ? "-limited" : "")}
      path={unit}
      testAd={testAd}
      limited={limited}
      format={format}
      side={side}
    />
  ) : null;
}
