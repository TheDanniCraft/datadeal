import { creemConnection, creemSubscription } from "./billing";

/** Stop renewal for the exact subscription attached to a confirmed deletion. */
export async function cancelSubscription(
  subscription: string,
  customer: string,
) {
  const config = creemConnection();
  if (!config || !/^sub_[a-zA-Z0-9_-]{1,100}$/.test(subscription))
    throw new Error("Subscription cancellation unavailable");
  const { mode } = config;
  const lookup = new URL("/v1/subscriptions", config.api);
  lookup.searchParams.set("subscription_id", subscription);
  const options = {
    headers: { "x-api-key": config.key, "content-type": "application/json" },
    cache: "no-store" as const,
    redirect: "error" as const,
  };
  async function status() {
    const response = await fetch(lookup, {
      ...options,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Subscription lookup failed");
    const row = creemSubscription.parse(await response.json());
    if (
      !row.status ||
      row.id !== subscription ||
      row.customer !== customer ||
      (row.mode && row.mode !== mode)
    )
      throw new Error("Subscription ownership could not be confirmed");
    return row.status;
  }
  if ((await status()) === "canceled") return;
  const response = await fetch(
    config.api + "/v1/subscriptions/" + subscription + "/cancel",
    {
      ...options,
      method: "POST",
      body: JSON.stringify({ mode: "immediate" }),
      signal: AbortSignal.timeout(8000),
    },
  );
  await response.body?.cancel();
  // Covers an already-canceled response and retries after a lost acknowledgement.
  if ((await status()) !== "canceled")
    throw new Error("Cancellation is not confirmed");
}
