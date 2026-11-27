import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const { database, publishedReportPayload } = vi.hoisted(() => ({
  database: {
    verifyApiToken: vi.fn(),
    apiCreditReplay: vi.fn(),
    creemApiReplay: vi.fn(),
    pointApiReplay: vi.fn(),
    chargeApiPoints: vi.fn(),
    serveNativeUsage: vi.fn(),
  },
  publishedReportPayload: vi.fn(),
}));

vi.mock("./reports", () => ({ database }));
vi.mock("./published-report", () => ({ publishedReportPayload }));
vi.mock("./developer-token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-token")>()),
  developerApiPreview: true,
  developerReportReadCost: 150,
  developerScanCost: 150,
}));

import { GET, POST } from "../app/api/v1/developer/reports/[domain]/route";
import { POST as requestScan } from "../app/api/v1/developer/scans/[domain]/route";

const token = "dd_be935bd2-7986-4c95-b02a-761c2529a338." + "a".repeat(43);
const payload = { domain: "example.com", report: { demo: false, score: 85 } };
const readHash = createHash("sha256")
  .update("report:read\0example.com")
  .digest("hex");
const scanHash = createHash("sha256")
  .update("scan:request\0example.com")
  .digest("hex");

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

function scan(key = "scan-1") {
  return requestScan(
    new Request("http://127.0.0.1/api/v1/developer/scans/example.com", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Idempotency-Key": key },
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
  database.creemApiReplay.mockResolvedValue(null);
  database.pointApiReplay.mockResolvedValue(null);
  database.chargeApiPoints.mockResolvedValue({
    code: "applied",
    response: payload,
  });
  publishedReportPayload.mockResolvedValue(payload);
});

it("charges 150 points for keyed POST requests for a published report", async () => {
  expect((await request("GET")).status).toBe(200);
  expect((await request("POST")).status).toBe(400);
  expect(database.chargeApiPoints).not.toHaveBeenCalled();
  const response = await request("POST", "req-1");
  expect(response.status).toBe(200);
  expect(response.headers.get("Idempotency-Replayed")).toBeNull();
  expect(await response.json()).toEqual(payload);
  expect(database.chargeApiPoints).toHaveBeenCalledExactlyOnceWith(
    "owner",
    { key: "req-1", requestHash: readHash, points: 150 },
    "example.com",
    "report_read",
    payload,
  );
  expect(database.serveNativeUsage).not.toHaveBeenCalled();
});

it("replays a saved response without loading the report or charging again", async () => {
  for (const source of [
    database.pointApiReplay,
    database.creemApiReplay,
    database.apiCreditReplay,
  ]) {
    source.mockResolvedValueOnce({ code: "replayed", response: payload });
    const response = await request("POST", "req-1");
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await response.json()).toEqual(payload);
  }
  expect(database.pointApiReplay).toHaveBeenCalledWith(
    "owner",
    "req-1",
    readHash,
  );
  expect(publishedReportPayload).not.toHaveBeenCalled();
  expect(database.chargeApiPoints).not.toHaveBeenCalled();
});

it("rejects conflicting keys, missing reports, and too few points", async () => {
  database.pointApiReplay.mockResolvedValueOnce({ code: "conflict" });
  expect((await request("POST", "req-1")).status).toBe(409);
  publishedReportPayload.mockResolvedValueOnce({ report: null });
  expect((await request("POST", "req-1")).status).toBe(404);
  expect(database.chargeApiPoints).not.toHaveBeenCalled();
  database.chargeApiPoints.mockResolvedValueOnce({ code: "conflict" });
  expect((await request("POST", "req-1")).status).toBe(409);
  database.chargeApiPoints.mockResolvedValueOnce({ code: "insufficient" });
  const response = await request("POST", "req-1");
  expect(response.status).toBe(402);
  expect(await response.json()).toEqual({
    code: "insufficient_points",
    required: 150,
  });
  database.chargeApiPoints.mockRejectedValueOnce(Error("offline"));
  expect((await request("POST", "req-1")).status).toBe(503);
});

it("charges 150 points before admitting an API scan and replays its receipt", async () => {
  database.verifyApiToken.mockResolvedValue({
    userId: "owner",
    scope: "scans:request",
  });
  const id = "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";
  database.chargeApiPoints.mockResolvedValueOnce({
    code: "applied",
    response: { id },
  });
  const accepted = await scan();
  expect(accepted.status).toBe(202);
  expect(await accepted.json()).toEqual({ id });
  expect(accepted.headers.get("Location")).toBe(
    "/api/v1/developer/scans/status/" + id,
  );
  expect(database.chargeApiPoints).toHaveBeenCalledExactlyOnceWith(
    "owner",
    { key: "scan-1", requestHash: scanHash, points: 150 },
    "example.com",
    "scan",
    null,
  );
  database.pointApiReplay.mockResolvedValueOnce({
    code: "replayed",
    response: { id },
  });
  expect((await scan()).status).toBe(202);
  expect(database.chargeApiPoints).toHaveBeenCalledTimes(1);
  database.pointApiReplay.mockResolvedValueOnce({ code: "conflict" });
  expect((await scan()).status).toBe(409);
  database.chargeApiPoints.mockResolvedValueOnce({ code: "insufficient" });
  const short = await scan("scan-2");
  expect(short.status).toBe(402);
  expect(await short.json()).toEqual({
    code: "insufficient_points",
    required: 150,
  });
  database.chargeApiPoints.mockResolvedValueOnce({ code: "queue_full" });
  expect((await scan("scan-3")).status).toBe(429);
});
