import { expect, it } from "vitest";
import { accountReturnPath } from "./account-return";
import { checkoutReference, proCheckoutReference } from "./checkout-return";

it("restores only a single well-formed purchase reference across sign-in", () => {
  for (const path of [
    "/account/billing?subscription_id=sub_42",
    "/account/billing/return",
    "/account/billing?view=plans",
    "/account/billing/return?checkout_id=ch_42",
    "/account/billing/return?order_id=ord_42",
    "/account/billing/return/0a05c6a0-deca-4b2a-8d88-9fba1f76c756",
    "/account/developer?order_id=ord_42",
    "/account/developer/return/0a05c6a0-deca-4b2a-8d88-9fba1f76c756",
  ]) {
    expect(accountReturnPath(path)).toBe(path);
    expect(accountReturnPath(path + "&next=elsewhere")).toBe("/account");
  }
  expect(accountReturnPath("/account/billing?subscription_id=ord_42")).toBe(
    "/account",
  );
  for (const suffix of [
    "",
    "ord_42",
    "../billing",
    "0a05c6a0-deca-4b2a-8d88-9fba1f76c756/extra",
  ]) {
    expect(accountReturnPath("/account/developer/return/" + suffix)).toBe(
      "/account",
    );
  }
  expect(
    checkoutReference("credits", { order_id: ["ord_a", "ord_b"] }),
  ).toBeNull();
});
it("recognizes older Pro returns with only a valid Creem checkout or order ID", () => {
  expect(proCheckoutReference({ checkout_id: "ch_prior" })).toBe("ch_prior");
  expect(proCheckoutReference({ order_id: "ord_prior" })).toBe("ord_prior");
  expect(
    proCheckoutReference({ checkout_id: ["ch_first", "ch_second"] }),
  ).toBeNull();
  expect(
    proCheckoutReference({ checkout_id: "ch_bad&next=external" }),
  ).toBeNull();
});
it("retains only an internal data-flow route and an optional provider domain", () => {
  expect(accountReturnPath("/data-flow")).toBe("/data-flow");
  expect(accountReturnPath("/data-flow?provider=EXAMPLE.org")).toBe(
    "/data-flow?provider=example.org",
  );
  for (const value of [
    "/data-flow?provider=bad",
    "/data-flow?provider=x.test&next=external.test",
    "//elsewhere.test/data-flow",
    "/data-flow?provider=https://elsewhere.test",
  ])
    expect(accountReturnPath(value)).toBe("/account");
});
