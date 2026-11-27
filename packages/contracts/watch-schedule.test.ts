import { describe, expect, it } from "vitest";
import {
  nextWatchCheck,
  watchCheckCost,
  watchCost,
  watchScheduleError,
} from "./watch-schedule";

const from = new Date("2026-11-27T12:00:00Z");

describe("watch schedules", () => {
  it("prices each recheck at 10% off a manual rescan", () => {
    expect(watchCheckCost).toBe(135);
  });

  it("spreads the price over the interval", () => {
    expect(watchCost({ kind: "days", days: 1 }, from)?.perDay).toBe(135);
    expect(watchCost({ kind: "days", days: 3 }, from)?.perMonth).toBeCloseTo(
      1350,
    );
    expect(watchCost({ kind: "days", days: 30 }, from)?.perMonth).toBeCloseTo(
      135,
    );
  });

  it("reads a cron and counts its runs", () => {
    // Mondays and Thursdays at 06:00 UTC: about 8–9 runs in 30 days.
    const cost = watchCost({ kind: "cron", cron: "0 6 * * 1,4" }, from);
    expect(cost?.checksPerDay).toBeGreaterThan(0.25);
    expect(cost?.checksPerDay).toBeLessThan(0.31);
    expect(
      nextWatchCheck(
        { kind: "cron", cron: "0 6 * * 1,4" },
        from,
      )?.toISOString(),
    ).toBe("2026-11-30T06:00:00.000Z");
  });

  it("allows hourly rechecks but nothing more often", () => {
    expect(watchScheduleError({ kind: "cron", cron: "0 * * * *" }, from)).toBe(
      null,
    );
    expect(watchCost({ kind: "cron", cron: "0 * * * *" }, from)?.perDay).toBe(
      24 * 135,
    );
    expect(
      watchScheduleError({ kind: "cron", cron: "*/30 * * * *" }, from),
    ).toBe("A site can be rechecked at most once an hour.");
  });

  it("refuses invalid crons", () => {
    expect(watchScheduleError({ kind: "cron", cron: "not a cron" }, from)).toBe(
      "That is not a valid cron expression.",
    );
    expect(watchScheduleError({ kind: "cron", cron: "0 6 * * *" }, from)).toBe(
      null,
    );
  });
});
