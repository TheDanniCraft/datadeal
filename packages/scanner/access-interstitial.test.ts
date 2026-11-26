import { expect, test } from "vitest";
import { isBlockPage } from "./access-interstitial";

test("recognises a self-solving challenge form and a network block page", () => {
  const reddit = `<html><head><title>Reddit</title><script>document.addEventListener("DOMContentLoaded",async function(){var e=document.forms[0];e.elements.namedItem("solution").value=n,e.requestSubmit()})</script></head><body><form method="post"><input type="hidden" name="solution"></form></body></html>`;
  expect(isBlockPage(reddit)).toBe(true);
  expect(isBlockPage("<p>You've been blocked by network security.</p>")).toBe(
    true,
  );
  expect(
    isBlockPage(`<form><input name="q"><button>Search</button></form>`),
  ).toBe(false);
});
