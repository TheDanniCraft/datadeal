"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

type FundingChoices = {
  callbackQueue?: (() => void)[];
  showRevocationMessage?: () => void;
};

export function showGooglePrivacySettings() {
  const scope = window as Window & { googlefc?: FundingChoices };
  scope.googlefc = scope.googlefc || {};
  scope.googlefc.callbackQueue = scope.googlefc.callbackQueue || [];
  let shown = false;
  scope.googlefc.callbackQueue.push(() => {
    shown = true;
    scope.googlefc?.showRevocationMessage?.();
  });
  // Google only runs the queue where a consent message is published.
  window.setTimeout(() => {
    if (!shown) window.location.assign("/privacy#reports");
  }, 2000);
}

/**
 * Opens Google's consent message so the visitor can change their choice.
 * Without the AdSense tag it links to the privacy page, or renders nothing.
 */
export function PrivacySettingsLink({
  children = "Privacy settings",
  className,
  hideWithoutAds = false,
}: {
  children?: ReactNode;
  className?: string;
  hideWithoutAds?: boolean;
}) {
  const [ads, setAds] = useState(false);
  useEffect(() => {
    // The layout marks <html> when it loads the AdSense tag (non-Pro visitors).
    setAds(document.documentElement.dataset.ads === "adsense");
  }, []);
  if (!ads)
    return hideWithoutAds ? null : (
      <Link className={className} href="/privacy#reports">
        {children}
      </Link>
    );
  return (
    <button
      type="button"
      className={className ?? "cursor-pointer py-1 hover:underline"}
      onClick={showGooglePrivacySettings}
    >
      {children}
    </button>
  );
}
