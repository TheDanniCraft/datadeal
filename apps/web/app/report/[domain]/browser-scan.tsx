"use client";

import { Button, Spinner, buttonVariants } from "@heroui/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type State =
  | "checking"
  | "no-extension"
  | "ready"
  | "scanning"
  | "uploading"
  | "queued"
  | "needs-confirmation"
  | "duplicate"
  | "failed";

/**
 * For a site that blocks DataDeal's scanner: the scan waits for a real
 * visitor's browser. With the extension installed, the visitor can run it
 * now; the extension opens a private window, measures the site and hands
 * the result back here, and this page uploads it.
 */
export function BrowserScan({
  host,
  signedIn,
  pendingUploads,
  extensionUrl,
}: {
  host: string;
  signedIn: boolean;
  pendingUploads: number;
  extensionUrl?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    const listen = async (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        upload?: unknown;
      };
      if (data?.source !== "datadeal-extension") return;
      if (data.type === "pong")
        setState((current) =>
          current === "checking" || current === "no-extension"
            ? "ready"
            : current,
        );
      if (data.type === "result") {
        setState("uploading");
        const response = await fetch("/api/v1/browser-scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data.upload),
        }).catch(() => null);
        const result = (await response?.json().catch(() => null)) as {
          status?: string;
        } | null;
        if (result?.status === "queued") {
          setState("queued");
          router.refresh();
        } else if (result?.status === "needs_confirmation")
          setState("needs-confirmation");
        else if (result?.status === "duplicate") setState("duplicate");
        else setState("failed");
      }
    };
    window.addEventListener("message", listen);
    window.postMessage(
      { source: "datadeal-page", type: "ping" },
      location.origin,
    );
    const timer = setTimeout(
      () =>
        setState((current) =>
          current === "checking" ? "no-extension" : current,
        ),
      700,
    );
    return () => {
      window.removeEventListener("message", listen);
      clearTimeout(timer);
    };
  }, [router]);

  const start = () => {
    setState("scanning");
    window.postMessage(
      { source: "datadeal-page", type: "scan", domain: host },
      location.origin,
    );
  };

  return (
    <section
      aria-labelledby="browser-scan-title"
      className="grid gap-3 rounded-2xl border border-separator p-5 sm:p-6"
    >
      <h2 id="browser-scan-title" className="m-0! text-lg! font-semibold!">
        Waiting for a visitor&apos;s browser
      </h2>
      <p className="m-0 text-sm leading-relaxed text-muted">
        {host} turns away automated scanners, so this scan is waiting for a real
        visitor&apos;s browser to run it. Anyone with the DataDeal extension can
        do that in a private window in about half a minute.
        {pendingUploads > 0 &&
          ` ${pendingUploads === 1 ? "One visitor has" : `${pendingUploads} visitors have`} already scanned it; one more matching scan publishes the report.`}
      </p>

      {state === "checking" && (
        <Spinner size="sm" aria-label="Looking for the DataDeal extension" />
      )}

      {state === "no-extension" && (
        <ol className="m-0 grid list-decimal gap-1 ps-5 text-sm">
          <li>
            Install the DataDeal extension
            {extensionUrl && (
              <>
                {" "}
                (
                <a className="inline-link" href={extensionUrl}>
                  get it here
                </a>
                )
              </>
            )}
            .
          </li>
          <li>Reload this page and press Scan now.</li>
        </ol>
      )}

      {state === "ready" &&
        (signedIn ? (
          <Button className="justify-self-start" onPress={start}>
            Scan now in my browser
          </Button>
        ) : (
          <Link
            className={buttonVariants({ className: "justify-self-start" })}
            href={"/account?returnTo=" + encodeURIComponent("/report/" + host)}
          >
            Sign in to scan from your browser
          </Link>
        ))}

      {state === "scanning" && (
        <p className="m-0 flex items-center gap-2 text-sm">
          <Spinner size="sm" aria-hidden="true" />
          Follow the steps in the DataDeal tab that just opened.
        </p>
      )}
      {state === "uploading" && (
        <p className="m-0 flex items-center gap-2 text-sm">
          <Spinner size="sm" aria-hidden="true" />
          Sending the results…
        </p>
      )}
      {state === "queued" && (
        <p className="m-0 text-sm text-success">
          Thanks! Your scan is in the queue and the report will appear here.
        </p>
      )}
      {state === "needs-confirmation" && (
        <p className="m-0 text-sm text-success">
          Thanks! Your scan is saved. It is published as soon as one more
          visitor&apos;s scan matches it.
        </p>
      )}
      {state === "duplicate" && (
        <p className="m-0 text-sm text-muted">
          You already scanned {host} in the last hour.
        </p>
      )}
      {state === "failed" && (
        <p className="m-0 text-sm text-danger">
          The results could not be sent. Try again in a moment.
        </p>
      )}
    </section>
  );
}
