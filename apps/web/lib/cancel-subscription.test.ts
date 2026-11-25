import { afterEach, expect, it, vi } from "vitest";
import { cancelSubscription } from "./cancel-subscription";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function provider(...replies: (string | number | object)[]) {
  vi.stubEnv("CREEM_MODE", "test");
  vi.stubEnv("CREEM_API_KEY", "test");
  vi.stubEnv("CREEM_WEBHOOK_SECRET", "secret");
  const call = vi.fn<typeof fetch>().mockImplementation(async () => {
    const reply = replies.shift();
    if (typeof reply === "number") return new Response(null, { status: reply });
    if (!reply) throw new Error("Unexpected provider call");
    return Response.json({
      id: "sub_owned",
      customer: { id: "cust_owned" },
      product: "product",
      mode: "test",
      ...(typeof reply === "string" ? { status: reply } : reply),
    });
  });
  vi.stubGlobal("fetch", call);
  return call;
}
it("confirms immediate cancellation at the provider and tolerates a repeated request", async () => {
  const fetch = provider("paused", 200, "canceled", "canceled");
  await cancelSubscription("sub_owned", "cust_owned");
  await cancelSubscription("sub_owned", "cust_owned");
  const writes = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject([
    "https://test-api.creem.io/v1/subscriptions/sub_owned/cancel",
    { body: '{"mode":"immediate"}', redirect: "error" },
  ]);
});
it.each([
  { customer: "cust_other" },
  { id: "sub_other" },
  { mode: "prod" },
  {},
])("checks ownership and store before a cancellation", async (wrongOwner) => {
  const fetch = provider(wrongOwner);
  await expect(cancelSubscription("sub_owned", "cust_owned")).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("leaves closure pending when an acknowledged request still shows scheduled cancellation", async () => {
  provider("active", 200, "scheduled_cancel");
  await expect(cancelSubscription("sub_owned", "cust_owned")).rejects.toThrow(
    "not confirmed",
  );
});
