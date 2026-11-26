import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";

/**
 * Lets DataDeal's own report pages talk to the extension: check that it is
 * installed, start a browser scan, and hand the result back to the page,
 * which uploads it like any other request from the site. Runs only on
 * DataDeal's origin; messages from anywhere else are ignored.
 */
export default defineContentScript({
  matches:
    import.meta.env.COMMAND === "serve" ||
    import.meta.env.WXT_DATADEAL_LOCAL === "true"
      ? ["http://localhost/*"]
      : ["https://datadeal.app/*"],
  main() {
    const announce = () =>
      window.postMessage(
        {
          source: "datadeal-extension",
          type: "pong",
          version: browser.runtime.getManifest().version,
        },
        location.origin,
      );
    // The page may have asked before this script loaded.
    announce();
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        domain?: string;
      };
      if (data?.source !== "datadeal-page") return;
      if (data.type === "ping") announce();
      if (data.type === "scan" && typeof data.domain === "string")
        void browser.runtime.sendMessage({
          type: "datadeal-open-browser-scan",
          domain: data.domain,
        });
    });
    browser.runtime.onMessage.addListener((message: unknown) => {
      const data = message as { type?: string; upload?: unknown };
      if (data?.type !== "datadeal-browser-scan-result") return;
      window.postMessage(
        { source: "datadeal-extension", type: "result", upload: data.upload },
        location.origin,
      );
    });
  },
});
