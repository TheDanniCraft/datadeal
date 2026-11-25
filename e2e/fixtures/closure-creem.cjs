// Preload only into the isolated account-deletion browser test.
if (
  process.env.DATADEAL_ACCOUNT_CLOSURE_TEST === "true" &&
  process.env.CREEM_API_KEY === "test-account-closure"
) {
  const original = globalThis.fetch;
  const cancellations = new Map();
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    if (url.hostname !== "test-api.creem.io") return original(input, init);
    const method = init?.method ?? "GET";
    const match = url.pathname.match(
      /^\/v1\/subscriptions\/(sub_closure_[a-z0-9-]+)\/cancel$/,
    );
    const id =
      method === "GET" && url.pathname === "/v1/subscriptions"
        ? url.searchParams.get("subscription_id")
        : match?.[1];
    if (!id || !/^sub_closure_[a-z0-9-]+$/.test(id))
      throw new Error("Unexpected sandbox request");
    if (
      method === "POST" &&
      match &&
      JSON.parse(init.body).mode === "immediate"
    ) {
      const attempts = (cancellations.get(id) ?? 0) + 1;
      cancellations.set(id, attempts);
      return new Response(null, { status: attempts === 1 ? 503 : 200 });
    }
    if (method !== "GET") throw new Error("Unexpected request method");
    return Response.json({
      id,
      mode: "test",
      product: "datadeal-test-monthly",
      customer: "cust_closure",
      status: (cancellations.get(id) ?? 0) >= 2 ? "canceled" : "active",
    });
  };
}
