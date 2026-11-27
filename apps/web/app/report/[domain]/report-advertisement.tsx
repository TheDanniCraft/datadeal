"use client";

import { Button } from "@heroui/react";
import Link from "next/link";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { adsenseClient } from "../../../lib/ads/adsense";
import {
  mountGoogleDisplayAd,
  type DisplayAdFailure,
} from "../../../lib/ads/google-display";
import { useTcfConsent } from "../../../lib/ads/use-tcf-consent";

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

type Format = "banner" | "rail";

/** The labelled frame shared by AdSense units and local sample units. */
function AdFrame({
  format,
  side,
  children,
}: {
  format: Format;
  side?: "left" | "right";
  children: ReactNode;
}) {
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
        <div className="mt-1 min-h-[600px]">{children}</div>
      </aside>
    );
  return (
    <aside className="my-6" aria-label="Advertisement">
      <small className="text-sm text-muted">Advertisement</small>
      <div className="mt-1 flex justify-center">{children}</div>
    </aside>
  );
}

type AdsByGoogle = { push(options: object): void };

/** One responsive AdSense unit. Google's consent message decides what it may show. */
function AdSenseSlot({
  slot,
  format,
  side,
}: {
  slot: string;
  format: Format;
  side?: "left" | "right";
}) {
  const unit = useRef<HTMLModElement>(null);
  const [state, setState] = useState<"shown" | "unfilled" | "blocked">("shown");
  useEffect(() => {
    const element = unit.current;
    if (!element) return;
    // A hidden rail (narrow screen) has no width for AdSense to fill.
    if (!element.offsetWidth) {
      setState("unfilled");
      return;
    }
    // Strict Mode replays effects on the same element: request it once.
    if (!element.dataset.datadealRequested) {
      element.dataset.datadealRequested = "1";
      try {
        const scope = window as Window & { adsbygoogle?: AdsByGoogle };
        (scope.adsbygoogle = scope.adsbygoogle || ([] as AdsByGoogle)).push({});
      } catch {
        setState("unfilled");
        return;
      }
    }
    const check = () => {
      if (element.dataset.adStatus === "unfilled") setState("unfilled");
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(element, {
      attributes: true,
      attributeFilter: ["data-ad-status"],
    });
    // adsbygoogle.js marks every unit it processes; none means it was blocked.
    const deadline = window.setTimeout(() => {
      if (!element.dataset.adsbygoogleStatus) setState("blocked");
    }, 6000);
    return () => {
      observer.disconnect();
      window.clearTimeout(deadline);
    };
  }, []);
  if (state === "blocked")
    return format === "banner" ? <FundingNotice /> : null;
  if (state === "unfilled") return null;
  return (
    <AdFrame format={format} side={side}>
      <ins
        ref={unit}
        className="adsbygoogle w-full"
        style={{ display: "block" }}
        data-ad-client={adsenseClient}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </AdFrame>
  );
}

/** Google's sample GPT unit, for local development only. */
function SampleSlot({
  path,
  format,
  side,
}: {
  path: string;
  format: Format;
  side?: "left" | "right";
}) {
  const id = "gpt-" + useId();
  const slot = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<DisplayAdFailure>();
  useLayoutEffect(() => {
    if (!failure && slot.current)
      return mountGoogleDisplayAd(slot.current, path, setFailure, format);
  }, [path, failure, format]);

  if (failure)
    return failure === "load_failed" && format === "banner" ? (
      <FundingNotice />
    ) : null;
  return (
    <AdFrame format={format} side={side}>
      <div id={id} ref={slot} className="w-full" />
    </AdFrame>
  );
}

function SampleAdvertisement(props: {
  path: string;
  format: Format;
  side?: "left" | "right";
}) {
  return useTcfConsent() === "allowed" ? <SampleSlot {...props} /> : null;
}

export function ReportAdvertisement({
  slot,
  samplePath,
  format = "banner",
  side,
}: {
  /** AdSense ad unit id. Without one nothing renders. */
  slot?: string;
  /** Google's sample GPT unit (local development only). */
  samplePath?: string;
  format?: Format;
  side?: "left" | "right";
}) {
  if (samplePath)
    return (
      <SampleAdvertisement path={samplePath} format={format} side={side} />
    );
  return slot ? <AdSenseSlot slot={slot} format={format} side={side} /> : null;
}
