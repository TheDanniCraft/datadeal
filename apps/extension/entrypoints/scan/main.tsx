import { Button } from "@heroui/react";
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { browser } from "wxt/browser";
import { siteDomain } from "@datadeal/contracts";
import {
  browserScanPermissions,
  otherPrivateWindows,
  runBrowserScan,
  type ScanProgress,
} from "../../lib/browser-scan";
import "./style.css";

const params = new URLSearchParams(location.search);
const domain = siteDomain.safeParse(params.get("domain")).data;
const returnTab = Number(params.get("tab"));

type Stage =
  | { kind: "checking" }
  | { kind: "permissions" }
  | { kind: "private" }
  | { kind: "close-private"; count: number }
  | { kind: "ready" }
  | { kind: "scanning"; progress: ScanProgress }
  | { kind: "sent" }
  | { kind: "failed"; message: string };

const scenarioLabel = {
  default: "Visit before any cookie choice",
  rejected: "Visit after Reject",
  accepted: "Visit after Accept all",
} as const;

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto grid max-w-xl gap-4 px-6 py-12 text-sm leading-relaxed">
      <h1 className="m-0 text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </main>
  );
}

function App() {
  const [stage, setStage] = useState<Stage>({ kind: "checking" });
  const check = useCallback(async () => {
    if (!(await browser.permissions.contains(browserScanPermissions)))
      return setStage({ kind: "permissions" });
    if (!(await browser.extension.isAllowedIncognitoAccess()))
      return setStage({ kind: "private" });
    const open = await otherPrivateWindows();
    if (open) return setStage({ kind: "close-private", count: open });
    setStage({ kind: "ready" });
  }, []);
  useEffect(() => {
    void check();
  }, [check]);

  const start = async () => {
    if (!domain) return;
    try {
      const upload = await runBrowserScan(domain, (progress) =>
        setStage({ kind: "scanning", progress }),
      );
      const { blocked, ...result } = upload;
      if (!result.visits.length)
        return setStage({
          kind: "failed",
          message: blocked
            ? `${domain} showed this browser a bot check as well, so there is nothing to measure. Try again later or from another browser.`
            : `${domain} did not load in the private window. Try again in a moment.`,
        });
      await browser.tabs.sendMessage(returnTab, {
        type: "datadeal-browser-scan-result",
        upload: result,
      });
      setStage({ kind: "sent" });
      await browser.tabs.update(returnTab, { active: true }).catch(() => {});
      setTimeout(() => window.close(), 1500);
    } catch {
      setStage({
        kind: "failed",
        message:
          "The scan stopped unexpectedly. Keep the DataDeal report tab open and try again.",
      });
    }
  };

  if (!domain)
    return <Shell title="Nothing to scan">This link is missing a site.</Shell>;
  return (
    <Shell title={`Scan ${domain} from your browser`}>
      {stage.kind === "checking" && <p>Checking your browser…</p>}
      {stage.kind === "permissions" && (
        <>
          <p>
            DataDeal opens {domain} in a private window, presses its cookie
            buttons like a visitor would and notes which companies it contacts.
            For that it needs to see network requests and cookies in that
            window.
          </p>
          <Button
            onPress={async () => {
              await browser.permissions.request(browserScanPermissions);
              void check();
            }}
          >
            Allow and continue
          </Button>
        </>
      )}
      {stage.kind === "private" && (
        <>
          <p>
            The scan runs in a private window so it starts clean and never
            touches your own logins. Browsers only let you switch this on
            yourself:
          </p>
          <ol className="list-decimal space-y-1 ps-5">
            <li>Open the DataDeal extension&apos;s details page.</li>
            <li>
              Turn on <strong>Allow in Incognito</strong> (Chrome, Edge) or{" "}
              <strong>Run in Private Windows</strong> (Firefox).
            </li>
            <li>Come back to this tab.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            {/Chrome|Edg/.test(navigator.userAgent) && (
              <Button
                variant="secondary"
                onPress={() =>
                  void browser.tabs.create({
                    url: "chrome://extensions/?id=" + browser.runtime.id,
                  })
                }
              >
                Open extension details
              </Button>
            )}
            <Button onPress={() => void check()}>I switched it on</Button>
          </div>
        </>
      )}
      {stage.kind === "close-private" && (
        <>
          <p>
            Please close your{" "}
            {stage.count === 1
              ? "private window"
              : `${stage.count} private windows`}{" "}
            first. Private windows share one cookie jar, so the scan would not
            start clean.
          </p>
          <Button onPress={() => void check()}>Done, check again</Button>
        </>
      )}
      {stage.kind === "ready" && (
        <>
          <p>
            Three short visits in a private window: before any cookie choice,
            after Reject and after Accept all. It takes about half a minute.
            Only cookie names and the companies contacted are sent, never cookie
            values or anything about you.
          </p>
          <Button onPress={() => void start()}>Start scan</Button>
        </>
      )}
      {stage.kind === "scanning" && (
        <div className="grid gap-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-default">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{
                width:
                  (stage.progress.index / stage.progress.total) * 100 + "%",
              }}
            />
          </div>
          <p className="m-0">
            {stage.progress.scenario
              ? scenarioLabel[stage.progress.scenario] + "…"
              : "Finishing…"}
          </p>
        </div>
      )}
      {stage.kind === "sent" && (
        <p>Done. The results are on their way to your DataDeal report tab.</p>
      )}
      {stage.kind === "failed" && (
        <>
          <p>{stage.message}</p>
          <Button onPress={() => void check()}>Try again</Button>
        </>
      )}
    </Shell>
  );
}

// DataDeal's own theme, following the system light or dark setting.
const themePreference = window.matchMedia("(prefers-color-scheme: dark)");
function applySystemTheme() {
  const root = document.documentElement;
  root.classList.toggle("dark", themePreference.matches);
  root.dataset.theme = themePreference.matches ? "mouve-dark" : "mouve-light";
}
applySystemTheme();
themePreference.addEventListener("change", applySystemTheme);

createRoot(document.getElementById("root")!).render(<App />);
