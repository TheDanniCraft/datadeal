"use client";

import { toast } from "@heroui/react";
import { useEffect, useRef } from "react";
import { publisherScript } from "./publisher-tag";

type RewardedSlot = { addService(service: unknown): void };
type Events = {
  rewardedSlotReady: { slot: RewardedSlot; makeRewardedVisible(): boolean };
  rewardedSlotGranted: { slot: RewardedSlot };
  rewardedSlotClosed: { slot: RewardedSlot };
  slotRenderEnded: { slot: RewardedSlot; isEmpty: boolean };
  slotRequested: { slot: RewardedSlot };
  slotResponseReceived: { slot: RewardedSlot };
};
type Publisher = {
  addEventListener<K extends keyof Events>(
    name: K,
    listener: (event: Events[K]) => void,
  ): void;
  removeEventListener<K extends keyof Events>(
    name: K,
    listener: (event: Events[K]) => void,
  ): void;
};
type GoogleTag = {
  cmd: { push(callback: () => void): void };
  enums: { OutOfPageFormat: { REWARDED: number } };
  defineOutOfPageSlot(path: string, format: number): RewardedSlot | null;
  destroySlots(slots: RewardedSlot[]): void;
  pubads(): Publisher;
  enableServices(): void;
  display(slot: RewardedSlot): void;
};

export type RewardedAdHandlers = {
  /** The ad is on screen. */
  onOpen(): void;
  /** The ad was watched to the end and closed: grant the reward. */
  onGranted(): void;
  /**
   * No reward: blocked, no inventory, or closed early. The hook already told
   * the visitor with a short toast; `noInventory` hides the ad button.
   */
  onStop(message: string, noInventory: boolean): void;
};

/** Short, one-line reasons an ad ended without a reward. */
const stops = {
  blocked: {
    title: "Ad blocked by your browser.",
    description: "Allow ads for this site to continue.",
    tone: "warning",
  },
  empty: { title: "No ad available right now.", tone: "warning" },
  closed: { title: "Ad closed before the end.", tone: "warning" },
  failed: { title: "The ad could not load. Try again.", tone: "danger" },
  unsupported: {
    title: "Ads are not available in this browser.",
    tone: "warning",
  },
} as const;
type Stop = keyof typeof stops;

function announce(reason: Stop) {
  const stop: { title: string; description?: string; tone: string } =
    stops[reason];
  const show = stop.tone === "danger" ? toast.danger : toast.warning;
  show(stop.title, { description: stop.description });
  return stop.title;
}

/**
 * Shows one Google rewarded ad while `requested` is true and reports how it
 * ended. A reward is only granted after Google confirms the full view.
 */
export function useRewardedAd(
  requested: boolean,
  handlers: RewardedAdHandlers,
) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!requested) return;
    const scope = window as Window & { googletag?: GoogleTag };
    const tag = (scope.googletag ??= { cmd: [] } as unknown as GoogleTag);
    let active = true;
    let displayed = false;
    let granted = false;
    let publisher: Publisher | undefined;
    let slot: RewardedSlot | null = null;
    let phase:
      "loading_tag" | "waiting_for_request" | "requested" | "responded" =
      "loading_tag";
    const stop = (reason: Stop, noInventory = false) => {
      active = false;
      latest.current.onStop(announce(reason), noInventory);
    };
    const timeout = window.setTimeout(
      () => stop(phase === "loading_tag" ? "blocked" : "failed", true),
      20000,
    );
    const onRequest = (event: Events["slotRequested"]) => {
      if (active && event.slot === slot) phase = "requested";
    };
    const onResponse = (event: Events["slotResponseReceived"]) => {
      if (active && event.slot === slot) phase = "responded";
    };
    const onReady = (event: Events["rewardedSlotReady"]) => {
      if (!active || event.slot !== slot) return;
      window.clearTimeout(timeout);
      if (displayed) return;
      displayed = event.makeRewardedVisible();
      if (!displayed) stop("failed", true);
      else latest.current.onOpen();
    };
    const onGrant = (event: Events["rewardedSlotGranted"]) => {
      if (active && displayed && event.slot === slot) granted = true;
    };
    const onClose = (event: Events["rewardedSlotClosed"]) => {
      if (!active || event.slot !== slot) return;
      active = false;
      if (!granted) {
        latest.current.onStop(announce("closed"), false);
        return;
      }
      latest.current.onGranted();
    };
    const onRender = (event: Events["slotRenderEnded"]) => {
      if (active && event.slot === slot && event.isEmpty) stop("empty", true);
    };
    const script = publisherScript();
    tag.cmd.push(() => {
      if (!active) return;
      publisher = tag.pubads();
      slot = tag.defineOutOfPageSlot(
        "/22639388115/rewarded_web_example",
        tag.enums.OutOfPageFormat.REWARDED,
      );
      if (!slot) {
        stop("unsupported", true);
        return;
      }
      publisher.addEventListener("rewardedSlotReady", onReady);
      publisher.addEventListener("slotRequested", onRequest);
      publisher.addEventListener("slotResponseReceived", onResponse);
      publisher.addEventListener("rewardedSlotGranted", onGrant);
      publisher.addEventListener("rewardedSlotClosed", onClose);
      publisher.addEventListener("slotRenderEnded", onRender);
      slot.addService(publisher);
      tag.enableServices();
      phase = "waiting_for_request";
      tag.display(slot);
    });
    const failed = () => stop("blocked", true);
    script.addEventListener("error", failed, { once: true });
    if (!script.isConnected) document.head.append(script);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      script.removeEventListener("error", failed);
      publisher?.removeEventListener("rewardedSlotReady", onReady);
      publisher?.removeEventListener("slotRequested", onRequest);
      publisher?.removeEventListener("slotResponseReceived", onResponse);
      publisher?.removeEventListener("rewardedSlotGranted", onGrant);
      publisher?.removeEventListener("rewardedSlotClosed", onClose);
      publisher?.removeEventListener("slotRenderEnded", onRender);
      if (slot) tag.destroySlots([slot]);
    };
  }, [requested]);
}
