"use client";
import { ConsentDialogLink } from "@c15t/nextjs";
import {
  useAdvertisingConsent,
  useLimitedAdsPurposeOffered,
} from "../../../lib/ads/use-advertising-consent";
import {
  Button,
  Disclosure,
  Label,
  Radio,
  RadioGroup,
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
import { FlightOdds } from "../../rewards/flight-odds";
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
  const [choice, setChoice] = useState("unlock");
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
              "The Google ad service did not finish loading. A video request could not be confirmed.",
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
      stop("The Google test ad script could not load.", true);
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
  return (
    <>
      {!unavailable && (
        <Button
          variant="secondary"
          size="sm"
          className="min-h-11 w-full gap-2 sm:col-start-2 sm:row-start-1 sm:w-auto sm:self-center"
          isDisabled={requested || saving}
          onPress={async () => {
            if (retryId) {
              void saveReward(retryId);
              return;
            }
            setNotice("");
            if (game) {
              setSaving(true);
              try {
                const response = await fetch("/api/v1/rewards/offers", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "reserve",
                    offer: choice,
                    host,
                    scanId,
                  }),
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
          }}
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
                : choice === "unlock"
                  ? "Watch an ad to unlock"
                  : choice === "points"
                    ? `Watch an ad for ${guaranteedPoints} points`
                    : choice === "flight"
                      ? "Watch an ad for a flight"
                      : "Watch an ad, then choose"}
        </Button>
      )}
      {game && !unavailable && (
        <Disclosure className="min-w-0 sm:contents">
          <Disclosure.Heading className="flex justify-center sm:col-start-2 sm:row-start-2">
            <Button
              slot="trigger"
              size="sm"
              variant="ghost"
              className="min-h-10 gap-1.5 px-2 text-xs font-medium text-muted hover:text-foreground"
            >
              Choose your reward <Disclosure.Indicator />
            </Button>
          </Disclosure.Heading>
          <Disclosure.Content className="sm:col-span-2">
            <Disclosure.Body className="grid min-w-0 gap-3 border-t border-separator pt-4 text-sm">
              <RadioGroup
                name="ad-reward"
                value={choice}
                onChange={setChoice}
                isDisabled={requested || saving || Boolean(retryId)}
              >
                <Label>One completed ad earns one reward</Label>
                {(signedIn
                  ? [
                      ["unlock", "Open this domain for 24 hours"],
                      ["points", "Save " + guaranteedPoints + " report points"],
                      ["flight", "Try a flight for 0–1,000 points"],
                    ]
                  : [
                      ["unlock", "Open this domain for 24 hours"],
                      ["choice", "Choose after the ad"],
                    ]
                ).map(([value, label]) => (
                  <Radio key={value} value={value} className="min-h-10">
                    <Radio.Content>
                      <Radio.Control>
                        <Radio.Indicator />
                      </Radio.Control>
                      {label}
                    </Radio.Content>
                  </Radio>
                ))}
              </RadioGroup>
              {choice === "unlock" && (
                <p className="m-0">
                  Sign in within the 24-hour window to keep this scan in your
                  account.
                </p>
              )}
              {choice === "choice" && (
                <p className="m-0">
                  After the ad, open this report or sign in for a flight. You
                  have 30 days to claim your reward in this browser.
                </p>
              )}
              {(choice === "flight" || choice === "choice") && <FlightOdds />}
              {choice === "points" && (
                <p className="m-0">
                  Points stay in your account. Keeping a scan costs{" "}
                  {defaultReportPointCost} points in this local trial.
                </p>
              )}
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      )}
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
