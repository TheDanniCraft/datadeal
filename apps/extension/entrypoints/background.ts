import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { exactReminderSites, reminderSite } from "../lib/reminder-site";
import { getDomain } from "tldts";
import { domainLookup, siteDomain } from "@datadeal/contracts";
import { gradeColors, publishedRating, type Rating } from "../lib/popup-rating";

declare const DATADEAL_REPORT_ORIGIN: string;

const script = "/form-reminder.js";

async function clearOpenReminders(revoked: string[]) {
  if (!revoked.length) return;
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? undefined
        : browser.tabs
            .sendMessage(
              tab.id,
              { type: "remove-form-reminder", revoked },
              { frameId: 0 },
            )
            .catch(() => {}),
    ),
  );
}

export default defineBackground(() => {
  // DataDeal's report page asks for a browser scan through the bridge
  // content script; the scan runs on an extension page so it can request
  // permissions and open a private window.
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    const data = message as { type?: string; domain?: unknown };
    if (data?.type !== "datadeal-open-browser-scan") return;
    const domain = siteDomain.safeParse(data.domain);
    const tabId = sender.tab?.id;
    if (
      !domain.success ||
      tabId === undefined ||
      !sender.url ||
      new URL(sender.url).origin !== new URL(DATADEAL_REPORT_ORIGIN).origin
    )
      return;
    void browser.tabs.create({
      url:
        browser.runtime.getURL("/scan.html") +
        "?domain=" +
        encodeURIComponent(domain.data) +
        "&tab=" +
        tabId,
      index: (sender.tab?.index ?? 0) + 1,
    });
  });
  const action = browser.action ?? browser.browserAction;
  const activeUpdates = new Map<number, symbol>();
  const popupResults = new Map<
    number,
    { domain: string; rating: Rating | null }
  >();
  function changeBadge(tabId: number, domain: string, rating: Rating | null) {
    const updates = [
      action.setBadgeText({ tabId, text: rating ? String(rating.score) : "" }),
      action.setTitle({
        tabId,
        title: rating
          ? `DataDeal · ${domain} · ${rating.score}/100 · ${rating.grade}`
          : "DataDeal",
      }),
    ];
    if (rating)
      updates.push(
        action.setBadgeBackgroundColor({
          tabId,
          color: gradeColors[rating.grade],
        }),
      );
    return Promise.all(updates);
  }
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== "loading") return;
    activeUpdates.delete(tabId);
    popupResults.delete(tabId);
    // Works even after service-worker suspension and on origins we cannot read.
    void changeBadge(tabId, "", null).catch(() => {});
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    activeUpdates.delete(tabId);
    popupResults.delete(tabId);
  });

  async function registeredScoreSite(url: string | undefined) {
    const site = reminderSite(url);
    if (!site) return;
    const [preference, permission] = await Promise.all([
      browser.storage.local.get(site.preference),
      browser.permissions.getAll(),
    ]);
    if (
      preference[site.preference] === true &&
      permission.origins?.includes(site.pattern)
    )
      return site;
  }
  async function loadSiteRating(tabId: number, url: string) {
    const site = await registeredScoreSite(url);
    if (!site) return null;
    const update = Symbol();
    activeUpdates.set(tabId, update);
    let rating: Rating | null = null;
    let unavailable = false;
    try {
      const response = await fetch(
        DATADEAL_REPORT_ORIGIN +
          "/api/v1/domains/" +
          encodeURIComponent(site.domain),
        {
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) throw Error("Report unavailable");
      const result = domainLookup.parse(await response.json());
      if (result.domain !== site.domain) throw Error("Domain mismatch");
      rating = publishedRating(result.report);
    } catch {
      unavailable = true;
    }
    const tab = await browser.tabs.get(tabId);
    if (tab.incognito || (await registeredScoreSite(tab.url))?.id !== site.id)
      return null;
    if (activeUpdates.get(tabId) !== update) {
      const latest = popupResults.get(tabId);
      return latest?.domain === site.domain
        ? { id: site.id, ...latest, unavailable: false }
        : null;
    }
    await changeBadge(tabId, site.domain, rating);
    return { id: site.id, domain: site.domain, rating, unavailable };
  }
  // A permission prompt can close a browser-action popup. The background
  // context owns the durable registration independently of the popup lifetime.
  let pending = Promise.resolve();
  function synchronize(refreshOpen = false) {
    const update = pending.then(async () => {
      const { origins = [] } = await browser.permissions.getAll();
      const eligible = exactReminderSites(origins);
      const preferences = await browser.storage.local.get(
        eligible.map((site) => site.preference),
      );
      const sites = eligible.filter(
        (site) => preferences[site.preference] === true,
      );
      const registered = await browser.scripting.getRegisteredContentScripts();
      const obsolete = registered.filter(
        ({ id }) =>
          id.startsWith("form-reminder-") &&
          !sites.some((site) => site.id === id),
      );
      if (obsolete.length) {
        await browser.scripting.unregisterContentScripts({
          ids: obsolete.map((row) => row.id),
        });
        await clearOpenReminders(obsolete.map((row) => row.id));
      }
      for (const site of sites) {
        if (registered.some((row) => row.id === site.id)) {
          if (!refreshOpen) continue;
        } else
          await browser.scripting.registerContentScripts([
            {
              id: site.id,
              matches: [site.pattern],
              js: [script],
              runAt: "document_idle",
              allFrames: false,
            },
          ]);
        const tabs = await browser.tabs.query({ url: site.pattern });
        await Promise.all(
          tabs.map((tab) =>
            tab.id === undefined || tab.incognito
              ? undefined
              : browser.scripting
                  .executeScript({
                    target: { tabId: tab.id },
                    files: [script],
                  })
                  .catch(() => {}),
          ),
        );
      }
    });
    pending = update.catch(() =>
      console.warn("DataDeal could not update form reminders."),
    );
    return update;
  }
  browser.permissions.onAdded.addListener(() => synchronize());
  browser.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      Object.keys(changes).some((key) => key.startsWith("formScore:"))
    )
      void synchronize();
  });
  browser.permissions.onRemoved.addListener(({ origins = [] }) => {
    // Unregistering only affects future documents. Clear open reminders even
    // if the browser already discarded the registration after revocation.
    void clearOpenReminders(
      exactReminderSites(origins).map((site) => site.id),
    ).catch(() => {});
    void browser.storage.local
      .remove(exactReminderSites(origins).map((site) => site.preference))
      .catch(() => {});
    return synchronize();
  });
  browser.runtime.onInstalled.addListener(() => synchronize(true));
  browser.runtime.onStartup.addListener(() => synchronize(true));
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      message?.type === "form-reminder-permitted" &&
      sender.tab &&
      !sender.tab.incognito &&
      sender.frameId === 0
    ) {
      if (sender.tab.id !== undefined && sender.url) {
        void loadSiteRating(sender.tab.id, sender.url)
          .then(respond)
          .catch(() => respond(null));
        return true;
      }
    }
    if (
      message?.type === "popup-report-score" &&
      sender.url === browser.runtime.getURL("/popup.html") &&
      Number.isInteger(message.tabId) &&
      typeof message.domain === "string"
    ) {
      const { tabId, domain, rating } = message as {
        tabId: number;
        domain: string;
        rating: Rating | null;
      };
      const update = Symbol();
      activeUpdates.set(tabId, update);
      void browser.tabs
        .get(tabId)
        .then(async (tab) => {
          if (!tab.url || tab.incognito || activeUpdates.get(tabId) !== update)
            return;
          const url = new URL(tab.url);
          if (
            !["http:", "https:"].includes(url.protocol) ||
            getDomain(url.hostname, { allowPrivateDomains: true }) !== domain
          )
            return;
          popupResults.set(tabId, { domain, rating });
          await changeBadge(tabId, domain, rating);
          await browser.tabs
            .sendMessage(
              tabId,
              { type: "form-score-update", domain, rating },
              { frameId: 0 },
            )
            .catch(() => {});
        })
        .then(() => respond(true))
        .catch(() => respond(false));
      return true;
    }
    if (
      message?.type === "sync-form-reminders" &&
      sender.url === browser.runtime.getURL("/popup.html")
    ) {
      void synchronize()
        .then(() => respond(true))
        .catch(() => respond(false));
      return true;
    }
  });
});
