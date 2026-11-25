type PublisherPrivacy = {
  setPrivacySettings?(settings: {
    limitedAds: boolean;
    restrictDataProcessing: boolean;
  }): void;
};

// Manual limited ads require Google's separate loader. A loaded standard GPT
// cannot be switched to limited mode in the same document.
export function publisherScript(limited: boolean) {
  const url = limited
    ? "https://pagead2.googlesyndication.com/tag/js/gpt.js"
    : "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
  const existing = document.querySelector<HTMLScriptElement>(
    "script[data-datadeal-gpt]",
  );
  if (existing) return existing.src === url ? existing : undefined;
  if (
    limited &&
    (window as Window & { googletag?: { apiReady?: boolean } }).googletag
      ?.apiReady
  )
    return;
  const script = document.createElement("script");
  script.dataset.datadealGpt = "";
  script.src = url;
  script.async = true;
  if (!limited) script.crossOrigin = "anonymous";
  script.addEventListener("error", () => script.remove(), { once: true });
  return script;
}

export function configurePublisherPrivacy(
  publisher: PublisherPrivacy,
  limited: boolean,
) {
  if (!limited) return true;
  if (!publisher.setPrivacySettings) return false;
  publisher.setPrivacySettings({
    limitedAds: true,
    restrictDataProcessing: true,
  });
  return true;
}

export type { PublisherPrivacy };
