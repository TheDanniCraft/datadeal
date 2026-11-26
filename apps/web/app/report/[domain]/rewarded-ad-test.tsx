"use client";
import { ConsentDialogLink } from "@c15t/nextjs";
import {
  useAdvertisingConsent,
  useLimitedAdsPurposeOffered,
} from "../../../lib/ads/use-advertising-consent";
import { Button, Modal, Spinner, buttonVariants } from "@heroui/react";
import { ReportIcon } from "./report-icon";
import { useCallback, useState } from "react";
import { RewardModal } from "../../rewards/reward-modal";
import { useRewardedAd } from "../../../lib/ads/rewarded-ad";
import {
  defaultReportPointCost,
  flightCap,
} from "@datadeal/contracts/paper-plane";
function TestOffer({
  host,
  scanId,
  limited,
  game,
  signedIn,
  label = "Watch an ad to unlock",
}: {
  host: string;
  scanId: string;
  limited: boolean;
  game: boolean;
  signedIn: boolean;
  label?: string;
}) {
  const [choice, setChoice] = useState<"unlock" | "choice" | "flight">(
    "unlock",
  );
  const [chooserOpen, setChooserOpen] = useState(false);
  const [intent, setIntent] = useState("");
  const [requested, setRequested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [retryId, setRetryId] = useState<string>();
  const [notice, setNotice] = useState("");
  const [rewardId, setRewardId] = useState<string | null>(null);
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
          setSaving(false);
          setNotice("");
          setRewardId(reward.id);
        }
      } catch {
        setSaving(false);
        setRetryId(completionId);
        setNotice("Your ad is complete. Try saving your reward again.");
      }
    },
    [host, scanId],
  );
  useRewardedAd(requested, limited, {
    onOpen: () => setNotice("The ad is open."),
    onGranted: () => void saveReward(intent || crypto.randomUUID()),
    onStop: (message, noInventory) => {
      setUnavailable(noInventory);
      setNotice(message);
      setRequested(false);
    },
  });
  const start = async (offer: "unlock" | "choice" | "flight") => {
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
          className="min-h-11 w-full gap-2"
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
                : label}
        </Button>
      )}
      <RewardModal
        rewardId={rewardId}
        signedIn={signedIn}
        onClose={() => setRewardId(null)}
        onReplay={
          signedIn && game
            ? () => {
                setRewardId(null);
                void start("flight");
              }
            : undefined
        }
      />
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
                    Watch one short ad, then choose:
                  </p>
                  <ul className="m-0! grid list-none gap-2 p-0!">
                    {[
                      [
                        "Keep this report",
                        "This scan stays in your account for good. A newer scan of the site needs a new unlock.",
                      ],
                      [
                        "Or fly the paper plane",
                        `Collect before it flies away for 1–${flightCap} points, or miss and get nothing. Points unlock any report later.`,
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
                        good. After the ad you can instead fly the paper plane
                        for points.
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
  pointBalance = 0,
}: {
  host: string;
  scanId: string;
  game?: boolean;
  signedIn?: boolean;
  pointBalance?: number;
}) {
  const consent = useAdvertisingConsent();
  const limitedOffered = useLimitedAdsPurposeOffered();
  const [spendMessage, setSpendMessage] = useState("");
  const [spending, setSpending] = useState(false);
  const adsEligible = consent !== "privacy-signal" || limitedOffered;
  const points = game && signedIn;
  const canSpend = points && pointBalance >= defaultReportPointCost;
  if (!adsEligible && !points) return null;
  const adsReady = consent === "allowed" || consent === "limited";

  const spend = async () => {
    setSpending(true);
    setSpendMessage("");
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
  };

  const description = canSpend
    ? `You have ${pointBalance} report points. Unlock this scan for ${defaultReportPointCost} and keep it in your account, no ad needed.`
    : consent === "privacy-signal"
      ? "You can choose limited advertising in Privacy settings when it is available."
      : "Watch a short ad for 24-hour access, including rescans.";

  return (
    <div className="grid min-w-0 gap-y-2 border-t border-separator px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6 sm:gap-y-0 sm:px-8">
      <div className="min-w-0 self-center sm:col-start-1 sm:row-span-2">
        <h3 className="m-0 text-base font-semibold">One-domain access</h3>
        <p className="mt-1 mb-0 max-w-prose text-sm leading-relaxed text-muted">
          {description}
        </p>
        {points && !canSpend && (
          <p className="mt-1 mb-0 text-xs text-muted">
            You have {pointBalance} of the {defaultReportPointCost} report
            points that unlock a scan without an ad.{" "}
            <a className="inline-link" href="/account/rewards">
              My points
            </a>
          </p>
        )}
      </div>
      <div className="grid min-w-0 gap-2 sm:col-start-2 sm:row-start-1 sm:w-60 sm:self-center [&>button]:w-full">
        {canSpend && (
          <Button
            size="sm"
            className="min-h-11 w-full gap-2 sm:w-auto"
            isDisabled={spending}
            onPress={() => void spend()}
          >
            {spending && (
              <Spinner size="sm" color="current" aria-hidden="true" />
            )}
            Unlock for {defaultReportPointCost} points
          </Button>
        )}
        {adsEligible &&
          (adsReady ? (
            <TestOffer
              key={consent}
              game={game}
              signedIn={signedIn}
              limited={consent === "limited"}
              host={host}
              scanId={scanId}
              label={canSpend ? "Watch an ad instead" : undefined}
            />
          ) : (
            !canSpend && (
              <ConsentDialogLink
                className={buttonVariants({
                  variant: "secondary",
                  size: "sm",
                  className: "min-h-11 w-full sm:w-auto",
                })}
              >
                {consent === "privacy-signal"
                  ? "Review limited ad settings"
                  : "Review advertising consent"}
              </ConsentDialogLink>
            )
          ))}
      </div>
      {spendMessage && (
        <p role="status" className="m-0 text-sm sm:col-span-2">
          {spendMessage}
        </p>
      )}
    </div>
  );
}
