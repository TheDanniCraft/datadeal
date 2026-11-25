/*
 * DataDeal ad diagnostics. Paste into the browser console on a report page,
 * e.g. http://localhost:3000/report/bild.de (Firefox/Zen: type
 * "allow pasting" first). It runs the checks, then keeps listening for
 * React warnings and ad events. Click "Watch an ad to unlock" and run
 * ddReport() afterwards; the result is copied to the clipboard.
 */
(async () => {
  const log = [];
  const note = (kind, detail) => log.push({ t: Math.round(performance.now()), kind, detail });

  // 1. Capture React warnings with their component stack from now on.
  const original = console.error;
  console.error = (...args) => {
    const text = args.map(String).join(" ");
    if (/React|mounted|hydrat|key/i.test(text)) note("console.error", text.slice(0, 2000));
    return original.apply(console, args);
  };
  addEventListener("error", (e) => note("window.error", `${e.message} @ ${e.filename}:${e.lineno}`));
  addEventListener("unhandledrejection", (e) => note("rejection", String(e.reason).slice(0, 500)));

  // 2. Can the ad hosts be reached at all? A blocked script fires onerror.
  const probe = (src) =>
    new Promise((resolve) => {
      const s = document.createElement("script");
      const timer = setTimeout(() => (s.remove(), resolve("timeout")), 8000);
      s.onload = () => (clearTimeout(timer), s.remove(), resolve("loaded"));
      s.onerror = () => (clearTimeout(timer), s.remove(), resolve("BLOCKED"));
      s.src = src + (src.includes("?") ? "&" : "?") + "dd=" + Date.now();
      document.head.append(s);
    });
  const hosts = {
    gpt: "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
    adsense: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
    ima: "https://imasdk.googleapis.com/js/sdkloader/ima3.js",
  };
  const reach = {};
  for (const [name, src] of Object.entries(hosts)) reach[name] = await probe(src);

  // 3. Cosmetic ad-blocker bait.
  const bait = document.createElement("div");
  bait.className = "adsbox ad-banner ad-slot pub_300x250 textads";
  bait.style.cssText = "position:absolute;left:-9999px;width:300px;height:250px";
  document.body.append(bait);
  await new Promise((r) => setTimeout(r, 300));
  const baitHidden = bait.offsetHeight === 0 || getComputedStyle(bait).display === "none";
  bait.remove();

  // 4. Autoplay: rewarded video needs at least muted autoplay.
  let autoplay = navigator.getAutoplayPolicy?.("mediaelement") ?? "unknown";
  if (autoplay === "unknown") {
    const v = document.createElement("video");
    v.muted = true;
    v.src = "data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAAhmcmVl";
    autoplay = await v.play().then(() => "muted-allowed", (e) => "blocked: " + e.name);
  }

  // 5. Google Publisher Tag state on this page.
  const gt = window.googletag;
  const slots = gt?.pubads?.()
    ?.getSlots?.()
    .map((s) => {
      const info = s.getResponseInformation?.();
      const el = document.getElementById(s.getSlotElementId());
      return {
        unit: s.getAdUnitPath(),
        element: s.getSlotElementId(),
        filled: !!info,
        iframe: !!el?.querySelector("iframe"),
        height: el ? Math.round(el.getBoundingClientRect().height) : null,
      };
    });
  gt?.cmd?.push?.(() => {
    gt.pubads().addEventListener("slotRenderEnded", (e) =>
      note("slotRenderEnded", { unit: e.slot.getAdUnitPath(), empty: e.isEmpty }),
    );
    for (const ev of ["rewardedSlotReady", "rewardedSlotGranted", "rewardedSlotClosed", "slotRequested"])
      gt.pubads().addEventListener(ev, (e) => note(ev, e.slot?.getAdUnitPath?.()));
  });

  // 6. Network entries for Google ad hosts (transferSize 0 + tiny duration ≈ blocked).
  const network = performance
    .getEntriesByType("resource")
    .filter((r) => /doubleclick|googlesyndication|googleads|imasdk|adtrafficquality/.test(r.name))
    .map((r) => ({ url: r.name.slice(0, 90), size: r.transferSize, ms: Math.round(r.duration) }));

  // 7. Consent as the page stores it.
  const consent = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (/c15t|consent|privacy/i.test(k)) consent["localStorage:" + k] = localStorage.getItem(k)?.slice(0, 400);
  }
  for (const c of document.cookie.split("; "))
    if (/c15t|consent|privacy/i.test(c)) consent["cookie:" + c.split("=")[0]] = c.slice(c.indexOf("=") + 1, 400);

  const summary = {
    page: location.href,
    userAgent: navigator.userAgent,
    globalPrivacyControl: navigator.globalPrivacyControl ?? null,
    doNotTrack: navigator.doNotTrack,
    cookiesEnabled: navigator.cookieEnabled,
    reach,
    cosmeticAdBlocker: baitHidden,
    autoplay,
    googletagLoaded: !!gt?.apiReady,
    gptVersion: gt?.getVersion?.() ?? null,
    slots: slots ?? [],
    network,
    consent,
  };

  window.ddReport = () => {
    const out = JSON.stringify({ ...summary, events: log }, null, 2);
    try {
      copy(out);
      console.log("DataDeal diagnostics copied to the clipboard.");
    } catch {
      console.log(out);
    }
    return { ...summary, events: log };
  };

  const verdicts = [];
  if (Object.values(reach).includes("BLOCKED"))
    verdicts.push("An ad host is blocked: an ad-blocking extension, DNS filter (Pi-hole, NextDNS) or the browser's tracking protection.");
  if (baitHidden) verdicts.push("A cosmetic ad blocker hides ad-shaped elements.");
  if (String(autoplay).startsWith("disallowed") || String(autoplay).startsWith("blocked"))
    verdicts.push("Video autoplay is blocked, so the rewarded video can't start. Allow audio and video for this site.");
  if (summary.globalPrivacyControl) verdicts.push("Global Privacy Control is on: DataDeal only shows limited ads after a separate choice.");
  if (!summary.googletagLoaded) verdicts.push("Google Publisher Tag is not running on this page.");
  console.log("%cDataDeal ad diagnostics", "font-weight:bold;font-size:14px");
  console.table(reach);
  console.log(summary);
  console.log(verdicts.length ? verdicts.join("\n") : "No blocker found from this page.");
  console.log("Now try the ad (Watch an ad to unlock), then run ddReport() and paste the result.");
})();
