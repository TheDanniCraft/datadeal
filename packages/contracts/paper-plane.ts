export const flightCap = 500;
export const guaranteedPoints = 50;
// A flight is worth about 125 points on average (collect near 250, keep it
// half the time), so one flight buys a bit less than one report.
export const defaultReportPointCost = 150;
export const defaultRefreshPointCost = 150;
/** Moves a waiting scan to the front of the queue: 1.5x a normal action. */
export const queueBoostCost = 225;
// Surviving flights pause here once so the player can bank or fly on
// (the reference recording paused at 36).
export const flightCheckpoint = 50;
const growthPerSecond = 0.59085;

/**
 * Chance that a flight is still in the air at integer n: the end point is
 * uniform, so failing before n is (n - 1) out of the cap. Reaching the cap
 * itself (and auto-banking it) happens once in flightCap flights.
 */
export function survivalProbability(target: number) {
  if (!Number.isInteger(target) || target < 1 || target > flightCap)
    throw new RangeError(`Choose an integer target from 1 to ${flightCap}.`);
  return 1 - (target - 1) / flightCap;
}

// Draw once on the server. Never send the endpoint to a running flight.
export function drawFlightEndpoint(u: number) {
  if (!(u > 0 && u < 1)) throw new RangeError("Expected a draw in (0, 1).");
  return 1 + flightCap * (1 - u);
}

export function flightTimeMs(points: number) {
  if (!Number.isFinite(points) || points < 1)
    throw new RangeError("Expected a positive flight threshold.");
  return (Math.log(points) * 1000) / growthPerSecond;
}

export function liveOffer(activeMs: number) {
  if (!Number.isFinite(activeMs) || activeMs < 0)
    throw new RangeError("Expected nonnegative active flight time.");
  return Math.min(
    flightCap,
    Math.floor(Math.exp((growthPerSecond * activeMs) / 1000) + 1e-10),
  );
}

// The caller uses server time, excluding any time held at the checkpoint.
// A prechosen target settles even if the client disconnects before reaching it.
export function resolveFlight({
  endpoint,
  activeMs,
  target,
  collect,
}: {
  endpoint: number;
  activeMs: number;
  target?: number | null;
  collect?: boolean;
}): { state: "flying" | "banked" | "missed"; points: number } {
  if (!Number.isFinite(endpoint) || endpoint < 1)
    throw new RangeError("Invalid flight endpoint.");
  const automatic = target ?? flightCap;
  if (!Number.isInteger(automatic) || automatic < 1 || automatic > flightCap)
    throw new RangeError("Invalid bank target.");
  const offer = liveOffer(activeMs);
  if (automatic < endpoint && activeMs >= flightTimeMs(automatic))
    return { state: "banked", points: automatic };
  if (activeMs >= flightTimeMs(endpoint)) return { state: "missed", points: 0 };
  return collect
    ? { state: "banked", points: offer }
    : { state: "flying", points: offer };
}
