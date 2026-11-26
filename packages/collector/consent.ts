/**
 * Consent-button rules shared by the Playwright worker and the browser
 * extension, so both collectors press the same controls.
 */
export const acceptAllName =
  /^(?:(?:accept|allow) all cookies|alle cookies (?:akzeptieren|erlauben))$/i;
export const shortAcceptAllName =
  /^(?:(?:accept|allow) all|(?:alle|alles) (?:akzeptieren|erlauben))$/i;
export const rejectName =
  /^(?:(?:reject|decline) (?:all|optional|additional|analytics) cookies|accept only essential cookies|(?:alle|optionale) cookies ablehnen|nur notwendige cookies)$/i;
export const shortRejectName =
  /^(?:(?:reject|decline) (?:all|optional)|(?:alle|alles) ablehnen)$/i;
export const acceptName = new RegExp(
  `${acceptAllName.source}|^accept (?:additional|analytics) cookies$`,
  "i",
);
export const consentSettleMs = 3000;

export type ConsentChoice = "rejected" | "accepted";

/** Pattern sources for one choice, passed into injected page code. */
export function consentPatterns(choice: ConsentChoice) {
  const [name, short] =
    choice === "accepted"
      ? [acceptName, shortAcceptAllName]
      : [rejectName, shortRejectName];
  return { name: name.source, short: short.source };
}

/**
 * Runs inside one frame of the page (extension: scripting.executeScript).
 * Must stay self-contained: no imports, no outer variables.
 *
 * "count" returns how many matching visible controls this frame has;
 * "click" clicks the single match and reports whether it did.
 */
export function consentControlInFrame(input: {
  name: string;
  short: string;
  mode: "count" | "click";
}): number {
  const name = new RegExp(input.name, "i");
  const short = new RegExp(input.short, "i");
  const cookieText = /\b(?:cookies?|tracking)\b/i;
  const privacyText =
    /\b(?:cookies?|tracking|privacy|datenschutz|einwilligung|consent)\b/i;
  const acceptType = /^(?:accept|allow|alle|alles)\b/i;
  const otherType =
    /^(?:reject|decline|preferences|settings|customi[sz]e|manage|ablehnen|einstellungen|anpassen|nur notwendige)\b/i;
  const label = (element: Element) =>
    (
      element.getAttribute("aria-label") ||
      (element as HTMLElement).innerText ||
      (element as HTMLInputElement).value ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      box.width > 0 &&
      box.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity) > 0
    );
  };
  const buttons = Array.from(
    document.querySelectorAll(
      'button, [role="button"], input[type="button"], input[type="submit"]',
    ),
  ).filter(visible);
  const inConsentPanel = (element: Element) => {
    const panel = element.closest(
      'dialog, [role="dialog"], [role="alertdialog"], .cmp-banner',
    );
    if (panel && cookieText.test((panel as HTMLElement).innerText ?? ""))
      return true;
    // A plain <aside>/<div> banner: compact, mentions privacy, and offers
    // both an accept-type and a reject- or settings-type control.
    let node = element.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      if (!/^(?:ASIDE|SECTION|FOOTER|FORM|DIV)$/.test(node.tagName)) continue;
      if (node.querySelector("main, article, nav, header")) return false;
      if (!privacyText.test(node.innerText ?? "")) continue;
      const labels = Array.from(
        node.querySelectorAll('button, [role="button"]'),
      ).map(label);
      if (
        labels.some((text) => acceptType.test(text)) &&
        labels.some((text) => otherType.test(text))
      )
        return true;
    }
    return false;
  };
  const matches = buttons.filter((element) => {
    const text = label(element);
    return name.test(text) || (short.test(text) && inConsentPanel(element));
  });
  if (input.mode === "count") return matches.length;
  if (matches.length !== 1) return 0;
  (matches[0] as HTMLElement).click();
  return 1;
}
