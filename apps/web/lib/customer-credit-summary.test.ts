import { beforeEach, expect, it, vi } from "vitest";

const { summary, client } = vi.hoisted(() => {
  const summary = vi.fn();
  return { summary, client: vi.fn(() => ({ summary })) };
});
vi.mock("@datadeal/database", () => ({ creemCreditsClient: client }));
import { customerCreditSummary } from "./customer-credit-summary";

const creemCreditAccount = vi.fn();
const db = { creemCreditAccount };
beforeEach(() => vi.clearAllMocks());

it("opens an empty wallet view for a user without an account mapping", async () => {
  creemCreditAccount.mockResolvedValue(null);
  expect(await customerCreditSummary(db, "user")).toEqual({
    state: "unlinked",
    balance: "0",
    entries: [],
  });
  expect(client).not.toHaveBeenCalled();
});

it("uses the mapped account and keeps full precision for export", async () => {
  creemCreditAccount.mockResolvedValue({
    accountId: "cca_a",
    customerId: "cust_a",
  });
  summary.mockResolvedValue({ balance: "9007199254740993", entries: [] });
  const wallet = await customerCreditSummary(db, "user", { fullHistory: true });
  expect(creemCreditAccount).toHaveBeenCalledWith("user");
  expect(summary).toHaveBeenCalledWith("cca_a", { fullHistory: true });
  expect(wallet.balance).toBe("9007199254740993");
});

it("distinguishes a billing outage from a zero balance", async () => {
  creemCreditAccount.mockResolvedValue({
    accountId: "cca_a",
    customerId: "cust_a",
  });
  summary.mockRejectedValue(new Error("timeout"));
  expect(await customerCreditSummary(db, "user")).toEqual({
    state: "unavailable",
    balance: null,
    entries: [],
  });
});
