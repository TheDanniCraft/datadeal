// The disposable browser test uses its own store and makes no external payments.
if (
  process.env.DATADEAL_CREDIT_CHECKOUT_TEST === "true" &&
  process.env.CREEM_MODE === "test" &&
  process.env.CREEM_API_KEY === "test-credit-checkout"
) {
  const originalFetch = globalThis.fetch;
  const accounts = new Map();
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    if (url.hostname !== "test-api.creem.io") return originalFetch(input, init);
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : {};
    if (method === "POST" && path === "/v1/checkouts") {
      const target = new URL("https://test-checkout.creem.io/fixture");
      target.searchParams.set("return", body.success_url);
      return Response.json({
        id: "ch_" + body.request_id,
        checkout_url: target.href,
      });
    }
    if (path === "/v1/customer-credits/accounts") {
      if (method === "GET") return Response.json({ data: [], has_more: false });
      if (method === "POST") {
        const id = "cca_" + body.customer_id;
        accounts.set(id, []);
        return Response.json({ id, ...body });
      }
    }
    const match = path.match(
      /^\/v1\/customer-credits\/accounts\/(cca_[\w-]+)\/(credit|entries|balance)$/,
    );
    if (match && accounts.has(match[1])) {
      const [, accountId, action] = match;
      const entries = accounts.get(accountId);
      if (action === "credit" && method === "POST") {
        const id = "tx_" + (entries.length + 1);
        const entry = {
          id: "entry_" + id,
          transaction_id: id,
          account_id: accountId,
          side: "credit",
          amount: body.amount,
          created_at: new Date().toISOString(),
        };
        entries.push(entry);
        return Response.json({ id, ...body, entries: [entry] });
      }
      if (action === "entries" && method === "GET") {
        return Response.json({ has_more: false, data: entries });
      }
      if (action === "balance" && method === "GET") {
        const balance = entries.reduce(
          (sum, entry) => sum + Number(entry.amount),
          0,
        );
        return Response.json({ balance: String(balance) });
      }
    }
    throw new Error("Unexpected test credit service request");
  };
}
