"use client";

import { useAdvertisingConsent } from "../../lib/ads/use-advertising-consent";
import { Tabs } from "@heroui/react";
import { useSyncExternalStore } from "react";

const browserGuides = [
  {
    browser: "Firefox",
    instructions:
      "In Settings → Privacy & Security, look for “Tell websites not to sell or share my data.” That switch sends GPC. Open the shield beside the address bar to see what Enhanced Tracking Protection blocked on this site.",
    sources: [
      [
        "Global Privacy Control in Firefox",
        "https://support.mozilla.org/en-US/kb/global-privacy-control",
      ],
      [
        "Firefox tracking protection",
        "https://support.mozilla.org/en-US/kb/enhanced-tracking-protection-firefox-desktop",
      ],
    ],
  },
  {
    browser: "Chrome",
    instructions:
      "In Settings → Privacy and security → Third-party cookies & site data, look under Site requests for the opt-out request. Google is rolling this out to eligible profiles in California. Do Not Track is a separate preference. To inspect an ad blocker, open Extensions → Manage extensions.",
    sources: [
      [
        "Chrome opt-out requests",
        "https://support.google.com/chrome/answer/18797212",
      ],
      [
        "Manage Chrome extensions",
        "https://support.google.com/chrome/answer/2664769",
      ],
    ],
  },
  {
    browser: "Microsoft Edge",
    instructions:
      "In Settings → Privacy, search, and services, open Privacy → Global Privacy Control. Microsoft documents this option for the US. In the same settings area, Tracking prevention controls which trackers Edge blocks.",
    sources: [
      [
        "Global Privacy Control in Edge",
        "https://support.microsoft.com/en-us/edge/global-privacy-control-in-microsoft-edge",
      ],
      [
        "Edge tracking prevention",
        "https://support.microsoft.com/en-us/edge/learn-about-tracking-prevention-in-microsoft-edge",
      ],
    ],
  },
  {
    browser: "Safari on Mac",
    instructions:
      "In Safari → Settings → Privacy, “Prevent cross-site tracking” limits tracking by third-party content providers. To check an installed content blocker, open Safari → Settings → Extensions. These controls manage what loads or persists in Safari.",
    sources: [
      [
        "Safari cross-site tracking",
        "https://support.apple.com/guide/safari/prevent-cross-site-tracking-sfri40732/mac",
      ],
      [
        "Safari extensions",
        "https://support.apple.com/guide/safari/get-extensions-sfri32508/mac",
      ],
    ],
  },
];

const disclosureStyles =
  "divide-y divide-separator [&_summary]:min-h-11 [&_summary]:py-3 [&_summary]:font-medium [&_summary]:text-foreground [&_details>p]:pb-3 [&_p]:leading-relaxed";

const subscribe = () => () => {};
function BrowserGuidance() {
  const interactive = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const guides = browserGuides.map(({ browser, instructions, sources }) => ({
    browser,
    label:
      browser === "Microsoft Edge"
        ? "Edge"
        : browser === "Safari on Mac"
          ? "Safari"
          : browser,
    content: (
      <>
        <p className="leading-relaxed">{instructions}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {sources.map(([label, href]) => (
            <a key={href} className="inline-link" href={href}>
              {label}
            </a>
          ))}
        </div>
      </>
    ),
  }));
  if (!interactive)
    return (
      <div className={disclosureStyles}>
        {guides.map((guide) => (
          <details key={guide.browser}>
            <summary>{guide.browser}</summary>
            {guide.content}
          </details>
        ))}
      </div>
    );
  return (
    <Tabs defaultSelectedKey="Firefox" className="w-full">
      <Tabs.ListContainer className="max-w-full">
        <Tabs.List aria-label="Desktop browser">
          {guides.map((guide) => (
            <Tabs.Tab
              id={guide.browser}
              key={guide.browser}
              aria-label={guide.browser}
              className="min-h-11 px-3"
            >
              {guide.label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
      {guides.map((guide) => (
        <Tabs.Panel id={guide.browser} key={guide.browser} className="pt-3">
          {guide.content}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

export function AdvertisingPrivacyHelp() {
  const consent = useAdvertisingConsent();
  const status = {
    "privacy-signal":
      "Personalized advertising is off under Global Privacy Control. Limited Google ads require a separate choice in Privacy settings when available.",
    limited:
      "You’ve allowed limited Google ads. Google receives technical information such as your IP address to serve ads without personalization. Watching a rewarded ad is a separate choice.",
    allowed:
      "You’ve allowed Google advertising. Ads can appear on eligible free reports, and you can change this choice in Privacy settings.",
    "needs-choice":
      "Google advertising is off until you allow it in Privacy settings.",
  };
  return (
    <section id="browser-privacy" className="scroll-mt-6 space-y-3">
      <h2 className="mt-8 text-2xl">Browser privacy settings</h2>
      <p aria-live="polite">{status[consent]}</p>
      <p>
        Global Privacy Control (GPC) asks sites to limit the sale or sharing of
        your data. Tracking protection can block known trackers. An ad-blocking
        extension can also stop an ad request. You can keep these protections on
        and read the free report.
      </p>
      <h3 className="pt-2 font-medium">Check your desktop browser</h3>
      <BrowserGuidance />
    </section>
  );
}

export function AdvertisingFaq() {
  return (
    <div className={disclosureStyles}>
      <details id="independence">
        <summary>Why does DataDeal use advertising?</summary>
        <p>
          Website scans, storage, and keeping the service running cost money.
          Ads and subscriptions fund the service so anyone can read the core
          report.
        </p>
      </details>
      <details id="rating">
        <summary>How would advertising affect DataDeal’s own rating?</summary>
        <p>
          DataDeal applies the same evidence rules to itself. An assessment
          should show what changes when visitors accept advertising, reject it,
          or use a signed-in Pro account.
        </p>
      </details>
    </div>
  );
}
