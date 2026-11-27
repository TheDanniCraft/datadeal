"use client";

import { Button, Modal, Spinner } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { monitorDailyCost } from "@datadeal/contracts/paper-plane";

const bell = "M4 17h16l-2-3v-4a6 6 0 0 0-12 0v4z M10 20a2 2 0 0 0 4 0";

async function post(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (response?.ok) return "";
  const error = (await response?.json().catch(() => null)) as {
    code?: string;
  } | null;
  return error?.code === "insufficient"
    ? "Your balance is too low."
    : "Could not change this. Try again.";
}

/**
 * Watching a site: weekly rescans, and every new report stays open. Pro
 * includes it with email alerts; otherwise it costs points each day.
 * A bell opens the settings and the price.
 */
export function WatchButton({
  host,
  watching,
  mode,
  balance = 0,
  saved = true,
}: {
  host: string;
  watching: boolean;
  mode: "pro" | "points";
  balance?: number;
  /** Pro watches live on saved sites; unsaved ones are saved first. */
  saved?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const change = async (watch: boolean) => {
    setBusy(true);
    setMessage("");
    let error = "";
    if (mode === "points")
      error = await post("/api/v1/monitors", "POST", {
        domain: host,
        monitor: watch,
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
  const monthly = monitorDailyCost * 30;
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
        <Modal.Container size="sm">
          <Modal.Dialog className="min-w-0">
            <Modal.CloseTrigger aria-label="Close" />
            <Modal.Header>
              <Modal.Heading>
                {watching ? `Watching ${host}` : `Watch ${host}`}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="grid gap-4 text-sm">
              <ul className="m-0! grid list-none gap-2 p-0!">
                {[
                  "DataDeal rescans the site every week.",
                  "Each new report stays open for you.",
                  mode === "pro"
                    ? "You get an email when the score or privacy documents change."
                    : "Stop any time, here or in your library.",
                ].map((text) => (
                  <li key={text} className="flex gap-2">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="mt-0.5 size-4 shrink-0 fill-none stroke-success"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m5 12 5 5 9-10" />
                    </svg>
                    {text}
                  </li>
                ))}
              </ul>
              <div className="grid gap-1 rounded-xl bg-default/60 p-3">
                {mode === "pro" ? (
                  <span className="font-medium">Included with Pro</span>
                ) : (
                  <>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">
                        {monitorDailyCost} points a day
                      </span>
                      <span className="text-xs text-muted">
                        about {monthly} a month
                      </span>
                    </span>
                    <span className="text-xs text-muted">
                      You have {balance} points. Watching stops on its own when
                      they run out.
                    </span>
                  </>
                )}
              </div>
              {watching ? (
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => void change(false)}
                >
                  Stop watching
                </Button>
              ) : (
                <Button
                  className="gap-2"
                  isDisabled={
                    busy || (mode === "points" && balance < monitorDailyCost)
                  }
                  onPress={() => void change(true)}
                >
                  {busy && (
                    <Spinner size="sm" color="current" aria-hidden="true" />
                  )}
                  {mode === "pro"
                    ? "Start watching"
                    : `Start for ${monitorDailyCost} points a day`}
                </Button>
              )}
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
