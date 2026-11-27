"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { publicPageCategory } from "../lib/umami";

/** Global Privacy Control or Do Not Track opts the visitor out of counting. */
function privacySignal() {
  const scope = navigator as Navigator & {
    globalPrivacyControl?: boolean;
    msDoNotTrack?: string;
  };
  const dnt =
    scope.doNotTrack ??
    scope.msDoNotTrack ??
    (window as Window & { doNotTrack?: string }).doNotTrack;
  return scope.globalPrivacyControl === true || dnt === "1" || dnt === "yes";
}

/**
 * Self-hosted, cookieless Umami: no cookies or local storage, so no consent
 * prompt. Only coarse public page types are counted.
 */
export function AudienceMeasurement({
  endpoint,
  websiteId,
}: {
  endpoint: string;
  websiteId: string;
}) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => setAllowed(!privacySignal()), []);
  const pathname = usePathname();
  const consentPeriod = useRef<AbortController | null>(null);
  const visit = useRef({ pathname: "", sent: false });

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    consentPeriod.current = controller;
    return () => {
      controller.abort();
      consentPeriod.current = null;
    };
  }, [allowed]);

  useEffect(() => {
    const url = publicPageCategory(pathname);
    if (visit.current.pathname !== pathname) {
      // Retain only the coarse page type in this history entry so a reload or
      // back navigation to the same entry isn't counted twice.
      const resumed =
        !visit.current.pathname &&
        url &&
        history.state?.dataDealMeasuredPage === url;
      visit.current = { pathname, sent: Boolean(resumed) };
    }
    const signal = consentPeriod.current?.signal;
    if (!allowed || !signal || !url || visit.current.sent) return;
    // A cancelled render or Strict Mode effect replay never emits a pageview.
    const timer = window.setTimeout(() => {
      if (signal.aborted) return;
      visit.current.sent = true;
      history.replaceState({ ...history.state, dataDealMeasuredPage: url }, "");
      void fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "event",
          payload: {
            website: websiteId,
            hostname: window.location.hostname,
            url,
          },
        }),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        cache: "no-store",
        signal,
      }).catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [allowed, endpoint, pathname, websiteId]);
  return null;
}
