"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { Button, Input, Label, TextField } from "@heroui/react";
import type { PaperReward } from "@datadeal/database";
import { survivalProbability } from "@datadeal/contracts/paper-plane";
import { FlightOdds } from "../flight-odds";
import styles from "./flight.module.css";

export function Flight({
  initial,
  signedIn,
}: {
  initial: PaperReward;
  signedIn: boolean;
}) {
  const [reward, setReward] = useState(initial);
  const [target, setTarget] = useState("100");
  const [busy, setBusy] = useState(false);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const send = useCallback(
    async (action: string, bankTarget?: number | null) => {
      const call = ++seq.current;
      if (action !== "status") setBusy(true);
      try {
        const response = await fetch("/api/v1/rewards/offers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: initial.id, action, target: bankTarget }),
        });
        if (!response.ok) throw Error();
        const next = (await response.json()) as PaperReward;
        if (call === seq.current) {
          setReward(next);
          setError("");
        }
        if (action === "open") window.location.assign("/report/" + next.domain);
      } catch {
        if (call === seq.current)
          setError(
            "Connection interrupted. Your reward is saved. Retry to check its status.",
          );
      } finally {
        if (action !== "status") setBusy(false);
      }
    },
    [initial.id],
  );
  const flying = reward.state === "flying";
  const banked = reward.state === "banked";
  const animating = flying || (banked && reward.finalAmount === null);
  useEffect(() => {
    if (!animating || busy) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await send("status");
      if (active) timer = setTimeout(tick, 260);
    };
    timer = setTimeout(tick, 260);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [animating, busy, send]);
  const valid =
    !target ||
    (/^\d+$/.test(target) && Number(target) >= 1 && Number(target) <= 1000);
  const displayTarget =
    reward.state === "ready"
      ? valid && target
        ? Number(target)
        : null
      : reward.target;
  const receipt =
    reward.state === "points" ||
    reward.state === "unlocked" ||
    reward.state === "choose";
  return (
    <div className="reward-screen mx-auto w-full max-w-2xl space-y-6 py-7 md:py-14">
      <Link className="inline-link text-sm" href={"/report/" + reward.domain}>
        ← {reward.domain}
      </Link>
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {receipt ? "Your ad reward" : "Paper plane"}
        </h1>
        <p className="text-sm text-muted">
          {receipt
            ? "One completed ad"
            : "One flight · up to 1,000 report points"}
        </p>
      </header>
      {reward.state === "choose" ? (
        <section className="space-y-4">
          <h2 className="text-xl">Choose how to use your reward</h2>
          <p>
            Open the advanced report for {reward.domain} in this browser for 24
            hours, including rescans. You can also use this reward for one
            account flight.
          </p>
          <Button
            onPress={() => void send("open")}
            isDisabled={!interactive || busy}
          >
            Open report for 24 hours
          </Button>
          <div>
            {signedIn ? (
              <Button
                variant="secondary"
                onPress={() => void send("chooseFlight")}
                isDisabled={!interactive || busy}
              >
                Choose one flight
              </Button>
            ) : (
              <Link
                className="inline-link"
                href={"/account?returnTo=/rewards/" + reward.id}
              >
                Sign in or create an account for a flight
              </Link>
            )}
          </div>
          <FlightOdds />
        </section>
      ) : receipt ? (
        <section className="space-y-3">
          <h2 className="text-2xl">
            {reward.state === "points" ? "50 points added" : "Report unlocked"}
          </h2>
          <Link
            className="inline-link"
            href={
              reward.state === "points"
                ? "/account/rewards"
                : "/report/" + reward.domain
            }
          >
            {reward.state === "points" ? "Open points wallet" : "Open report"}
          </Link>
        </section>
      ) : (
        <>
          <section
            className={styles.sky}
            aria-label="Flight status"
            style={
              {
                "--distance":
                  reward.state === "ready"
                    ? 0.65
                    : Math.log(Math.max(1, reward.live)) / Math.log(1000),
              } as CSSProperties
            }
          >
            <div className={styles.skyNumber}>
              <p className={styles.caption}>
                {reward.state === "ready"
                  ? "Ready for takeoff"
                  : reward.state === "missed"
                    ? "Flight ended"
                    : banked
                      ? "Points banked"
                      : reward.checkpoint
                        ? "Checkpoint"
                        : "Live offer"}
              </p>
              <p className={styles.offer}>
                {reward.state === "ready"
                  ? "0"
                  : banked || reward.state === "missed"
                    ? reward.payout
                    : reward.live}
                <span> pts</span>
              </p>
            </div>
            <div aria-hidden="true" className={styles.horizon} />
            <div aria-hidden="true" className={styles.trail} />
            <div
              aria-hidden="true"
              className={styles.plane}
              data-active={animating && !reward.checkpoint}
            >
              <i />
              <i />
              <i />
            </div>
            <p className={styles.instrument}>
              {reward.finalAmount !== null
                ? "Final offer · " + reward.finalAmount + " pts"
                : banked
                  ? "Plane still flying · " + reward.live + " pts"
                  : displayTarget
                    ? "Automatic bank · " + displayTarget + " pts"
                    : "Manual banking"}
            </p>
          </section>
          {reward.state === "ready" && (
            <section className="space-y-4">
              <h2 className="text-xl">Set your bank target</h2>
              <TextField
                value={target}
                onChange={setTarget}
                isInvalid={!valid}
                className="max-w-xs"
              >
                <Label>Automatic target in points</Label>
                <Input
                  inputMode="numeric"
                  placeholder="Manual only"
                  maxLength={4}
                />
              </TextField>
              <p className="text-sm text-muted">
                {!valid
                  ? "Enter a whole number from 1 to 1,000."
                  : target
                    ? "Chance of reaching " +
                      target +
                      " points: " +
                      (survivalProbability(Number(target)) * 100).toFixed(1) +
                      "%. Your target works if you disconnect."
                    : "Bank manually or reach the 1,000-point cap."}
              </p>
              <Button
                isDisabled={!interactive || busy || !valid}
                onPress={() =>
                  void send("launch", target ? Number(target) : null)
                }
              >
                Launch plane
              </Button>
              <FlightOdds />
            </section>
          )}
          {flying && (
            <section className="space-y-3">
              <p aria-live="polite">
                {reward.checkpoint
                  ? "Bank 36 points or continue. The flight resumes automatically after ten seconds."
                  : "Bank the live offer before the flight ends."}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  isDisabled={!interactive || busy}
                  onPress={() => void send("bank")}
                >
                  Bank now
                </Button>
                {reward.checkpoint && (
                  <Button
                    variant="secondary"
                    isDisabled={!interactive || busy}
                    onPress={() => void send("continue")}
                  >
                    Continue flight
                  </Button>
                )}
              </div>
            </section>
          )}
          {(banked || reward.state === "missed") && (
            <section role="status" className="space-y-2">
              <h2 className="text-xl">
                {banked
                  ? reward.payout +
                    (reward.payout === 1 ? " point" : " points") +
                    " saved to your wallet"
                  : "This flight earned 0 points"}
              </h2>
              <p className="text-sm text-muted">
                {banked
                  ? "Your banked amount is final."
                  : "Your previous points are still in your wallet."}
              </p>
              <Link className="inline-link" href="/account/rewards">
                Open points wallet
              </Link>
            </section>
          )}
        </>
      )}
      {error && (
        <p role="status">
          {error}{" "}
          <Button variant="ghost" size="sm" onPress={() => void send("status")}>
            Check reward
          </Button>
        </p>
      )}
    </div>
  );
}
