import { browser, type Browser } from "wxt/browser";
import { getDomain, parse } from "tldts";
import type {
  BrowserScanUpload,
  BrowserScanVisit,
} from "@datadeal/contracts/browser-scan";
import type { ConsentCoverage } from "@datadeal/contracts";
import {
  describeWebStorage,
  inspectWebStorage,
  summarizeBrowserCookies,
} from "@datadeal/scanner/browser-storage";
import {
  storageInspectionLimit,
  webStorageSummary,
  type BrowserStorageSnapshot,
} from "@datadeal/contracts";
import { requestFieldCollector } from "@datadeal/collector/request-fields";
import { isBlockPage } from "@datadeal/scanner/access-interstitial";
import {
  consentControlInFrame,
  consentPatterns,
  consentSettleMs,
  type ConsentChoice,
} from "@datadeal/collector/consent";

/**
 * Runs DataDeal's homepage measurement in the visitor's own browser, in a
 * private window, for a site that blocks the server's scanner. It does what
 * the worker does: a visit before any choice, one after "Reject" and one
 * after "Accept all", each in a fresh private session. Only masked names and
 * value descriptions leave the browser, never cookie or storage values.
 */

export const browserScanPermissions = {
  permissions: [
    "webRequest",
    "cookies",
  ] as Browser.permissions.Permissions["permissions"],
  origins: ["https://*/*", "http://*/*"],
};

export type ScanProgress = {
  step: "visit" | "pages" | "done";
  scenario?: BrowserScanVisit["scenario"];
  index: number;
  total: number;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A page that stops answering must not stall the scan. */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), ms),
    ),
  ]);
}
const scriptTimeout = 8_000;
const visitTimeout = 75_000;
const trace = (...parts: unknown[]) =>
  console.debug("[browser-scan]", ...parts);

async function waitForLoad(tabId: number, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (tab?.status === "complete") return;
    await delay(150);
  }
}

/** Every private window shares one cookie store, so ours must be the only one. */
export async function otherPrivateWindows() {
  const windows = await browser.windows.getAll();
  return windows.filter((window) => window.incognito).length;
}

async function storeFor(tabId: number) {
  const stores = await browser.cookies.getAllCookieStores();
  return stores.find((store) => store.tabIds.includes(tabId))?.id;
}

const sameSite = (value?: string) =>
  value === "strict" ? "Strict" : value === "lax" ? "Lax" : "None";

async function snapshot(
  tabId: number,
  storeId: string | undefined,
  homepage: URL,
): Promise<BrowserStorageSnapshot> {
  const rows = await browser.cookies.getAll(storeId ? { storeId } : {});
  const cookies = summarizeBrowserCookies(
    rows.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      expires: cookie.expirationDate ?? -1,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: sameSite(cookie.sameSite),
    })),
    homepage,
  );
  const [inspection] = await within(
    browser.scripting.executeScript({
      target: { tabId },
      func: inspectWebStorage,
      args: [
        { expectedOrigin: homepage.origin, limit: storageInspectionLimit },
      ],
    }),
    scriptTimeout,
  ).catch(() => []);
  const web = inspection?.result
    ? webStorageSummary.safeParse(describeWebStorage(inspection.result)).data
    : undefined;
  return { cookies, web };
}

/** Finds the one consent control for a choice, as the worker does. */
async function findControl(tabId: number, choice: ConsentChoice) {
  const patterns = consentPatterns(choice);
  const deadline = Date.now() + 4000;
  let ambiguous = false;
  do {
    const counts = await within(
      browser.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: consentControlInFrame,
        args: [{ ...patterns, mode: "count" as const }],
      }),
      scriptTimeout,
    ).catch(() => []);
    const found = counts.filter((frame) => (frame.result as number) > 0);
    const [only] = found;
    if (found.length === 1 && only?.result === 1)
      return { frameId: only.frameId };
    ambiguous ||= found.length > 0;
    await delay(150);
  } while (Date.now() < deadline);
  return ambiguous
    ? ("inconclusive" as const)
    : ("control_unavailable" as const);
}

type Pending = {
  url: string;
  method: string;
  body?: string;
  frameUrl: string;
  topLevel: boolean;
};

async function visit(
  requested: URL,
  scenario: BrowserScanVisit["scenario"],
  capturePages: boolean,
  opened: number[],
): Promise<{
  visit?: BrowserScanVisit;
  outcome: ConsentCoverage["default"];
  pages: { url: string; html: string }[];
  /** The site showed this browser a bot check too. */
  blocked?: boolean;
}> {
  const window = await browser.windows.create({
    url: "about:blank",
    incognito: true,
    focused: false,
    width: 1280,
    height: 900,
  });
  if (window?.id !== undefined) opened.push(window.id);
  const tabId = window?.tabs?.[0]?.id;
  if (!window?.id || tabId === undefined)
    return { outcome: "inconclusive", pages: [] };
  const homeDomain = getDomain(requested.hostname, {
    allowPrivateDomains: true,
  });
  // The site may redirect (e.g. reddit.com to www.reddit.com); the page it
  // lands on is the homepage for this visit.
  let homepage = requested;
  const onSite = (href?: string) =>
    !!href &&
    /^https?:/.test(href) &&
    getDomain(new URL(href).hostname, { allowPrivateDomains: true }) ===
      homeDomain;
  const network = requestFieldCollector(requested);
  const pending = new Map<string, Pending>();
  const adapters = new Map<string, Parameters<typeof network.request>[0]>();
  let requests = 0;
  let choiceStart: number | undefined;
  const externalDomains = new Set<string>();
  const responseDomains = new Set<string>();
  const afterChoiceDomains = new Set<string>();
  const filter = { tabId, urls: ["<all_urls>"] };

  const onBefore = (
    details: Browser.webRequest.OnBeforeRequestDetails,
  ): undefined => {
    if (!/^https?:/.test(details.url)) return;
    requests++;
    const raw = details.requestBody?.raw?.[0]?.bytes;
    const form = details.requestBody?.formData;
    pending.set(details.requestId, {
      url: details.url,
      method: details.method,
      body: raw
        ? new TextDecoder().decode(raw)
        : form
          ? new URLSearchParams(
              Object.entries(form).flatMap(([key, values]) =>
                (values as string[]).map((value) => [key, value]),
              ),
            ).toString()
          : undefined,
      frameUrl:
        (details as { documentUrl?: string }).documentUrl ??
        details.initiator ??
        homepage.origin,
      topLevel: details.frameId === 0,
    });
    const target = parse(details.url, { allowPrivateDomains: true });
    if (
      (target.isIcann || target.isPrivate) &&
      target.domain &&
      target.domain !== homeDomain
    ) {
      if (externalDomains.size < 20) externalDomains.add(target.domain);
      if (choiceStart !== undefined && afterChoiceDomains.size < 20)
        afterChoiceDomains.add(target.domain);
    }
  };
  const onHeaders = (
    details: Browser.webRequest.OnBeforeSendHeadersDetails,
  ): undefined => {
    const request = pending.get(details.requestId);
    if (!request) return;
    const headers = Object.fromEntries(
      (details.requestHeaders ?? []).map(({ name, value }) => [
        name.toLowerCase(),
        value ?? "",
      ]),
    );
    if (request.body && !headers["content-type"])
      headers["content-type"] = /^[{[]/.test(request.body.trim())
        ? "application/json"
        : "text/plain";
    const body = request.body;
    const adapter = {
      url: () => request.url,
      method: () => request.method,
      headers: () => headers,
      postDataBuffer: () =>
        body === undefined
          ? null
          : { length: body.length, toString: () => body },
      frame: () => ({
        url: () => request.frameUrl,
        parentFrame: () => (request.topLevel ? null : {}),
      }),
    };
    adapters.set(details.requestId, adapter);
    network.request(
      adapter,
      choiceStart === undefined ? "before_choice" : "after_choice",
    );
  };
  const onResponse = (details: Browser.webRequest.OnResponseStartedDetails) => {
    const adapter = adapters.get(details.requestId);
    if (adapter) network.response(adapter);
    adapters.delete(details.requestId);
    pending.delete(details.requestId);
    const target = getDomain(details.url, { allowPrivateDomains: true });
    if (target && externalDomains.has(target)) responseDomains.add(target);
  };
  browser.webRequest.onBeforeRequest.addListener(onBefore, filter, [
    "requestBody",
  ]);
  browser.webRequest.onBeforeSendHeaders.addListener(onHeaders, filter, [
    "requestHeaders",
  ]);
  browser.webRequest.onResponseStarted.addListener(onResponse, filter);

  const pages: { url: string; html: string }[] = [];
  try {
    const storeId = await storeFor(tabId);
    const navigationStartedAt = new Date().toISOString();
    await browser.tabs.update(tabId, { url: requested.href });
    await waitForLoad(tabId);
    trace(scenario, "loaded");
    const loaded = await browser.tabs.get(tabId);
    if (!onSite(loaded.url)) return { outcome: "inconclusive", pages };
    homepage = new URL(new URL(loaded.url!).origin + "/");
    const [shown] = await within(
      browser.scripting.executeScript({
        target: { tabId },
        func: () => document.documentElement.outerHTML,
      }),
      scriptTimeout,
    ).catch(() => []);
    if (isBlockPage(String(shown?.result ?? "")))
      return { outcome: "inconclusive", pages, blocked: true };

    let beforeChoice: BrowserStorageSnapshot | undefined;
    let beforeChoiceSnapshotAt: string | undefined;
    if (scenario !== "default") {
      const found = await findControl(tabId, scenario);
      if (typeof found === "string") return { outcome: found, pages };
      // As in the worker: snapshot just before the click.
      beforeChoice = await snapshot(tabId, storeId, homepage).catch(
        () => undefined,
      );
      choiceStart = requests;
      trace(scenario, "click");
      await within(
        browser.scripting.executeScript({
          target: { tabId, frameIds: [found.frameId] },
          func: consentControlInFrame,
          args: [{ ...consentPatterns(scenario), mode: "click" as const }],
        }),
        scriptTimeout,
      ).catch(() => []);
    } else {
      beforeChoice = await snapshot(tabId, storeId, homepage).catch(
        () => undefined,
      );
    }
    if (beforeChoice) beforeChoiceSnapshotAt = new Date().toISOString();
    await delay(consentSettleMs);
    const landed = new URL((await browser.tabs.get(tabId)).url ?? "");
    if (landed.origin !== homepage.origin)
      return { outcome: "inconclusive", pages };
    trace(scenario, "settled");
    const end = await snapshot(tabId, storeId, homepage);
    trace(scenario, "snapshot");
    const endSnapshotAt = new Date().toISOString();

    if (capturePages) {
      // The rendered homepage and up to three privacy pages, for the
      // server's policy reading (the site refuses the server's requests).
      const [home] = await within(
        browser.scripting.executeScript({
          target: { tabId },
          func: () => ({
            html: document.documentElement.outerHTML,
            links: Array.from(document.querySelectorAll("a[href]"))
              .map((a) => ({
                href: (a as HTMLAnchorElement).href,
                text: (a.textContent ?? "").trim(),
              }))
              .filter(({ href, text }) =>
                /privacy|datenschutz|cookie|polic/i.test(href + " " + text),
              ),
          }),
        }),
        scriptTimeout,
      ).catch(() => []);
      const result = home?.result;
      if (result) {
        pages.push({
          url: landed.origin + landed.pathname,
          html: result.html.slice(0, 1_500_000),
        });
        const links = [
          ...new Set(
            result.links
              .map(({ href }) => href.split("#")[0] ?? href)
              .filter((href) => href.startsWith("https://")),
          ),
        ].slice(0, 3);
        for (const link of links) {
          await browser.tabs.update(tabId, { url: link });
          await waitForLoad(tabId);
          await delay(800);
          const [page] = await within(
            browser.scripting.executeScript({
              target: { tabId },
              func: () => ({
                url: location.href,
                html: document.documentElement.outerHTML,
              }),
            }),
            scriptTimeout,
          ).catch(() => []);
          if (page?.result)
            pages.push({
              url: page.result.url,
              html: page.result.html.slice(0, 1_500_000),
            });
        }
      }
    }

    return {
      outcome: "measured",
      pages,
      visit: {
        scenario,
        visitedUrl: landed.origin + landed.pathname,
        network: network.results(),
        observation: {
          type: "browser_consent_counts",
          freshContext: true,
          finalPageKnown: true,
          capture: {
            navigationStartedAt,
            ...(beforeChoiceSnapshotAt && { beforeChoiceSnapshotAt }),
            endSnapshotAt,
            settleMs: consentSettleMs,
          },
          requests,
          cookies: end.cookies.total,
          ...(end.web && {
            storage: {
              localEntries: end.web.local.total,
              sessionEntries: end.web.session.total,
            },
          }),
          storageSummary: { ...(beforeChoice && { beforeChoice }), end },
          externalDomains: [...externalDomains].sort(),
          responseDomains: [...responseDomains].sort(),
          requestInspection: network.inspection(),
          ...(choiceStart !== undefined && {
            afterChoice: {
              requests: requests - choiceStart,
              externalDomains: [...afterChoiceDomains].sort(),
              ...(scenario === "accepted" && { acceptedAll: true }),
            },
          }),
        },
      },
    };
  } catch (error) {
    trace(scenario, "failed", String(error));
    return { outcome: "inconclusive", pages };
  } finally {
    browser.webRequest.onBeforeRequest.removeListener(onBefore);
    browser.webRequest.onBeforeSendHeaders.removeListener(onHeaders);
    browser.webRequest.onResponseStarted.removeListener(onResponse);
    // Closing the last private window discards its cookies and storage.
    await browser.windows.remove(window.id).catch(() => {});
    await delay(400);
  }
}

export async function runBrowserScan(
  domain: string,
  onProgress: (progress: ScanProgress) => void,
): Promise<BrowserScanUpload & { blocked: boolean }> {
  const homepage = new URL("https://" + domain + "/");
  const coverage: ConsentCoverage = {
    default: "untested",
    rejected: "untested",
    accepted: "untested",
  };
  const visits: BrowserScanVisit[] = [];
  let pages: { url: string; html: string }[] = [];
  let finalHome = homepage;
  let blocked = false;
  const scenarios = ["default", "rejected", "accepted"] as const;
  for (const [index, scenario] of scenarios.entries()) {
    onProgress({ step: "visit", scenario, index, total: scenarios.length });
    const opened: number[] = [];
    const result = await within(
      visit(finalHome, scenario, scenario === "default", opened),
      visitTimeout,
    ).catch(async () => {
      trace(scenario, "visit timed out");
      // Close the stuck private window so the next visit starts clean.
      for (const id of opened) await browser.windows.remove(id).catch(() => {});
      await delay(400);
      return { outcome: "inconclusive" as const, pages: [] };
    });
    coverage[scenario] = result.outcome;
    blocked ||= "blocked" in result && Boolean(result.blocked);
    if ("visit" in result && result.visit) {
      visits.push(result.visit);
      // Follow the site's own redirect (e.g. to www.) for later visits.
      if (scenario === "default")
        finalHome = new URL(new URL(result.visit.visitedUrl).origin + "/");
    }
    if (result.pages.length) pages = result.pages;
    trace(scenario, result.outcome);
  }
  onProgress({ step: "done", index: 3, total: 3 });
  const agent = navigator.userAgent;
  return {
    blocked,
    domain,
    homepageUrl: finalHome.href,
    collector: {
      browser: /Firefox\//.test(agent)
        ? "firefox"
        : /Edg\//.test(agent)
          ? "edge"
          : /Chrome\//.test(agent)
            ? "chrome"
            : "other",
      version: (
        agent.match(/(?:Firefox|Edg|Chrome)\/([\d.]+)/)?.[1] ?? ""
      ).slice(0, 40),
      extension: browser.runtime.getManifest().version.slice(0, 20),
    },
    coverage,
    visits,
    pages,
  };
}
