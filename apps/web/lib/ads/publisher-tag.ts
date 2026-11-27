// Google Publisher Tag is used only for Google's sample units in local
// development (DATADEAL_LOCAL_SAMPLE_ADS=true). Live display ads use AdSense.
export function publisherScript() {
  const url = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
  const existing = document.querySelector<HTMLScriptElement>(
    "script[data-datadeal-gpt]",
  );
  if (existing) return existing;
  const script = document.createElement("script");
  script.dataset.datadealGpt = "";
  script.src = url;
  script.async = true;
  script.crossOrigin = "anonymous";
  script.addEventListener("error", () => script.remove(), { once: true });
  return script;
}
