"use client";

import { useEffect, useState } from "react";

type TcData = {
  eventStatus?: "tcloaded" | "cmpuishown" | "useractioncomplete";
  gdprApplies?: boolean;
  listenerId?: number;
  purpose?: { consents?: Record<string, boolean | undefined> };
};
type TcfApi = (
  command: string,
  version: number,
  callback: (data: TcData, success: boolean) => void,
  parameter?: unknown,
) => void;

export type TcfConsent = "pending" | "allowed" | "denied";

function decide(data: TcData): TcfConsent {
  if (data.gdprApplies === false) return "allowed";
  // Purpose 1: store and/or access information on a device.
  return data.purpose?.consents?.["1"] ? "allowed" : "denied";
}

/**
 * Reads the visitor's choice from Google's certified consent message through
 * the IAB TCF API. Without a CMP (local development) ads are allowed.
 */
export function useTcfConsent(): TcfConsent {
  const [consent, setConsent] = useState<TcfConsent>("pending");
  useEffect(() => {
    const scope = window as Window & { __tcfapi?: TcfApi };
    let listenerId: number | undefined;
    let active = true;
    let attempts = 0;
    let timer: number | undefined;
    const listen = (api: TcfApi) =>
      api("addEventListener", 2, (data, success) => {
        if (!active || !success) return;
        listenerId = data.listenerId;
        if (data.eventStatus === "cmpuishown") setConsent("pending");
        else if (
          data.eventStatus === "tcloaded" ||
          data.eventStatus === "useractioncomplete"
        )
          setConsent(decide(data));
      });
    // The CMP arrives with the async AdSense tag; wait briefly for it.
    const find = () => {
      if (!active) return;
      if (typeof scope.__tcfapi === "function") return listen(scope.__tcfapi);
      if (++attempts < 8) timer = window.setTimeout(find, 250);
      else
        setConsent(
          process.env.NODE_ENV === "development" ? "allowed" : "denied",
        );
    };
    find();
    return () => {
      active = false;
      window.clearTimeout(timer);
      if (listenerId !== undefined && typeof scope.__tcfapi === "function")
        scope.__tcfapi("removeEventListener", 2, () => {}, listenerId);
    };
  }, []);
  return consent;
}
