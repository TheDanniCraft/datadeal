import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";
const { session, queue } = vi.hoisted(() => ({
  session: vi.fn(),
  queue: vi.fn(),
}));
vi.mock("../../../../../lib/auth", () => ({
  auth: { api: { getSession: session } },
}));
vi.mock("../../../../../lib/reports", () => ({
  database: { hasPro: async () => false, requestPointRefresh: queue },
}));
const origin = "http://localhost:3000";
const id = randomUUID();
function submit(body: Record<string, unknown>, source = origin) {
  return POST(
    new Request(origin + "/api/v1/rewards/refresh", {
      method: "POST",
      headers: { Origin: source, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DATADEAL_LOCAL_SAMPLE_ADS", "true");
  vi.stubEnv("DATABASE_URL", "postgres://localhost/example");
  vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(40));
  vi.resetAllMocks();
});
afterEach(() => vi.unstubAllEnvs());
it("requires experimental mode, same-origin, an authenticated account and an explicit spend", async () => {
  const input = { domain: "example.com", requestId: id, spendPoints: true };
  vi.stubEnv("NODE_ENV", "production");
  expect((await submit(input)).status).toBe(404);
  vi.stubEnv("NODE_ENV", "development");
  expect((await submit(input, "https://other.example")).status).toBe(403);
  expect((await submit(input)).status).toBe(401);
  session.mockResolvedValue({ user: { id: "account" } });
  expect((await submit({ ...input, spendPoints: false })).status).toBe(400);
  expect(queue).not.toHaveBeenCalled();
  queue.mockResolvedValue({ code: "accepted", id: randomUUID(), points: 50 });
  expect((await submit(input)).status).toBe(202);
  expect(queue).toHaveBeenCalledWith(
    "account",
    "example.com",
    id,
    null,
    expect.stringMatching(/^daily:account:[a-f0-9]{64}$/),
  );
});
