"use client";

import { Button } from "@heroui/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PaperReward } from "@datadeal/database";
import {
  flightCap,
  flightCheckpoint,
  flightTimeMs,
  guaranteedPoints,
  liveOffer,
} from "@datadeal/contracts/paper-plane";

const growth = Math.log(2) / 1.1731; // the measured curve, ≈0.591 per second
const checkpointMs = flightTimeMs(flightCheckpoint);
const decisionMs = 10_000;
// How far the local clock may run ahead of the last server answer.
const maxLead = 250;

// Chart geometry in the SVG's own units.
const W = 800;
const H = 500;
const left = 70;
const base = 440;
const width = 660;
const height = 370;

type Point = { x: number; y: number };

/** Position on the rising chart for t seconds, at the current zoom. */
function chartPoint(t: number, spanT: number, spanV: number): Point {
  const v = Math.exp(growth * t);
  return {
    x: left + (width * t) / spanT,
    y: base - height * Math.pow((v - 1) / (spanV - 1), 0.9),
  };
}

function flightPath(seconds: number) {
  const v = Math.exp(growth * seconds);
  // The view widens as the plane climbs, so it stays near the upper right.
  const spanT = Math.max(10, seconds / 0.84);
  const spanV = Math.max(150, v / 0.8);
  const steps = 90;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++)
    points.push(chartPoint((seconds * i) / steps, spanT, spanV));
  const tip = points[points.length - 1];
  const prev = points[points.length - 4] ?? points[0];
  // Nose along the trail, but never steeper than a climbing plane.
  const angle =
    seconds > 0.05
      ? Math.max(
          -42,
          Math.min(
            -6,
            (Math.atan2(tip.y - prev.y, tip.x - prev.x) * 180) / Math.PI,
          ),
        )
      : -12;
  const d =
    "M" + points.map((p) => p.x.toFixed(1) + " " + p.y.toFixed(1)).join(" L");
  return { d, tip, angle };
}

// Stars at fixed pseudo-random positions so server and client agree.
const stars = Array.from({ length: 46 }, (_, i) => {
  const r = (n: number) =>
    (Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1;
  return {
    x: Math.abs(r(1)) * W,
    y: Math.abs(r(2)) * (base - 20),
    s: 0.6 + Math.abs(r(3)) * 1.3,
    o: 0.25 + Math.abs(r(4)) * 0.55,
  };
});

/** Active flight time, smoothed between server answers. */
function useFlightClock(reward: PaperReward, holdingSince: number | null) {
  const anchor = useRef({ active: reward.activeMs, at: 0 });
  // Never draw time running backwards when a server answer lands slightly
  // behind the local clock.
  const shown = useRef(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    anchor.current = { active: reward.activeMs, at: performance.now() };
  }, [reward]);
  const moving =
    reward.state === "flying" ||
    (reward.state === "banked" && reward.finalAmount === null);
  useEffect(() => {
    if (!moving) return;
    let frame = requestAnimationFrame(function tick() {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [moving]);
  if (reward.state === "ready" || reward.state === "choose") {
    shown.current = 0;
    return 0;
  }
  if (reward.finalAmount !== null)
    return flightTimeMs(Math.max(1, reward.finalAmount));
  if (reward.checkpoint || holdingSince !== null) return checkpointMs;
  const { active, at } = anchor.current;
  let value = active + Math.min(maxLead, Math.max(0, now - at));
  // The server holds every flight at the checkpoint; show it right away.
  if (active < checkpointMs && value > checkpointMs) value = checkpointMs;
  value = Math.max(value, shown.current);
  shown.current = value;
  return value;
}

function Plane({ x, y, angle }: { x: number; y: number; angle: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <g transform="translate(-34 -20)">
        <path d="M0 18 L68 0 L26 30 Z" fill="#ffffff" />
        <path d="M26 30 L68 0 L34 42 Z" fill="#c7d2fe" />
        <path d="M26 30 L34 42 L30 30 Z" fill="#a5b4fc" />
      </g>
    </g>
  );
}

export function PaperPlane({
  reward,
  signedIn,
  busy,
  error,
  send,
  onClose,
}: {
  reward: PaperReward;
  signedIn: boolean;
  busy: boolean;
  error: string;
  send: (action: string, target?: number | null) => void;
  onClose: () => void;
}) {
  // When the checkpoint hold began, for the 10-second decision bar.
  const [holdStart, setHoldStart] = useState<number | null>(null);
  useEffect(() => {
    if (reward.state === "flying" && reward.checkpoint)
      setHoldStart((start) => start ?? performance.now());
    else setHoldStart(null);
  }, [reward.state, reward.checkpoint]);
  const active = useFlightClock(reward, holdStart);
  const seconds = active / 1000;
  const live = Math.min(flightCap, Math.max(1, liveOffer(active)));
  const { d, tip, angle } = useMemo(() => flightPath(seconds), [seconds]);

  const state = reward.state;
  const payout = reward.payout ?? 0;
  const banked = state === "banked";
  const missed = state === "missed";
  const final = reward.finalAmount;
  const holding = state === "flying" && reward.checkpoint;
  const heat = Math.min(1, Math.log(live) / Math.log(120));
  const tone = missed ? "missed" : banked ? "banked" : "flight";
  const trail =
    tone === "missed" ? "#f87171" : tone === "banked" ? "#f472b6" : "#c4b5fd";

  const [decision, setDecision] = useState(1);
  useEffect(() => {
    if (holdStart === null) return;
    let frame = requestAnimationFrame(function tick() {
      setDecision(
        Math.max(0, 1 - (performance.now() - holdStart) / decisionMs),
      );
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [holdStart]);

  return (
    <div className="grid min-h-0 md:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Flight panel */}
      <section
        aria-label="Paper plane flight"
        className="relative isolate aspect-[16/10] overflow-hidden text-white select-none md:aspect-auto md:min-h-[26rem]"
      >
        <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_10%_100%,#2547c4_0%,#0e1d5c_55%,#091235_100%)]" />
        <div
          className="absolute inset-0 bg-[radial-gradient(120%_100%_at_10%_100%,#6d28d9_0%,#3b0f8c_50%,#1a0b4d_100%)] transition-opacity duration-300"
          style={{ opacity: tone === "flight" ? heat : 0 }}
        />
        <div
          className="absolute inset-0 bg-[radial-gradient(120%_100%_at_10%_100%,#d946ef_0%,#86198f_45%,#2e0533_100%)] transition-opacity duration-700"
          style={{ opacity: tone === "banked" ? 1 : 0 }}
        />
        <div
          className="absolute inset-0 bg-[radial-gradient(120%_100%_at_10%_100%,#b91c1c_0%,#5f0d0d_50%,#1c0505_100%)] transition-opacity duration-500"
          style={{ opacity: tone === "missed" ? 1 : 0 }}
        />
        {/* Sunburst from the launch corner */}
        <div className="absolute inset-0 bg-[repeating-conic-gradient(from_-90deg_at_9%_88%,rgb(255_255_255/0.07)_0deg_3deg,transparent_3deg_9deg)] [mask-image:radial-gradient(85%_90%_at_9%_88%,black,transparent)]" />

        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMinYMax slice"
          className="absolute inset-0 size-full"
          aria-hidden="true"
        >
          <defs>
            <filter id="pp-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>
          {stars.map((s, i) => (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.s}
              fill="#fff"
              opacity={s.o}
            />
          ))}
          <line
            x1={left}
            y1={30}
            x2={left}
            y2={base}
            stroke="#fff"
            strokeOpacity="0.12"
          />
          <line
            x1={left}
            y1={base}
            x2={W - 20}
            y2={base}
            stroke="#fff"
            strokeOpacity="0.12"
          />
          {seconds > 0 && (
            <>
              <path
                d={d}
                fill="none"
                stroke={trail}
                strokeWidth="9"
                strokeOpacity="0.35"
                filter="url(#pp-glow)"
              />
              <path
                d={d}
                fill="none"
                stroke={trail}
                strokeWidth="3.5"
                strokeLinecap="round"
              />
            </>
          )}
          {!(missed && final !== null) && (
            <Plane x={tip.x} y={tip.y} angle={angle} />
          )}
        </svg>

        <p className="absolute top-4 left-[9%] m-0 text-xs text-white/60">
          max {flightCap.toLocaleString("en")} pts
        </p>

        {/* The number: centred, stable, readable */}
        <div className="pointer-events-none absolute inset-0 grid place-content-center justify-items-center gap-1 px-6 text-center">
          {(missed || (banked && final !== null)) && (
            <p
              className={
                "m-0 text-sm font-bold tracking-[0.2em] uppercase " +
                (missed ? "text-red-200" : "text-white")
              }
            >
              Flew away!
            </p>
          )}
          <p
            className={
              "m-0 flex items-baseline gap-1.5 leading-none font-bold tracking-tight tabular-nums drop-shadow-[0_4px_18px_rgb(0_0_0/0.35)] " +
              (banked
                ? "text-emerald-300"
                : missed
                  ? "text-red-300"
                  : holding
                    ? "text-amber-300"
                    : "text-white")
            }
            aria-live="off"
          >
            <span className="text-[clamp(3.5rem,9vw,6rem)]">
              {banked
                ? "+" + payout
                : missed
                  ? (final ?? live)
                  : state === "ready" || state === "choose"
                    ? 1
                    : live}
            </span>
            <span className="text-xl font-semibold opacity-80">pts</span>
          </p>
          {banked && (
            <p className="m-0 text-sm font-semibold text-white/90">
              {final === null
                ? `Still flying: ${live} pts`
                : `The plane reached ${final} pts`}
            </p>
          )}
          {missed && (
            <p className="m-0 text-sm font-semibold text-white/90">
              You collected nothing this time
            </p>
          )}
          {holding && (
            <div className="mt-3 grid w-[min(22rem,90%)] gap-1.5 rounded-2xl bg-black/30 px-5 py-4 backdrop-blur-sm">
              <p className="m-0 text-sm font-semibold">
                The plane reached {flightCheckpoint} pts
              </p>
              <p className="m-0 text-xs text-white/80">
                Collect now or risk flying on. It can fly away at any moment.
              </p>
              <p className="m-0 mt-1 text-[.7rem] text-white/70">
                Decide within 10 seconds or it flies on
              </p>
              <div className="h-1 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-amber-300"
                  style={{ width: decision * 100 + "%" }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Side panel */}
      <aside className="flex min-h-0 flex-col gap-4 bg-surface p-5 pt-6 sm:p-6">
        <h2 className="m-0 pe-8 text-lg font-semibold">
          {state === "choose" ? "Your ad is done" : "Paper plane"}
        </h2>

        {state === "choose" ? (
          signedIn ? (
            <div className="grid gap-2">
              <p className="m-0 text-sm text-muted">Choose one reward.</p>
              {(
                [
                  [
                    "chooseFlight",
                    "Fly the paper plane",
                    "1–1,000 points, or nothing if it flies away",
                  ],
                  [
                    "choosePoints",
                    `Claim ${guaranteedPoints} points`,
                    "Safe. Enough for one report unlock",
                  ],
                  [
                    "open",
                    "Keep this report",
                    `${reward.domain} stays in your account`,
                  ],
                ] as const
              ).map(([action, title, text]) => (
                <button
                  key={action}
                  type="button"
                  disabled={busy}
                  onClick={() => send(action)}
                  className="grid gap-0.5 rounded-xl border border-separator px-4 py-3 text-left transition-colors hover:border-accent hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60"
                >
                  <span className="text-sm font-semibold">{title}</span>
                  <span className="text-xs text-muted">{text}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid gap-3">
              <p className="m-0 text-sm text-muted">
                Open the full report for {reward.domain} in this browser for 24
                hours, including rescans.
              </p>
              <Button
                size="lg"
                className="w-full"
                isDisabled={busy}
                onPress={() => send("open")}
              >
                Open report for 24 hours
              </Button>
              <Link
                className="inline-link text-sm"
                href={"/account?returnTo=/rewards/" + reward.id}
              >
                Sign in to keep the report, take points or fly
              </Link>
            </div>
          )
        ) : state === "points" || state === "unlocked" ? (
          <div className="grid gap-3">
            <p className="m-0 text-sm">
              {state === "points"
                ? `${guaranteedPoints} points were added to your wallet.`
                : `The full report for ${reward.domain} is now in your account.`}
            </p>
            <Button size="lg" className="w-full" onPress={onClose}>
              Back to report
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-xl bg-default px-4 py-3">
              <span className="text-sm text-muted">
                {banked || missed ? "Points collected" : "Up for grabs"}
              </span>
              <span
                className={
                  "text-xl font-bold tabular-nums " +
                  (banked
                    ? "text-success"
                    : missed
                      ? "text-danger"
                      : "text-accent")
                }
              >
                {banked ? "+" + payout : missed ? "0" : "1–1,000"}
              </span>
            </div>

            {state === "ready" && (
              <ol className="m-0 grid list-none gap-2.5 p-0 text-sm">
                {[
                  "Press Start and the plane takes off.",
                  "The number grows from 1 to 1,000 points, faster and faster.",
                  "Press Collect before the plane flies away to keep the number.",
                  "Too late and you get nothing. One flight only.",
                ].map((text, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[.7rem] font-bold text-accent-foreground">
                      {i + 1}
                    </span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            )}

            {(banked || missed) && (
              <div className="grid gap-2 text-sm">
                {banked && (
                  <div className="relative h-1.5 rounded-full bg-default">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-success"
                      style={{
                        width:
                          (Math.log(Math.max(1, payout)) /
                            Math.log(flightCap)) *
                            100 +
                          "%",
                      }}
                    />
                    <div
                      className="absolute top-1/2 size-2.5 -translate-1/2 rounded-full bg-accent"
                      style={{
                        left:
                          (Math.log(final ?? live) / Math.log(flightCap)) *
                            100 +
                          "%",
                      }}
                    />
                  </div>
                )}
                {banked && (
                  <p className="m-0 flex items-center gap-2">
                    <span className="size-2 rounded-full bg-success" />
                    <strong className="tabular-nums">{payout}</strong>
                    <span className="text-muted">you collected</span>
                  </p>
                )}
                <p className="m-0 flex items-center gap-2">
                  <span className="size-2 rounded-full bg-accent" />
                  <strong className="tabular-nums">{final ?? live}</strong>
                  <span className="text-muted">
                    {final === null ? "still flying…" : "the plane reached"}
                  </span>
                </p>
                <p className="m-0 text-xs text-muted">
                  {missed
                    ? "Your points are unchanged."
                    : final !== null && final > payout
                      ? "It kept flying for a while. You could have risked it."
                      : "Saved to your wallet."}
                </p>
              </div>
            )}

            <div className="mt-auto grid gap-2 pt-2">
              {state === "ready" && (
                <Button
                  size="lg"
                  className="w-full"
                  isDisabled={busy}
                  onPress={() => send("launch", null)}
                >
                  Start
                </Button>
              )}
              {state === "flying" && (
                <Button
                  size="lg"
                  className="w-full bg-success font-semibold text-white"
                  isDisabled={busy}
                  onPress={() => send("bank")}
                >
                  {holding ? `Collect · ${flightCheckpoint} pts` : "Collect"}
                </Button>
              )}
              {holding && (
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full"
                  isDisabled={busy}
                  onPress={() => send("continue")}
                >
                  Fly on
                </Button>
              )}
              {(banked || missed) && (
                <Button size="lg" className="w-full" onPress={onClose}>
                  Back to report
                </Button>
              )}
              {banked && (
                <Link
                  className="inline-link text-center text-xs"
                  href="/account/rewards"
                >
                  Open points wallet
                </Link>
              )}
            </div>
          </>
        )}
        {error && (
          <p role="status" className="m-0 text-xs text-danger">
            {error}
          </p>
        )}
      </aside>
    </div>
  );
}
