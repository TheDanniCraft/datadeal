import {
  isAccessInterstitial,
  isBlockPage,
  describeWebStorage,
  inspectWebStorage,
  summarizeBrowserCookies,
  storageInspectionLimit,
  webStorageSummary,
  type BrowserStorageSnapshot,
  scanLanguage,
  type scan,
} from "@datadeal/scanner";
import type {
  Browser,
  BrowserContext,
  Frame,
  Page,
  Response,
} from "playwright";
import { setTimeout as delay } from "node:timers/promises";
import { getDomain, parse } from "tldts";
import { requestFieldCollector } from "./request-fields";
import {
  isolatedIdentifierMatcher,
  readPermutiveVisitorId,
  type IsolatedIdentifierMatcher,
} from "./identifier-match";

const acceptAllName =
  /^(?:(?:accept|allow) all cookies|alle cookies (?:akzeptieren|erlauben))$/i;
const shortAcceptAllName =
  /^(?:(?:accept|allow) all|(?:alle|alles) (?:akzeptieren|erlauben))$/i;
export const consentSettleMs = 3000;

/**
 * Many trackers (Plausible, some ad tags) skip browsers that announce
 * automation through navigator.webdriver. Measuring what a real visitor
 * experiences means not announcing it.
 */
export async function asRealVisitor(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "webdriver", {
      configurable: true,
      get: () => false,
    });
  });
}

/** Chromium flags for the same reason as asRealVisitor. */
export const realVisitorLaunchArgs = [
  "--disable-blink-features=AutomationControlled",
];
const scenarios = [
  ["default", null, null],
  [
    "rejected",
    /^(?:(?:reject|decline) (?:all|optional|additional|analytics) cookies|accept only essential cookies|(?:alle|optionale) cookies ablehnen|nur notwendige cookies)$/i,
    /^(?:(?:reject|decline) (?:all|optional)|(?:alle|alles) ablehnen)$/i,
  ],
  [
    "accepted",
    new RegExp(
      `${acceptAllName.source}|^accept (?:additional|analytics) cookies$`,
      "i",
    ),
    shortAcceptAllName,
  ],
] as const;

type ConsentCoverage = NonNullable<
  Awaited<ReturnType<typeof scan>>["consentCoverage"]
>;

export const untestedConsentCoverage: Readonly<ConsentCoverage> = {
  default: "untested",
  rejected: "untested",
  accepted: "untested",
};

async function visibleFrame(frame: Frame) {
  for (
    let ancestor: Frame | null = frame;
    ancestor?.parentFrame();
    ancestor = ancestor.parentFrame()
  ) {
    const element = await ancestor.frameElement();
    try {
      if (!(await element.isVisible())) return false;
    } finally {
      await element.dispose();
    }
  }
  return true;
}

async function isMeasuredDocument(
  page: Page,
  response: Response | null | undefined,
) {
  if (!response?.ok()) return false;
  if (isBlockPage(await page.content().catch(() => ""))) return false;
  return !isAccessInterstitial(
    await page.title(),
    response.headers()["cf-mitigated"],
    (await page
      .locator(
        '#challenge-form, #challenge-stage, script[src*="/cdn-cgi/challenge-platform/"]',
      )
      .count()) > 0,
  );
}

async function findConsentControl(page: Page, name: RegExp, shortName: RegExp) {
  const deadline = performance.now() + 4000;
  let ambiguous = false;
  do {
    const matches = await Promise.all(
      page.frames().map(async (frame) => {
        try {
          if (!(await visibleFrame(frame))) return undefined;
          // Short labels also occur in unrelated dialogs (e.g. accepting invitations).
          const cookieText = /\b(?:cookies?|tracking)\b/i;
          const panels = frame
            .locator(
              'dialog, [role="dialog"], [role="alertdialog"], .cmp-banner',
            )
            .or(
              frame.getByRole("region", {
                name: /^(?:we value your privacy|(?:optional )?privacy (?:choices|settings|preferences)|cookie (?:consent|preferences|settings))$/i,
              }),
            );
          const shortControl = panels
            .filter({ has: frame.getByText(cookieText) })
            .or(panels.filter({ hasText: cookieText }))
            .or(frame.getByRole("dialog", { name: cookieText }))
            .or(frame.getByRole("alertdialog", { name: cookieText }))
            .getByRole("button", { name: shortName });
          // Some banners (e.g. recent c15t) are a plain <aside>/<div> with no
          // dialog role. Accept a short label there only inside a compact
          // container that mentions privacy and offers both an accept-type
          // and a reject- or preferences-type control, so an unrelated
          // "Accept all" (invitations, terms) does not qualify.
          const plainPanel = frame
            .locator("aside, section, footer, form, div")
            .filter({
              hasText:
                /\b(?:cookies?|tracking|privacy|datenschutz|einwilligung|consent)\b/i,
            })
            .filter({
              has: frame.getByRole("button", {
                name: /^(?:accept|allow|alle|alles)\b/i,
              }),
            })
            .filter({
              has: frame.getByRole("button", {
                name: /^(?:reject|decline|preferences|settings|customi[sz]e|manage|ablehnen|einstellungen|anpassen|nur notwendige)\b/i,
              }),
            })
            .filter({ hasNot: frame.locator("main, article, nav, header") })
            .getByRole("button", { name: shortName });
          const control = frame
            .getByRole("button", { name })
            .or(shortControl)
            .or(plainPanel)
            .filter({ visible: true });
          const count = await control.count();
          return count ? { count, control, frame } : undefined;
        } catch (error) {
          if (!frame.isDetached()) throw error;
          return undefined;
        }
      }),
    );
    const candidates = matches.filter((match) => match !== undefined);
    if (candidates.length === 1 && candidates[0].count === 1)
      return candidates[0];
    ambiguous ||= candidates.length > 0;
    await delay(100);
  } while (performance.now() < deadline);
  return ambiguous
    ? ("inconclusive" as const)
    : ("control_unavailable" as const);
}

export async function observeConsent(browser: Browser, homepage: URL) {
  return (await observeConsentWithCoverage(browser, homepage)).observations;
}

async function storageSnapshot(
  context: BrowserContext,
  page: Page,
  homepage: URL,
  matcher?: IsolatedIdentifierMatcher,
  atEnd = false,
): Promise<BrowserStorageSnapshot> {
  const [cookies, web, visitor] = await Promise.all([
    context.cookies().then((rows) => {
      if (matcher) {
        for (const cookie of rows.slice(0, storageInspectionLimit)) {
          const hostname = cookie.domain.replace(/^\./, "");
          if (
            homepage.hostname !== hostname &&
            !(
              cookie.domain.startsWith(".") &&
              homepage.hostname.endsWith("." + hostname)
            )
          )
            continue;
          if (cookie.httpOnly) continue;
          if (cookie.name === "_fbp")
            matcher.sample("fbp_cookie", cookie.value, atEnd);
          if (cookie.name === "permutive-id")
            matcher.sample("permutive_cookie", cookie.value, atEnd);
        }
      }
      return summarizeBrowserCookies(rows, homepage);
    }),
    page
      .evaluate(inspectWebStorage, {
        expectedOrigin: homepage.origin,
        limit: storageInspectionLimit,
      })
      .then(
        (inspection) =>
          webStorageSummary.safeParse(describeWebStorage(inspection)).data,
      )
      .catch(() => undefined),
    matcher
      ? page
          .evaluate(readPermutiveVisitorId, homepage.origin)
          .catch(() => undefined)
      : undefined,
  ]);
  if (visitor && web?.local.categories.includes("permutive_visitor_id"))
    matcher?.sample("permutive_local", visitor, atEnd);
  return { cookies, web };
}

export async function observeConsentWithCoverage(
  browser: Browser,
  homepage: URL,
  sampleOnSite?: URL,
  compareIdentifiers = false,
) {
  const homeDomain = getDomain(homepage.hostname, {
    allowPrivateDomains: true,
  });
  const observations: Array<{
    scenario: (typeof scenarios)[number][0];
    visitedUrl: string;
    requests: number;
    cookies: number;
    storage?: { localEntries: number; sessionEntries: number };
    storageSummary: {
      beforeChoice?: BrowserStorageSnapshot;
      end: BrowserStorageSnapshot;
    };
    freshContext: true;
    capture: {
      navigationStartedAt: string;
      beforeChoiceSnapshotAt?: string;
      endSnapshotAt: string;
      settleMs: number;
      identifierComparisonEnabled: boolean;
    };
    externalDomains: string[];
    responseDomains: string[];
    network: ReturnType<ReturnType<typeof requestFieldCollector>["results"]>;
    requestInspection: {
      examined: number;
      matched: number;
      limitReached: boolean;
    };
    afterChoice?: {
      requests: number;
      externalDomains: string[];
      acceptedAll?: boolean;
    };
  }> = [];
  const coverage = { ...untestedConsentCoverage };

  for (const [scenario, choice, shortName] of scenarios) {
    if (!browser.isConnected()) break;
    coverage[scenario] = "inconclusive";
    let context: BrowserContext | undefined;
    const matcher = compareIdentifiers
      ? isolatedIdentifierMatcher()
      : undefined;
    try {
      context = await browser.newContext({
        locale: scanLanguage,
        extraHTTPHeaders: { "Accept-Language": scanLanguage },
        acceptDownloads: false,
        serviceWorkers: "block",
      });
      await asRealVisitor(context);
      const page = await context.newPage();
      let latestDocument: Response | undefined;
      page.on("response", (response) => {
        if (
          response.request().isNavigationRequest() &&
          response.frame() === page.mainFrame()
        )
          latestDocument = response;
      });
      let requests = 0;
      let choiceStart: number | undefined;
      let acceptedAll: boolean | undefined;
      let beforeChoice: BrowserStorageSnapshot | undefined;
      let beforeChoiceSnapshotAt: string | undefined;
      const externalDomains = new Set<string>();
      const responseDomains = new Set<string>();
      const afterChoiceDomains = new Set<string>();
      const network = requestFieldCollector(homepage, matcher);
      context.on("request", (request) => {
        if (!/^https?:/.test(request.url())) return;
        requests++;
        network.request(
          request,
          choiceStart === undefined ? "before_choice" : "after_choice",
        );
        const target = parse(request.url(), { allowPrivateDomains: true });
        if (
          (target.isIcann || target.isPrivate) &&
          target.domain &&
          target.domain !== homeDomain
        ) {
          if (externalDomains.size < 20) externalDomains.add(target.domain);
          if (choiceStart !== undefined && afterChoiceDomains.size < 20)
            afterChoiceDomains.add(target.domain);
        }
      });
      context.on("response", (response) => {
        network.response(response.request());
        const target = getDomain(response.url(), { allowPrivateDomains: true });
        if (target && externalDomains.has(target)) responseDomains.add(target);
      });
      const navigationStartedAt = new Date().toISOString();
      const response = await page.goto(homepage.href, {
        waitUntil: "domcontentloaded",
        timeout: 4000,
      });
      if (
        !response?.ok() ||
        new URL(page.url()).origin !== homepage.origin ||
        !(await isMeasuredDocument(page, response))
      )
        continue;
      if (
        sampleOnSite &&
        (!/^text\/html\b/i.test(response.headers()["content-type"] ?? "") ||
          new URL(page.url()).pathname === sampleOnSite.pathname)
      )
        continue;

      if (choice) {
        const candidate = await findConsentControl(page, choice, shortName);
        if (typeof candidate === "string") {
          coverage[scenario] = candidate;
          continue;
        }
        const { control, frame } = candidate;
        await control.click({ timeout: 2000, trial: true });
        if (scenario === "accepted") {
          acceptedAll =
            (await control
              .and(
                frame
                  .getByRole("button", { name: acceptAllName })
                  .or(frame.getByRole("button", { name: shortAcceptAllName })),
              )
              .count()) === 1;
        }
        beforeChoice = await storageSnapshot(
          context,
          page,
          homepage,
          matcher,
        ).catch(() => undefined);
        if (beforeChoice) beforeChoiceSnapshotAt = new Date().toISOString();
        choiceStart = requests;
        await control.click({ timeout: 2000 });
        await control
          .waitFor({ state: "hidden", timeout: 1000 })
          .catch((error: unknown) => {
            if (!frame.isDetached()) throw error;
          });
        if (new URL(page.url()).origin !== homepage.origin) continue;
      } else {
        beforeChoice = await storageSnapshot(
          context,
          page,
          homepage,
          matcher,
        ).catch(() => undefined);
        if (beforeChoice) beforeChoiceSnapshotAt = new Date().toISOString();
      }

      await delay(consentSettleMs);
      const landed = new URL(page.url());
      if (landed.origin !== homepage.origin) continue;
      if (sampleOnSite && landed.pathname === sampleOnSite.pathname) continue;
      // A choice can make the banner disappear by navigating to an error page.
      // A successful first response does not establish coverage of that final document.
      if (!(await isMeasuredDocument(page, latestDocument))) continue;
      const end = await storageSnapshot(context, page, homepage, matcher, true);
      const endSnapshotAt = new Date().toISOString();
      const sampledAt = new URL(page.url());
      if (
        sampledAt.origin !== landed.origin ||
        sampledAt.pathname !== landed.pathname
      )
        continue;
      const cookies = end.cookies.total;
      const storage = end.web
        ? {
            localEntries: end.web.local.total,
            sessionEntries: end.web.session.total,
          }
        : undefined;
      observations.push({
        scenario,
        visitedUrl: landed.origin + landed.pathname,
        requests,
        cookies,
        storage,
        storageSummary: { beforeChoice, end },
        freshContext: true,
        capture: {
          navigationStartedAt,
          beforeChoiceSnapshotAt,
          endSnapshotAt,
          settleMs: consentSettleMs,
          identifierComparisonEnabled: compareIdentifiers,
        },
        externalDomains: [...externalDomains].sort(),
        responseDomains: [...responseDomains].sort(),
        network: network.results(),
        requestInspection: network.inspection(),
        afterChoice:
          choiceStart === undefined
            ? undefined
            : {
                requests: requests - choiceStart,
                externalDomains: [...afterChoiceDomains].sort(),
                ...(acceptedAll !== undefined && { acceptedAll }),
              },
      });
      coverage[scenario] = "measured";
    } catch {
      // An interrupted visit provides no consent measurement.
    } finally {
      matcher?.clear();
      await context?.close().catch(() => undefined);
    }
  }

  return { observations, coverage };
}

export async function measureContentPages(
  browser: Browser,
  report: Awaited<ReturnType<typeof scan>>,
  homepage: URL,
  renewLease: () => Promise<boolean>,
  compareIdentifiers = false,
) {
  for (const [index, sample] of (report.pageSample?.pages ?? []).entries()) {
    const requested = new URL(sample.url);
    if (requested.origin !== homepage.origin || !(await renewLease())) break;
    const { coverage, observations } = await observeConsentWithCoverage(
      browser,
      requested,
      homepage,
      compareIdentifiers,
    );
    sample.coverage = coverage;
    for (const { scenario, visitedUrl, ...visit } of observations) {
      const outside = visit.externalDomains.length;
      report.evidence.push({
        id: `browser-page-${index + 1}-${scenario}`,
        kind: "observed_technical",
        consentScenario: scenario,
        url: visitedUrl,
        retrievedAt: new Date().toISOString(),
        scanId: report.id,
        excerpt: `This ${scenario} visit to ${new URL(visitedUrl).pathname} attempted ${visit.requests} HTTP requests and reached out to ${outside === 20 ? "at least " : ""}${outside} outside domains. The isolated browser held ${visit.cookies} cookies at the end. No forms were submitted.`,
        observation: {
          type: "browser_content_page",
          finalPageKnown: true,
          ...visit,
        },
      });
    }
  }
}
