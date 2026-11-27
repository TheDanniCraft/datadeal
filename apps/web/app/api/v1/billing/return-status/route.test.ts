import { expect, it, vi } from "vitest";
import { GET } from "./route";

const {
  getSession,
  checkoutReceipt,
  billingSummary,
  creditCheckoutReceipt,
  proCheckoutReceipt,
  pointPackReceipt,
} = vi.hoisted(() => ({
  pointPackReceipt: vi.fn(),
  getSession: vi.fn(),
  checkoutReceipt: vi.fn(),
  billingSummary: vi.fn(),
  creditCheckoutReceipt: vi.fn(),
  proCheckoutReceipt: vi.fn(),
}));
vi.mock("../../../../../lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("../../../../../lib/reports", () => ({
  database: {
    checkoutReceipt,
    billingSummary,
    creditCheckoutReceipt,
    proCheckoutReceipt,
    pointPackReceipt,
  },
}));
const status = (query: string) =>
  GET(
    new Request(
      "https://datadeal.example/api/v1/billing/return-status?" + query,
    ),
  );

it("looks up only an authenticated buyer's concrete order or subscription", async () => {
  getSession.mockResolvedValue(null);
  expect((await status("order_id=ord_buyer")).status).toBe(401);
  getSession.mockResolvedValue({ user: { id: "buyer" } });
  expect((await status("order_id=ord_buyer&user=other")).status).toBe(400);
  expect((await status("subscription_id=ord_buyer")).status).toBe(400);
  expect(checkoutReceipt).not.toHaveBeenCalled();
  checkoutReceipt.mockResolvedValue("pending");
  const pending = await status("subscription_id=sub_other");
  expect(await pending.json()).toEqual({ status: "pending" });
  expect(pending.headers.get("cache-control")).toBe("private, no-store");
  expect(checkoutReceipt).toHaveBeenCalledWith(
    "buyer",
    "subscription",
    "sub_other",
  );
  checkoutReceipt.mockResolvedValue("refunded");
  expect(await (await status("order_id=ord_buyer")).json()).toEqual({
    status: "refunded",
  });
  expect(checkoutReceipt).toHaveBeenLastCalledWith(
    "buyer",
    "credits",
    "ord_buyer",
  );
});

it("checks only the current account when Creem omits the subscription ID", async () => {
  getSession.mockResolvedValue(null);
  expect((await status("checkout=pro")).status).toBe(401);
  getSession.mockResolvedValue({ user: { id: "buyer" } });
  expect((await status("checkout=pro&user=other")).status).toBe(400);
  billingSummary.mockResolvedValue(null);
  expect(await (await status("checkout=pro")).json()).toEqual({
    status: "pending",
  });
  billingSummary.mockResolvedValue({ has_access: true });
  expect(await (await status("checkout=pro")).json()).toEqual({
    status: "account_subscription",
  });
  expect(billingSummary).toHaveBeenLastCalledWith("buyer");
});

it("checks a Pro checkout against its owner even when that account has a different subscription", async () => {
  getSession.mockResolvedValue({ user: { id: "buyer" } });
  billingSummary.mockResolvedValue({ has_access: true });
  proCheckoutReceipt.mockResolvedValue(null);
  for (const ref of [
    "ch_prior",
    "ord_prior",
    "0a05c6a0-deca-4b2a-8d88-9fba1f76c756",
  ]) {
    expect(await (await status("pro_receipt=" + ref)).json()).toEqual({
      status: "pending",
    });
    expect(proCheckoutReceipt).toHaveBeenLastCalledWith("buyer", ref);
  }
  expect((await status("pro_receipt=bogus")).status).toBe(400);
});

it("reads the exact credit purchase for the signed-in buyer when the provider omits its order ID", async () => {
  const id = "0a05c6a0-deca-4b2a-8d88-9fba1f76c756";
  const query = "request_id=" + id;
  getSession.mockResolvedValue(null);
  expect((await status(query)).status).toBe(401);
  getSession.mockResolvedValue({ user: { id: "buyer" } });
  for (const invalid of [
    "request_id=ord_1",
    query + "&user=other",
    query + "&" + query,
  ]) {
    expect((await status(invalid)).status).toBe(400);
  }
  expect(creditCheckoutReceipt).not.toHaveBeenCalled();
  creditCheckoutReceipt.mockResolvedValue("confirmed");
  const receipt = await status(query);
  expect(await receipt.json()).toEqual({ status: "confirmed" });
  expect(receipt.headers.get("cache-control")).toBe("private, no-store");
  expect(creditCheckoutReceipt).toHaveBeenCalledExactlyOnceWith("buyer", id);
});

it("reports a point pack by its request or order before an earlier credit pack", async () => {
  const id = "0a05c6a0-deca-4b2a-8d88-9fba1f76c756";
  getSession.mockResolvedValue({ user: { id: "buyer" } });
  pointPackReceipt.mockResolvedValue({ status: "refunded", points: 25000 });
  creditCheckoutReceipt.mockClear();
  checkoutReceipt.mockClear();
  expect(await (await status("request_id=" + id)).json()).toEqual({
    status: "refunded",
  });
  expect(pointPackReceipt).toHaveBeenLastCalledWith("buyer", id);
  expect(await (await status("order_id=ord_points")).json()).toEqual({
    status: "refunded",
  });
  expect(pointPackReceipt).toHaveBeenLastCalledWith("buyer", {
    orderId: "ord_points",
  });
  expect(creditCheckoutReceipt).not.toHaveBeenCalled();
  expect(checkoutReceipt).not.toHaveBeenCalled();
  pointPackReceipt.mockResolvedValue(null);
});
