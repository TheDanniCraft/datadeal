"use client";

import { useConsent, useExplicitChoice } from "@c15t/nextjs";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { publicPageCategory } from "../lib/umami";

export function AudienceMeasurement({
  endpoint,
  websiteId,
}: {
  endpoint: string;
  websiteId: string;
}) {
  const effective = useConsent("measurement");
  const choice = useExplicitChoice();
  const allowed = effective && choice?.categories.measurement?.value === true;
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
      // c15t reloads the page when a permission is revoked. Retain only the
      // coarse page type in this history entry so re-consent won't count it twice.
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
