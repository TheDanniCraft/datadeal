"use client";

import { useEffect, useRef } from "react";
import {
  configurePublisherPrivacy,
  publisherScript,
  type PublisherPrivacy,
} from "./publisher-tag";

type RewardedSlot = { addService(service: unknown): void };
type Events = {
  rewardedSlotReady: { slot: RewardedSlot; makeRewardedVisible(): boolean };
  rewardedSlotGranted: { slot: RewardedSlot };
  rewardedSlotClosed: { slot: RewardedSlot };
  slotRenderEnded: { slot: RewardedSlot; isEmpty: boolean };
  slotRequested: { slot: RewardedSlot };
  slotResponseReceived: { slot: RewardedSlot };
};
type Publisher = PublisherPrivacy & {
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
  /** No reward: blocked, no inventory, or closed early. */
  onStop(message: string, noInventory: boolean): void;
};

/**
 * Shows one Google rewarded ad while `requested` is true and reports how it
 * ended. A reward is only granted after Google confirms the full view.
 */
export function useRewardedAd(
  requested: boolean,
  limited: boolean,
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
    const stop = (message: string, noInventory = false) => {
      active = false;
      latest.current.onStop(message, noInventory);
    };
    const timeout = window.setTimeout(
      () =>
        stop(
          {
            loading_tag:
              "Your browser or an extension blocked Google’s ad service, so no video could load. Firefox’s tracking protection does this even after you accept ads here. You can allow it for this site with the shield icon in the address bar, or get the report with Pro.",
            waiting_for_request:
              "The ad service loaded but did not confirm sending a video request.",
            requested:
              "The video was requested. Google did not confirm a response in time.",
            responded:
              "Google responded, but the video did not become ready to play.",
          }[phase],
          true,
        ),
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
      if (!displayed) stop("The ad could not open. Try again later.", true);
      else latest.current.onOpen();
    };
    const onGrant = (event: Events["rewardedSlotGranted"]) => {
      if (active && displayed && event.slot === slot) granted = true;
    };
    const onClose = (event: Events["rewardedSlotClosed"]) => {
      if (!active || event.slot !== slot) return;
      active = false;
      if (!granted) {
        latest.current.onStop(
          "The ad was closed before a reward was granted.",
          false,
        );
        return;
      }
      latest.current.onGranted();
    };
    const onRender = (event: Events["slotRenderEnded"]) => {
      if (active && event.slot === slot && event.isEmpty)
        stop("No ad is available right now. Try again later.", true);
    };
    const script = publisherScript(limited);
    if (!script) {
      window.clearTimeout(timeout);
      stop("No compatible ad is available on this visit.", true);
      return;
    }
    tag.cmd.push(() => {
      if (!active) return;
      publisher = tag.pubads();
      if (!configurePublisherPrivacy(publisher, limited)) {
        stop("No compatible ad is available on this visit.", true);
        return;
      }
      slot = tag.defineOutOfPageSlot(
        "/22639388115/rewarded_web_example",
        tag.enums.OutOfPageFormat.REWARDED,
      );
      if (!slot) {
        stop("Rewarded ads are unavailable in this browser.", true);
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
    const failed = () =>
      stop(
        "Your browser or an extension blocked Google’s ad script. You can allow it for this site (in Firefox: the shield icon in the address bar), or get the report with Pro.",
        true,
      );
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
  }, [requested, limited]);
}
