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
const maxLead = 150;

type Box = { w: number; h: number };
type Point = { x: number; y: number };

// Where the plane is after t seconds of active flight, as fractions of the
// panel, measured frame by frame from the reference recording. The plane
// leaves the bottom-left corner, climbs to the middle and then creeps up
// and to the right; it only leaves the frame when it flies away.
const anchors: [number, number, number][] = [
  [0, 0.09, 0.86],
  [1.86, 0.25, 0.8],
  [3.5, 0.37, 0.71],
  [5.07, 0.48, 0.58],
  [6.06, 0.56, 0.46],
  [7, 0.62, 0.39],
  [8, 0.67, 0.34],
  [9.25, 0.76, 0.25],
  [11.7, 0.85, 0.15],
];

/** Smooth (Catmull-Rom) position along the measured anchors. */
function position(t: number): [number, number] {
  const last = anchors.length - 1;
  if (t >= anchors[last][0]) return [anchors[last][1], anchors[last][2]];
  let i = 0;
  while (anchors[i + 1][0] < t) i++;
  const p0 = anchors[Math.max(0, i - 1)];
  const p1 = anchors[i];
  const p2 = anchors[i + 1];
  const p3 = anchors[Math.min(last, i + 2)];
  const u = (t - p1[0]) / (p2[0] - p1[0]);
  const spline = (a: number, b: number, c: number, d: number) =>
    0.5 *
    (2 * b +
      (-a + c) * u +
      (2 * a - 5 * b + 4 * c - d) * u * u +
      (-a + 3 * b - 3 * c + d) * u * u * u);
  return [
    spline(p0[1], p1[1], p2[1], p3[1]),
    spline(p0[2], p1[2], p2[2], p3[2]),
  ];
}

function flightPath(seconds: number, box: Box) {
  const at = (t: number): Point => {
    const [x, y] = position(t);
    return { x: x * box.w, y: y * box.h };
  };
  // The trail starts at the left edge on the baseline, then follows the
  // plane's own path.
  const start = { x: box.w * 0.035, y: box.h * 0.9 };
  const steps = 80;
  const points: Point[] = [start];
  for (let i = 0; i <= steps; i++) points.push(at((seconds * i) / steps));
  const tip = points[points.length - 1];
  const ahead = at(seconds + 0.25);
  const angle =
    (Math.atan2(ahead.y - tip.y, ahead.x - tip.x) * 180) / Math.PI || -20;
  const d =
    "M" + points.map((p) => p.x.toFixed(1) + " " + p.y.toFixed(1)).join(" L");
  return {
    d,
    tip,
    angle,
    frame: { left: box.w * 0.035, base: box.h * 0.9 },
  };
}

// Stars at fixed pseudo-random spots (as fractions of the panel).
const stars = Array.from({ length: 56 }, (_, i) => {
  const r = (n: number) =>
    Math.abs((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1);
  return { x: r(1), y: r(2), s: 0.5 + r(3) * 1.4, o: 0.25 + r(4) * 0.55 };
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

function Plane({
  x,
  y,
  angle,
  moving,
  exit,
  size,
}: {
  x: number;
  y: number;
  angle: number;
  moving: boolean;
  /** 0–1 while it flies off at the end. */
  exit: number;
  size: number;
}) {
  // A light bob while airborne, so it flies rather than slides.
  const now = moving ? performance.now() : 0;
  const bob = moving ? Math.sin(now / 190) * 2 : 0;
  const bank = moving ? Math.sin(now / 280) * 1.8 : 0;
  // It leaves towards the top right, whatever the trail was doing.
  const dx = Math.cos((-38 * Math.PI) / 180) * exit * size * 7;
  const dy = Math.sin((-38 * Math.PI) / 180) * exit * size * 7;
  const scale = size / 120;
  // Keep the plane's own upward tilt and only lean a little with the path.
  const lean = (angle + 35) * 0.35;
  return (
    <g
      transform={`translate(${x + dx} ${y + dy + bob}) rotate(${lean + bank}) scale(${scale})`}
      opacity={1 - exit}
    >
      {/* A folded paper plane, nose up and right, centred on its body. */}
      <g transform="translate(-68 -64)" filter="url(#pp-plane-glow)">
        <path d="M2 52 L118 6 L92 112 Z" fill="#ffffff" />
        <path d="M44 74 L118 6 L60 118 Z" fill="#dfe6f7" />
        <path d="M44 74 L60 118 L62 92 Z" fill="#aab6d6" />
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
  onReplay,
}: {
  reward: PaperReward;
  signedIn: boolean;
  busy: boolean;
  error: string;
  send: (action: string, target?: number | null) => void;
  onClose: () => void;
  /** Watch another ad for a new flight after a miss. */
  onReplay?: () => void;
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
  const panel = useRef<HTMLElement>(null);
  const [box, setBox] = useState<Box>({ w: 800, h: 500 });
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      if (w > 0 && h > 0) setBox({ w, h });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const {
    d,
    tip,
    angle,
    frame: f,
  } = useMemo(() => flightPath(seconds, box), [seconds, box]);

  const state = reward.state;
  const payout = reward.payout ?? 0;
  const banked = state === "banked";
  const missed = state === "missed";
  const final = reward.finalAmount;
  const holding = state === "flying" && reward.checkpoint;
  // Show the tap at once; the server decides whether it was in time.
  const [collecting, setCollecting] = useState(false);
  const [lateTap, setLateTap] = useState(false);
  useEffect(() => {
    if (state !== "flying") setCollecting(false);
    if (state === "missed" && collecting) setLateTap(true);
    if (state === "ready" || state === "choose") setLateTap(false);
    // Only on a state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const moving = (state === "flying" && !holding) || (banked && final === null);
  // When the flight ends, the plane carries on off the top right and fades.
  const ended = final !== null && (missed || banked);
  const [exitStart, setExitStart] = useState<number | null>(null);
  const [exit, setExit] = useState(0);
  useEffect(() => {
    if (!ended) {
      setExitStart(null);
      setExit(0);
      return;
    }
    const start = performance.now();
    setExitStart(start);
    let frame = requestAnimationFrame(function tick() {
      const p = Math.min(1, (performance.now() - start) / 900);
      setExit(p * p);
      if (p < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [ended]);
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
    <div className="grid min-h-0 md:grid-cols-[minmax(0,1fr)_21rem]">
      {/* Flight panel */}
      <section
        ref={panel}
        aria-label="Paper plane flight"
        className="relative isolate aspect-[1.57] overflow-hidden text-white select-none"
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
          viewBox={`0 0 ${box.w} ${box.h}`}
          className="absolute inset-0 size-full"
          aria-hidden="true"
        >
          <defs>
            <filter id="pp-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
            <filter
              id="pp-plane-glow"
              x="-40%"
              y="-40%"
              width="180%"
              height="180%"
            >
              <feGaussianBlur in="SourceAlpha" stdDeviation="9" />
              <feFlood floodColor="#ffffff" floodOpacity="0.45" />
              <feComposite operator="in" in2="SourceAlpha" />
              <feGaussianBlur stdDeviation="6" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="pp-soft" x="-50%" y="-10%" width="200%" height="120%">
              <feGaussianBlur stdDeviation="14" />
            </filter>
            <linearGradient id="pp-beam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {stars.map((star, i) => {
            // Stars stream back and down faster as the plane speeds up;
            // bigger (nearer) stars move more.
            const travel = Math.pow(seconds, 1.55) * 55 * (0.35 + star.s / 2);
            const x = (((star.x * box.w - travel) % box.w) + box.w) % box.w;
            const y = (star.y * box.h + travel * 0.45) % box.h;
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={star.s}
                fill="#fff"
                opacity={star.o}
              />
            );
          })}
          <line
            x1={f.left}
            y1={box.h * 0.06}
            x2={f.left}
            y2={f.base}
            stroke="#fff"
            strokeOpacity="0.12"
          />
          <line
            x1={f.left}
            y1={f.base}
            x2={box.w - 16}
            y2={f.base}
            stroke="#fff"
            strokeOpacity="0.12"
          />
          {seconds > 0.6 && exit < 1 && (
            <rect
              x={tip.x - box.w * 0.06}
              y={tip.y}
              width={box.w * 0.12}
              height={Math.max(0, f.base - tip.y)}
              fill="url(#pp-beam)"
              filter="url(#pp-soft)"
              opacity={(1 - exit) * 0.8}
            />
          )}
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
          {exitStart === null || exit < 1 ? (
            <Plane
              x={tip.x}
              y={tip.y}
              angle={angle}
              moving={moving}
              exit={exit}
              size={Math.max(46, box.w * 0.085)}
            />
          ) : null}
        </svg>

        <p className="absolute top-4 left-[8%] m-0 text-xs text-white/60">
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
                  {missed && lateTap
                    ? `Your tap arrived just after it flew away at ${final ?? live} pts. Your points are unchanged.`
                    : missed
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
                  isDisabled={busy || collecting}
                  onPress={() => {
                    setCollecting(true);
                    send("bank");
                  }}
                >
                  {collecting
                    ? "Collecting…"
                    : holding
                      ? `Collect · ${flightCheckpoint} pts`
                      : "Collect"}
                </Button>
              )}
              {holding && (
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full"
                  isDisabled={busy || collecting}
                  onPress={() => send("continue")}
                >
                  Fly on
                </Button>
              )}
              {missed && onReplay && (
                <Button size="lg" className="w-full" onPress={onReplay}>
                  Watch an ad to fly again
                </Button>
              )}
              {(banked || missed) && (
                <Button
                  size="lg"
                  className="w-full"
                  variant={missed && onReplay ? "secondary" : "primary"}
                  onPress={onClose}
                >
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
