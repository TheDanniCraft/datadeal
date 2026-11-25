import { browser } from "wxt/browser";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { gradeColors, type Rating } from "../lib/popup-rating";

declare const DATADEAL_REPORT_ORIGIN: string;

const intentPath =
  /(?:^|\/)(?:sign[-_]?(?:in|up)|log[-_]?in|create[-_]?account|register|registration|checkout|payment)(?:[/.\-_]|$)/i;
const purposeField =
  'input[type="password" i], input[autocomplete~="current-password" i], input[autocomplete~="new-password" i], input[autocomplete~="cc-number" i]';
const checkoutOrSignupField =
  'input[type="email" i], input[type="password" i], input[autocomplete~="email" i], input[autocomplete^="cc-" i]';

function findForm() {
  const selector = intentPath.test(location.pathname)
    ? purposeField + ", " + checkoutOrSignupField
    : purposeField;
  for (const field of document.querySelectorAll<HTMLInputElement>(selector)) {
    if (
      field.form &&
      !field.disabled &&
      field.getClientRects().length &&
      !field.closest("[inert], [hidden]")
    )
      return field.form;
  }
}

function makeHint(
  domain: string,
  rating: Rating | null,
  unavailable: boolean,
  dismiss: () => void,
) {
  const host = document.createElement("aside");
  host.setAttribute("aria-label", "DataDeal form reminder");
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; display: block; color-scheme: light dark; margin-block: 8px; }
    div { display: inline-flex; align-items: center; gap: 6px; min-height: 32px;
          padding: 2px 6px; border-radius: 8px; background: Canvas; color: CanvasText;
          border: 1px solid color-mix(in srgb, CanvasText 24%, Canvas); font: 13px/1.4 system-ui,sans-serif; }
    button { font: inherit; color: inherit; background: transparent; border: 0; padding: 2px; cursor: pointer; }
    button:first-child { display: inline-flex; align-items: center; gap: 7px; }
    strong { color: white; background: #53515f; border-radius: 5px; padding: 2px 6px; font-weight: 650; }
    button:last-child { min-width: 24px; min-height: 24px; color: GrayText; font-size: 18px; }
    button:focus-visible { outline: 2px solid Highlight; outline-offset: 1px; }
  `;
  const row = document.createElement("div");
  const check = document.createElement("button");
  check.type = "button";
  const number = document.createElement("strong");
  const label = document.createElement("span");
  check.append(number, label);
  function updateRating(rating: Rating | null, unavailable = false) {
    number.hidden = !rating;
    if (rating) {
      number.textContent = rating.score + "/100";
      number.style.backgroundColor = gradeColors[rating.grade];
    }
    label.textContent =
      "DataDeal · " +
      (rating?.grade ?? (unavailable ? "Score unavailable" : "Unrated"));
    check.setAttribute(
      "aria-label",
      "Open the DataDeal privacy report for " +
        domain +
        ". " +
        (rating
          ? rating.score + " out of 100. " + rating.grade
          : label.textContent),
    );
  }
  updateRating(rating, unavailable);
  check.addEventListener("click", (event) => {
    if (event.isTrusted)
      window.open(
        DATADEAL_REPORT_ORIGIN + "/report/" + encodeURIComponent(domain),
        "_blank",
        "noopener,noreferrer",
      );
  });
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss DataDeal score");
  close.addEventListener("click", dismiss);
  row.append(check, close);
  root.append(style, row);
  return { host, updateRating };
}

export default defineUnlistedScript(() => {
  if (window !== window.top || browser.extension.inIncognitoContext) return;
  const scope = globalThis as typeof globalThis & {
    dataDealFormReminder?: boolean;
  };
  if (scope.dataDealFormReminder) return;
  scope.dataDealFormReminder = true;
  void browser.runtime
    .sendMessage({ type: "form-reminder-permitted" })
    .then((site) => {
      if (!site?.domain) {
        delete scope.dataDealFormReminder;
        return;
      }
      let frame = 0;
      let dismissed = false;
      const { host: hint, updateRating } = makeHint(
        site.domain,
        site.rating,
        site.unavailable,
        () => {
          dismissed = true;
          stopWatching();
        },
      );
      function refresh() {
        frame = 0;
        if (dismissed) return;
        const form = findForm();
        if (!form) hint.remove();
        else {
          const submit = Array.from(
            form.querySelectorAll<HTMLElement>(
              'button:not([type]), button[type="submit" i], input[type="submit" i], input[type="image" i]',
            ),
          ).find(
            (button) =>
              button.getClientRects().length &&
              !button.closest("[hidden], [inert]"),
          );
          if (submit) {
            if (submit.nextElementSibling !== hint) submit.after(hint);
          } else if (form.nextElementSibling !== hint) form.after(hint);
        }
      }
      function schedule() {
        if (!frame && !dismissed) frame = requestAnimationFrame(refresh);
      }
      const observer = new MutationObserver(schedule);
      function stopWatching() {
        observer.disconnect();
        window.removeEventListener("popstate", schedule);
        cancelAnimationFrame(frame);
        hint.remove();
      }
      function onRevoked(message: {
        type?: string;
        revoked?: string[];
        domain?: string;
        rating?: Rating | null;
      }) {
        if (
          message?.type === "form-score-update" &&
          message.domain === site.domain
        ) {
          updateRating(message.rating ?? null);
          return;
        }
        if (
          message?.type !== "remove-form-reminder" ||
          !message.revoked?.includes(site.id)
        )
          return;
        stopWatching();
        browser.runtime.onMessage.removeListener(onRevoked);
        delete scope.dataDealFormReminder;
      }
      browser.runtime.onMessage.addListener(onRevoked);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "type",
          "autocomplete",
          "hidden",
          "inert",
          "disabled",
          "form",
        ],
      });
      window.addEventListener("popstate", schedule);
      refresh();
    })
    .catch(() => {
      delete scope.dataDealFormReminder;
    });
});
