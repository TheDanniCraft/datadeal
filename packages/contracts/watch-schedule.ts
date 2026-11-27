import { Cron } from "croner";
import { z } from "zod";
import { defaultRefreshPointCost, watchDiscount } from "./paper-plane";

/** Each recheck of a watched site: a manual rescan at the watch discount. */
export const watchCheckCost = Math.round(
  defaultRefreshPointCost * (1 - watchDiscount),
);

/** The intervals the watch window offers, in days. */
export const watchIntervals = [1, 3, 7, 30, 90] as const;

/** Rechecks run at most once an hour (a little slack for cron drift). */
const minimumGapMs = 55 * 60 * 1000;

export const watchSchedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("days"), days: z.number().int().min(1).max(365) }),
  z.object({
    kind: z.literal("cron"),
    cron: z.string().trim().min(9).max(120),
  }),
]);
export type WatchSchedule = z.infer<typeof watchSchedule>;

/** Runs of a cron in the next 30 days, or an error message for people. */
function cronRuns(expression: string, from: Date) {
  let cron: Cron;
  try {
    cron = new Cron(expression, { timezone: "UTC", paused: true });
  } catch {
    return { error: "That is not a valid cron expression." } as const;
  }
  const end = from.getTime() + 30 * 24 * 60 * 60 * 1000;
  const runs: Date[] = [];
  let cursor: Date | null = from;
  while (runs.length < 800) {
    cursor = cron.nextRun(cursor);
    if (!cursor || cursor.getTime() > end) break;
    runs.push(cursor);
  }
  cron.stop();
  if (!runs.length)
    return { error: "This cron does not run in the next 30 days." } as const;
  for (let i = 1; i < runs.length; i++)
    if (runs[i]!.getTime() - runs[i - 1]!.getTime() < minimumGapMs)
      return {
        error: "A site can be rechecked at most once an hour.",
      } as const;
  return { runs } as const;
}

/** Checks a schedule; returns a message when it cannot be used. */
export function watchScheduleError(schedule: WatchSchedule, from = new Date()) {
  if (schedule.kind === "days") return null;
  const result = cronRuns(schedule.cron, from);
  return "error" in result ? result.error : null;
}

/** When the next recheck is due after `from`. */
export function nextWatchCheck(schedule: WatchSchedule, from: Date) {
  if (schedule.kind === "days")
    return new Date(from.getTime() + schedule.days * 24 * 60 * 60 * 1000);
  const result = cronRuns(schedule.cron, from);
  return "runs" in result ? (result.runs?.[0] ?? null) : null;
}

/** Average rechecks per day and what they cost. */
export function watchCost(schedule: WatchSchedule, from = new Date()) {
  let perDay: number;
  if (schedule.kind === "days") perDay = 1 / schedule.days;
  else {
    const result = cronRuns(schedule.cron, from);
    if ("error" in result) return null;
    perDay = result.runs.length / 30;
  }
  return {
    checksPerDay: perDay,
    perDay: watchCheckCost * perDay,
    perMonth: watchCheckCost * perDay * 30,
  };
}

/**
 * How long a watch may rely on someone else's recent scan instead of paying
 * for its own: 90% of its interval, at most 20 hours.
 */
export function watchFreshWindowHours(
  schedule: WatchSchedule,
  from = new Date(),
) {
  const cost = watchCost(schedule, from);
  const intervalHours = cost ? 24 / cost.checksPerDay : 24;
  return Math.min(20, intervalHours * 0.9);
}

/** "every day", "every 3 days", or "on a custom schedule". */
export function describeWatchSchedule(schedule: WatchSchedule) {
  if (schedule.kind === "cron") return "on a custom schedule";
  return schedule.days === 1 ? "every day" : `every ${schedule.days} days`;
}
