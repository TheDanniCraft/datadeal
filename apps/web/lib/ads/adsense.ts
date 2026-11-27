// Public seller identifier supplied by the DataDeal publisher in AdSense.
export const adsensePublisher = "pub-6207651722352023";
export const adsenseClient = `ca-${adsensePublisher}`;
/** Loads AdSense ads and Google's certified consent message (IAB TCF). */
export const adsenseScriptUrl = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`;

export const adsenseScriptId = "datadeal-adsense";

/** AdSense is opt-in so local development stays free of Google requests. */
export function adsenseEnabled() {
  return process.env.DATADEAL_ADSENSE === "true";
}

function slot(value: string | undefined) {
  const id = value?.trim();
  return id && /^[0-9]{5,20}$/.test(id) ? id : undefined;
}

export type AdSenseSlots = { banner?: string; rail?: string };

/** Ad unit ids from AdSense. A placement without one renders nothing. */
export function adsenseSlots(): AdSenseSlots | undefined {
  if (!adsenseEnabled()) return;
  const slots = {
    banner: slot(process.env.DATADEAL_ADSENSE_SLOT_BANNER),
    rail: slot(process.env.DATADEAL_ADSENSE_SLOT_RAIL),
  };
  return slots.banner || slots.rail ? slots : undefined;
}

/** Google's sample GPT display unit, only used in local development. */
export const sampleDisplayUnit = "/6355419/Travel/Europe/France/Paris";
