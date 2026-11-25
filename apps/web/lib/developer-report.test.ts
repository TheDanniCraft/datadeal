import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const { database, publishedReportPayload } = vi.hoisted(() => ({
  database: {
    verifyApiToken: vi.fn(),
    apiCreditReplay: vi.fn(),
    lookupNativeUsage: vi.fn(),
    creemCreditAccount: vi.fn(),
    reserveNativeUsage: vi.fn(),
    serveNativeUsage: vi.fn(),
  },
  publishedReportPayload: vi.fn(),
}));

vi.mock("@datadeal/database", () => ({ creemCreditsClient: () => ({}) }));
vi.mock("./reports", () => ({ database }));
vi.mock("./published-report", () => ({ publishedReportPayload }));
vi.mock("./developer-token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-token")>()),
  developerApiPreview: true,
  developerReportReadCost: 2,
}));

import { GET, POST } from "../app/api/v1/developer/reports/[domain]/route";

const token = "dd_be935bd2-7986-4c95-b02a-761c2529a338." + "a".repeat(43);
const charge = { key: "req-1", amount: 2 };
const payload = { domain: "example.com", report: { demo: false, score: 85 } };

function request(method: "GET" | "POST", key?: string) {
  const handler = method === "GET" ? GET : POST;
  return handler(
    new Request("http://127.0.0.1/api/v1/developer/reports/example.com", {
      method,
      headers: {
        Authorization: "Bearer " + token,
        ...(key && { "Idempotency-Key": key }),
      },
    }),
    { params: Promise.resolve({ domain: "example.com" }) },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  database.verifyApiToken.mockResolvedValue({
    userId: "owner",
    scope: "reports:read",
  });
  database.apiCreditReplay.mockResolvedValue(null);
  database.lookupNativeUsage.mockResolvedValue(null);
  database.creemCreditAccount.mockResolvedValue({
    customerId: "cus",
    accountId: "account",
  });
  database.reserveNativeUsage.mockResolvedValue({ id: "op", conflict: false });
  database.serveNativeUsage.mockResolvedValue({
    code: "applied",
    response: payload,
  });
  publishedReportPayload.mockResolvedValue(payload);
});

it("charges only keyed POST requests for a published report", async () => {
  expect((await request("GET")).status).toBe(200);
  expect((await request("POST")).status).toBe(400);
  expect(database.serveNativeUsage).not.toHaveBeenCalled();
  const response = await request("POST", charge.key);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(payload);
  expect(database.reserveNativeUsage).toHaveBeenCalledExactlyOnceWith(
    "owner",
    {
      ...charge,
      requestHash: createHash("sha256")
        .update("report:read\0example.com")
        .digest("hex"),
    },
    { customerId: "cus", accountId: "account" },
    "example.com",
    "datadeal_report_read",
    payload,
  );
  expect(database.serveNativeUsage).toHaveBeenCalledExactlyOnceWith("op", {});
});

it("replays a saved response without loading the report again", async () => {
  database.apiCreditReplay.mockResolvedValue({
    code: "replayed",
    response: payload,
  });
  const response = await request("POST", charge.key);
  expect(await response.json()).toEqual(payload);
  expect(publishedReportPayload).not.toHaveBeenCalled();
  expect(database.serveNativeUsage).not.toHaveBeenCalled();
});

it("rejects conflicting keys, missing reports, and insufficient credits", async () => {
  database.apiCreditReplay.mockResolvedValueOnce({ code: "conflict" });
  expect((await request("POST", charge.key)).status).toBe(409);
  publishedReportPayload.mockResolvedValueOnce({ report: null });
  expect((await request("POST", charge.key)).status).toBe(404);
  expect(database.serveNativeUsage).not.toHaveBeenCalled();
  database.serveNativeUsage.mockResolvedValueOnce({ code: "insufficient" });
  const response = await request("POST", charge.key);
  expect(response.status).toBe(402);
  expect(await response.json()).toEqual({
    code: "insufficient_credits",
    required: 2,
  });
});
