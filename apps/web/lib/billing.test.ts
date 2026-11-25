import { expect, it } from "vitest";
import { checkoutBinding, matchesSignature, signature } from "./billing";

it("binds Creem signatures to the exact raw bytes and checkout metadata", () => {
  const secret = "test-secret";
  const raw = new TextEncoder().encode('{"eventType":"subscription.paid"}');
  const signed = signature(secret, raw);
  expect(matchesSignature(signature(secret, raw), signed)).toBe(true);
  expect(
    matchesSignature(
      signature(secret, '{"eventType": "subscription.paid"}'),
      signed,
    ),
  ).toBe(false);
  expect(matchesSignature(signed, "bad-signature")).toBe(false);
  expect(checkoutBinding(secret, "user-a", "prod-a")).not.toBe(
    checkoutBinding(secret, "user-b", "prod-a"),
  );
});
