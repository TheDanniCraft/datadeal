"use client";
import { ConsentDialogLink } from "@c15t/nextjs";
import {
  useAdvertisingConsent,
  useLimitedAdsPurposeOffered,
} from "../../../lib/ads/use-advertising-consent";
import {
  Button,
  Disclosure,
  Modal,
  Spinner,
  buttonVariants,
} from "@heroui/react";
import { ReportIcon } from "./report-icon";
import { useCallback, useEffect, useState } from "react";
import {
  publisherScript,
  configurePublisherPrivacy,
  type PublisherPrivacy,
} from "../../../lib/ads/publisher-tag";
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
import {
  defaultReportPointCost,
  guaranteedPoints,
} from "@datadeal/contracts/paper-plane";
function TestOffer({
  host,
  scanId,
  limited,
  game,
  signedIn,
}: {
  host: string;
  scanId: string;
  limited: boolean;
  game: boolean;
  signedIn: boolean;
}) {
  const [choice, setChoice] = useState<"unlock" | "choice">("unlock");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [intent, setIntent] = useState("");
  const [requested, setRequested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [retryId, setRetryId] = useState<string>();
  const [notice, setNotice] = useState("");
  const saveReward = useCallback(
    async (completionId: string) => {
      setRetryId(undefined);
      setSaving(true);
      setRequested(false);
      setNotice("Saving your reward…");
      try {
        const response = await fetch("/api/v1/rewards/local-sample", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host, scanId, completionId }),
        });
        if (!response.ok) throw new Error("Local reward could not be saved");
        if (response.status === 204) window.location.reload();
        else {
          const reward = await response.json();
          window.location.assign("/rewards/" + reward.id);
        }
      } catch {
        setSaving(false);
        setRetryId(completionId);
        setNotice("Your ad is complete. Try saving your reward again.");
      }
    },
    [host, scanId],
  );
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
      setUnavailable(noInventory);
      setNotice(message);
      setRequested(false);
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
      if (!displayed) stop("The test ad could not open.", true);
      else setNotice("The Google sample ad is open.");
    };
    const onGrant = (event: Events["rewardedSlotGranted"]) => {
      if (active && displayed && event.slot === slot) granted = true;
    };
    const onClose = (event: Events["rewardedSlotClosed"]) => {
      if (!active || event.slot !== slot) return;
      active = false;
      if (!granted) {
        stop("The ad was closed before a reward was granted.");
        return;
      }
      void saveReward(intent || crypto.randomUUID());
    };
    const onRender = (event: Events["slotRenderEnded"]) => {
      if (active && event.slot === slot && event.isEmpty)
        stop(
          "Google returned an empty ad slot. Availability can vary and Google doesn’t give us a personal viewing limit or a retry time.",
          true,
        );
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
  }, [requested, saveReward, limited, intent]);
  const start = async (offer: "unlock" | "choice") => {
    setChooserOpen(false);
    setChoice(offer);
    setNotice("");
    if (game) {
      setSaving(true);
      try {
        const response = await fetch("/api/v1/rewards/offers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reserve", offer, host, scanId }),
        });
        if (!response.ok) throw Error();
        setIntent((await response.json()).id);
      } catch {
        setNotice("This reward could not be reserved. Try again.");
        return;
      } finally {
        setSaving(false);
      }
    }
    setRequested(true);
  };
  const returnTo = "/report/" + encodeURIComponent(host);
  return (
    <>
      {!unavailable && (
        <Button
          variant="secondary"
          size="sm"
          className="min-h-11 w-full gap-2 sm:col-start-2 sm:row-start-1 sm:w-auto sm:self-center"
          isDisabled={requested || saving}
          onPress={() =>
            retryId ? void saveReward(retryId) : setChooserOpen(true)
          }
        >
          {requested || saving ? (
            <Spinner size="sm" color="current" aria-hidden="true" />
          ) : (
            <ReportIcon name="play" />
          )}
          {saving
            ? "Saving reward…"
            : requested
              ? "Loading video…"
              : retryId
                ? choice === "unlock"
                  ? "Retry unlock"
                  : "Retry reward"
                : "Watch an ad to unlock"}
        </Button>
      )}
      <Modal.Backdrop isOpen={chooserOpen} onOpenChange={setChooserOpen}>
        <Modal.Container size="lg">
          <Modal.Dialog className="min-w-0">
            <Modal.CloseTrigger aria-label="Close" />
            <Modal.Header>
              <Modal.Heading>Unlock the full report for {host}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {signedIn ? (
                <div className="grid gap-4">
                  <p className="m-0 text-sm leading-relaxed text-muted">
                    Watch one short ad. Afterwards you choose one reward:
                  </p>
                  <ul className="m-0! grid list-none gap-2 p-0!">
                    {[
                      [
                        "Keep this report",
                        "This scan stays in your account for good. A newer scan of the site needs a new unlock.",
                      ],
                      [
                        guaranteedPoints + " points",
                        "Enough for one report unlock later, on any site.",
                      ],
                      [
                        "Paper-plane flight",
                        "Collect before the plane flies away for 1–1,000 points, or miss and get nothing.",
                      ],
                    ].map(([title, text]) => (
                      <li
                        key={title}
                        className="rounded-xl border border-separator p-3"
                      >
                        <p className="m-0 font-medium">{title}</p>
                        <p className="m-0 text-sm text-muted">{text}</p>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="min-h-11"
                    onPress={() => void start(game ? "choice" : "unlock")}
                  >
                    <ReportIcon name="play" /> Watch the ad
                  </Button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <section className="grid content-between gap-4 rounded-xl border border-separator p-4">
                    <div>
                      <h3 className="m-0 text-base font-semibold">
                        Continue as guest
                      </h3>
                      <p className="mt-1 mb-0 text-sm leading-relaxed text-muted">
                        Watch one ad and open this report in this browser for 24
                        hours, including new scans in that time. No account
                        needed.
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      className="min-h-11"
                      onPress={() => void start("unlock")}
                    >
                      <ReportIcon name="play" /> Watch as guest
                    </Button>
                  </section>
                  <section className="grid content-between gap-4 rounded-xl border border-accent/40 bg-accent/5 p-4">
                    <div>
                      <h3 className="m-0 text-base font-semibold">
                        Sign in to keep it
                      </h3>
                      <p className="mt-1 mb-0 text-sm leading-relaxed text-muted">
                        Save this version of the report to your account for
                        good. After the ad you can instead take{" "}
                        {guaranteedPoints} points or try a paper-plane flight.
                      </p>
                    </div>
                    <a
                      className={buttonVariants({
                        className: "min-h-11 w-full",
                      })}
                      href={"/account?returnTo=" + encodeURIComponent(returnTo)}
                    >
                      Sign in with email
                    </a>
                  </section>
                </div>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      {notice && (
        <p role="status" className="m-0 text-sm leading-relaxed sm:col-span-2">
          {notice}
        </p>
      )}
    </>
  );
}
export function RewardedAdTest({
  host,
  scanId,
  game = false,
  signedIn = false,
}: {
  host: string;
  scanId: string;
  game?: boolean;
  signedIn?: boolean;
}) {
  const consent = useAdvertisingConsent();
  const limitedOffered = useLimitedAdsPurposeOffered();
  const [spendMessage, setSpendMessage] = useState("");
  const [spending, setSpending] = useState(false);
  const adsEligible = consent !== "privacy-signal" || limitedOffered;
  if (!adsEligible && !(game && signedIn)) return null;
  return (
    <div className="grid min-w-0 gap-y-2 border-t border-separator px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6 sm:gap-y-0 sm:px-8">
      {adsEligible && (
        <>
          <div className="min-w-0 self-center sm:col-start-1 sm:row-span-2">
            <h3 className="m-0 text-base font-semibold">One-domain access</h3>
            <p className="mt-1 mb-0 max-w-prose text-sm leading-relaxed text-muted">
              {consent === "privacy-signal"
                ? "You can choose limited advertising in Privacy settings when it is available."
                : "Finish a Google sample ad for 24-hour access, including rescans."}
            </p>
          </div>
          {consent === "allowed" || consent === "limited" ? (
            <TestOffer
              key={consent}
              game={game}
              signedIn={signedIn}
              limited={consent === "limited"}
              host={host}
              scanId={scanId}
            />
          ) : (
            <ConsentDialogLink
              className={buttonVariants({
                variant: "secondary",
                size: "sm",
                className: "min-h-11 w-full sm:w-auto sm:self-center",
              })}
            >
              {consent === "privacy-signal"
                ? "Review limited ad settings"
                : "Review advertising consent"}
            </ConsentDialogLink>
          )}
        </>
      )}
      {game && signedIn && (
        <Disclosure className="w-full sm:col-span-2">
          <Disclosure.Heading>
            <Button
              slot="trigger"
              variant="ghost"
              size="sm"
              className="min-h-9 px-0"
            >
              Use report points <Disclosure.Indicator />
            </Button>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body className="space-y-2 py-2">
              <p className="text-sm">
                Keep this scan of {host} in your account.
              </p>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={spending}
                onPress={async () => {
                  setSpending(true);
                  try {
                    const res = await fetch("/api/v1/rewards/offers", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "spend",
                        host,
                        scanId,
                        spendPoints: true,
                      }),
                    });
                    const body = await res.json();
                    if (res.ok) {
                      window.location.reload();
                      return;
                    }
                    setSpendMessage(
                      body.code === "insufficient"
                        ? "Your balance is too low."
                        : "This scan is unavailable.",
                    );
                  } catch {
                    setSpendMessage("Could not confirm the unlock. Try again.");
                  } finally {
                    setSpending(false);
                  }
                }}
              >
                Unlock for {defaultReportPointCost} points
              </Button>{" "}
              <a
                className="inline-link ms-2 inline-flex min-h-10 items-center text-sm"
                href="/account/rewards"
              >
                My points
              </a>
              {spendMessage && <p role="status">{spendMessage}</p>}
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      )}
    </div>
  );
}
