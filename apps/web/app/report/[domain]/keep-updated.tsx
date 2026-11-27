"use client";

import { Button, Modal, Spinner } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import cronstrue from "cronstrue";
import {
  describeWatchSchedule,
  watchCheckCost,
  watchCost,
  watchIntervals,
  watchScheduleError,
  type WatchSchedule,
} from "@datadeal/contracts/watch-schedule";

const bell = "M4 17h16l-2-3v-4a6 6 0 0 0-12 0v4z M10 20a2 2 0 0 0 4 0";
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

async function post(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (response?.ok) return "";
  const error = (await response?.json().catch(() => null)) as {
    code?: string;
    error?: string;
  } | null;
  return error?.code === "insufficient"
    ? "Your balance is too low."
    : error?.code === "limit"
      ? "Your included Pro watches are in use. Stop one first."
      : error?.code === "schedule" && error.error
        ? error.error
        : "Could not change this. Try again.";
}

/**
 * Watching a site: it is rechecked on a schedule you pick, and every new
 * report stays open. Pro includes a few weekly watches with alerts; with
 * points each recheck costs a discounted rescan.
 */
export function WatchButton({
  host,
  watching,
  mode,
  balance = 0,
  saved = true,
  included,
  schedule: current,
}: {
  host: string;
  watching: boolean;
  mode: "pro" | "points";
  balance?: number;
  /** Pro watches live on saved sites; unsaved ones are saved first. */
  saved?: boolean;
  /** Pro's included watches: how many are in use. */
  included?: { used: number; limit: number };
  /** The schedule of an existing points watch. */
  schedule?: WatchSchedule;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [choice, setChoice] = useState<number | "custom">(
    current?.kind === "cron" ? "custom" : (current?.days ?? 7),
  );
  const [cron, setCron] = useState(
    current?.kind === "cron" ? current.cron : "0 6 * * 1",
  );
  const schedule: WatchSchedule =
    choice === "custom"
      ? { kind: "cron", cron: cron.trim() }
      : { kind: "days", days: choice };
  const scheduleError =
    choice === "custom" ? watchScheduleError(schedule) : null;
  // What the schedule means, in words.
  const meaning =
    choice === "custom"
      ? (() => {
          try {
            return (
              cronstrue.toString(cron.trim(), {
                use24HourTimeFormat: true,
                verbose: true,
              }) + " (UTC)"
            );
          } catch {
            return null;
          }
        })()
      : `Rechecked ${describeWatchSchedule(schedule)}.`;
  const cost = scheduleError ? null : watchCost(schedule);
  const changed =
    watching && JSON.stringify(schedule) !== JSON.stringify(current ?? null);

  const change = async (watch: boolean) => {
    setBusy(true);
    setMessage("");
    let error = "";
    if (mode === "points")
      error = await post("/api/v1/monitors", "POST", {
        domain: host,
        monitor: watch,
        ...(watch && { schedule }),
      });
    else {
      if (watch && !saved)
        error = await post("/api/v1/account/watchlist", "POST", {
          domain: host,
        });
      if (!error)
        error = await post("/api/v1/account/alerts", "PATCH", {
          domain: host,
          enabled: watch,
        });
    }
    setBusy(false);
    setMessage(error);
    if (!error) {
      setOpen(false);
      router.refresh();
    }
  };

  return (
    <>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={(watching ? "Watching " : "Watch ") + host}
        className={watching ? "text-accent" : undefined}
        onPress={() => setOpen(true)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={
            "size-4 stroke-current " + (watching ? "fill-current" : "fill-none")
          }
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={bell} />
        </svg>
      </Button>
      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container size="md">
          <Modal.Dialog className="min-w-0">
            <Modal.CloseTrigger aria-label="Close" />
            <Modal.Header>
              <Modal.Heading>
                {watching ? `Watching ${host}` : `Watch ${host}`}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="grid gap-4 text-sm">
              <p className="m-0 text-muted">
                DataDeal rechecks the site{" "}
                {mode === "pro"
                  ? "every week and emails you when the score or privacy documents change"
                  : "on the schedule you pick"}
                . Each new report stays open for you.
              </p>

              {mode === "pro" ? (
                <div className="grid gap-1 rounded-xl bg-default/60 p-3">
                  <span className="font-medium">
                    Included with Pro · every week
                  </span>
                  {included && (
                    <span className="text-xs text-muted">
                      {included.used} of {included.limit} included watches in
                      use. More sites can be watched with points.
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <fieldset className="m-0 grid gap-2 border-0 p-0">
                    <legend className="mb-2 p-0 font-medium">
                      How often should it be rechecked?
                    </legend>
                    <div
                      role="radiogroup"
                      aria-label="Recheck interval"
                      className="grid grid-cols-3 gap-2"
                    >
                      {watchIntervals.map((option) => {
                        const selected = choice === option;
                        return (
                          <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setChoice(option)}
                            className={
                              "h-10 rounded-xl border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-focus " +
                              (selected
                                ? "border-accent bg-accent/10 font-medium text-accent"
                                : "border-separator hover:bg-default/60")
                            }
                          >
                            {option === 1
                              ? "Every day"
                              : `Every ${option} days`}
                          </button>
                        );
                      })}
                      {choice === "custom" ? (
                        // Same box as the other choices, so nothing moves.
                        <input
                          autoFocus
                          aria-label="Cron schedule"
                          value={cron}
                          onChange={(event) => setCron(event.target.value)}
                          placeholder="0 6 * * 1"
                          spellCheck={false}
                          autoCapitalize="none"
                          autoComplete="off"
                          aria-invalid={scheduleError ? true : undefined}
                          aria-describedby="watch-meaning"
                          className={
                            "h-10 w-full min-w-0 rounded-xl border bg-accent/10 px-2 text-center font-mono text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-focus " +
                            (scheduleError ? "border-danger" : "border-accent")
                          }
                        />
                      ) : (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={false}
                          onClick={() => setChoice("custom")}
                          className="h-10 rounded-xl border border-separator px-3 font-mono text-sm transition-colors hover:bg-default/60 focus-visible:outline-2 focus-visible:outline-focus"
                        >
                          Cron
                        </button>
                      )}
                    </div>
                    <p
                      id="watch-meaning"
                      aria-live="polite"
                      className={
                        "m-0 min-h-10 text-xs " +
                        (scheduleError ? "text-danger" : "text-muted")
                      }
                    >
                      {scheduleError
                        ? (meaning ? meaning + " · " : "") + scheduleError
                        : meaning}
                    </p>
                  </fieldset>

                  <div className="grid gap-1 rounded-xl bg-default/60 p-3">
                    {cost ? (
                      <>
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="font-medium">
                            About {number.format(cost.perDay)} points a day
                          </span>
                          <span className="text-xs text-muted">
                            about {number.format(cost.perMonth)} a month
                          </span>
                        </span>
                        <span className="text-xs text-muted">
                          {watchCheckCost} points per recheck
                          {schedule.kind === "cron" &&
                            `, about ${number.format(cost.checksPerDay * 30)} rechecks a month`}
                          .
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted">
                        Enter a valid schedule to see the price.
                      </span>
                    )}
                    <span className="text-xs text-muted">
                      You have {balance} points. Points are taken at each
                      recheck; watching stops when they run out.
                    </span>
                  </div>
                </>
              )}

              <div className="grid gap-2">
                {!watching && (
                  <Button
                    className="gap-2"
                    isDisabled={
                      busy ||
                      (mode === "points" &&
                        (!!scheduleError || balance < watchCheckCost))
                    }
                    onPress={() => void change(true)}
                  >
                    {busy && (
                      <Spinner size="sm" color="current" aria-hidden="true" />
                    )}
                    Start watching
                  </Button>
                )}
                {changed && mode === "points" && (
                  <Button
                    isDisabled={busy || !!scheduleError}
                    onPress={() => void change(true)}
                  >
                    Save schedule
                  </Button>
                )}
                {watching && (
                  <Button
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => void change(false)}
                  >
                    Stop watching
                  </Button>
                )}
              </div>
              {message && (
                <p role="status" className="m-0 text-xs text-danger">
                  {message}
                </p>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
