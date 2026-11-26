"use client";

import { Modal, Spinner } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PaperReward } from "@datadeal/database";
import { PaperPlane } from "./paper-plane";

/** The reward choice and the paper-plane flight, over the current page. */
export function RewardModal({
  rewardId,
  signedIn,
  onClose,
  onReplay,
  replayLabel,
  standalone,
}: {
  rewardId: string | null;
  signedIn: boolean;
  onClose: () => void;
  /** Start another flight: a new rewarded ad, or a free flight. */
  onReplay?: () => void;
  replayLabel?: string;
  /** Played on the points page, not over a report. */
  standalone?: boolean;
}) {
  const [reward, setReward] = useState<PaperReward | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);

  const send = useCallback(
    async (action: string, target?: number | null) => {
      if (!rewardId) return;
      const call = ++seq.current;
      if (action !== "status") setBusy(true);
      try {
        const response = await fetch("/api/v1/rewards/offers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: rewardId, action, target }),
        });
        if (!response.ok) throw new Error();
        const next = (await response.json()) as PaperReward;
        if (call === seq.current || action !== "status") {
          if (next.state === "pending") setFailed(true);
          else setReward(next);
          setError("");
        }
      } catch {
        if (action === "status" && !reward) setFailed(true);
        else
          setError(
            "Connection interrupted. Your reward is saved; try again in a moment.",
          );
      } finally {
        if (action !== "status") setBusy(false);
      }
    },
    [rewardId, reward],
  );

  useEffect(() => {
    setReward(null);
    setFailed(false);
    setError("");
    if (rewardId) void send("status");
    // Only when the reward changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewardId]);

  // The server decides the checkpoint, the collect and the hidden end.
  const polling =
    reward?.state === "flying" ||
    (reward?.state === "banked" && reward.finalAmount === null);
  useEffect(() => {
    if (!polling || busy) return;
    const timer = setInterval(() => void send("status"), 120);
    return () => clearInterval(timer);
  }, [polling, busy, send]);

  const close = () => {
    // A kept report changes what the page shows.
    if (reward?.state === "unlocked" || reward?.state === "points")
      window.location.reload();
    onClose();
  };

  return (
    <Modal.Backdrop
      isOpen={!!rewardId}
      onOpenChange={(open) => !open && close()}
      isDismissable={!polling}
    >
      <Modal.Container size="lg" placement="center">
        <Modal.Dialog
          aria-label="Paper plane reward"
          className="overflow-hidden p-0 sm:max-w-[min(68rem,calc(100vw-2rem))]"
        >
          <Modal.CloseTrigger aria-label="Close" className="z-10" />
          {reward ? (
            <PaperPlane
              reward={reward}
              signedIn={signedIn}
              busy={busy}
              error={error}
              send={(action, target) => void send(action, target)}
              onClose={close}
              onReplay={onReplay}
              replayLabel={replayLabel}
              standalone={standalone}
            />
          ) : failed ? (
            <p className="m-0 p-8 text-sm text-muted">
              This reward is no longer available.
            </p>
          ) : (
            <div className="grid place-items-center p-16">
              <Spinner aria-label="Loading your reward" />
            </div>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/** Opens the reward modal for `?reward=<id>`, e.g. from the points wallet. */
export function RewardFromQuery({ signedIn }: { signedIn: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = params.get("reward");
  return (
    <RewardModal
      rewardId={id && /^[0-9a-f-]{36}$/i.test(id) ? id : null}
      signedIn={signedIn}
      onClose={() => {
        const next = new URLSearchParams(params);
        next.delete("reward");
        const query = next.toString();
        router.replace(pathname + (query ? "?" + query : ""), {
          scroll: false,
        });
      }}
    />
  );
}
