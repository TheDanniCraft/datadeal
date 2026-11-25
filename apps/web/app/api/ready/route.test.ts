import { expect, it, vi } from "vitest";
import { GET } from "./route";

const { checkScanStorage } = vi.hoisted(() => ({ checkScanStorage: vi.fn() }));
vi.mock("../../../lib/reports", () => ({ database: { checkScanStorage } }));

it("serves an uncached readiness response after the storage check passes", async () => {
  checkScanStorage.mockResolvedValueOnce(undefined);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ ready: true });
});

it("returns 503 without exposing database errors when schema validation fails", async () => {
  checkScanStorage.mockRejectedValueOnce(
    new Error("Missing database relation"),
  );
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ ready: false });
});
