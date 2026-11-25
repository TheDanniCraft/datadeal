import { afterEach, expect, it, vi } from "vitest";
import { creemCreditsClient } from "./creem-credit-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function sandbox() {
  vi.stubEnv("CREEM_MODE", "test");
  vi.stubEnv("CREEM_API_KEY", "sandbox-fixture");
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  return { client: creemCreditsClient()!, fetcher };
}
const entry = {
  id: "cce_1",
  account_id: "cca_1",
  transaction_id: "cct_1",
  amount: "25",
  side: "credit",
  created_at: "2026-01-01T18:15:00Z",
};
const transaction = {
  id: "cct_1",
  reference: "order_1",
  idempotency_key: "operation_1",
  entries: [entry],
};
it("reconciles an idempotent credit only with matching account, amount, direction, key and reference", async () => {
  const { client, fetcher } = sandbox();
  const conflict = () =>
    Response.json(
      { error: { code: "duplicate_idempotency_key" } },
      { status: 409 },
    );
  fetcher
    .mockResolvedValueOnce(conflict())
    .mockResolvedValueOnce(
      Response.json({ data: [transaction], has_more: false }),
    );
  await expect(
    client.credit("cca_1", 25, "order_1", "operation_1"),
  ).resolves.toEqual({ id: "cct_1" });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe(
    "https://test-api.creem.io/v1/customer-credits/accounts/cca_1/credit",
  );
  expect(init).toMatchObject({ method: "POST", redirect: "error" });
  expect(JSON.parse(String(init?.body))).toEqual({
    amount: "25",
    reference: "order_1",
    idempotency_key: "operation_1",
  });
  fetcher
    .mockResolvedValueOnce(conflict())
    .mockResolvedValueOnce(
      Response.json({ data: [transaction], has_more: false }),
    );
  await expect(
    client.debit("cca_other", 25, "order_1", "operation_1"),
  ).rejects.toMatchObject({ status: 409 });
});
it("returns only one owner's recent entries and preserves exact large balances in a full export", async () => {
  const { client, fetcher } = sandbox();
  fetcher.mockImplementation(async (url) => {
    if (String(url).endsWith("/balance"))
      return Response.json({ balance: "9007199254740993123" });
    if (String(url).includes("starting_after=cce_1"))
      return Response.json({
        data: [{ ...entry, id: "cce_2" }],
        has_more: false,
      });
    return Response.json({ data: [entry], has_more: true });
  });
  const recent = await client.summary("cca_1");
  expect(recent.balance).toBe("9007199254740993123");
  expect(recent.entries).toHaveLength(1);
  expect(
    (await client.summary("cca_1", { fullHistory: true })).entries.map(
      (row) => row.id,
    ),
  ).toEqual(["cce_1", "cce_2"]);
  await expect(client.summary("other")).rejects.toMatchObject({
    code: "unexpected_transaction",
  });
  expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
    true,
  );
});
it("recognizes a reversal after a lost acknowledgement using the original transaction and account", async () => {
  const { client, fetcher } = sandbox();
  const inverse = {
    ...entry,
    id: "cce_2",
    transaction_id: "cct_reversal",
    side: "debit",
  };
  fetcher
    .mockResolvedValueOnce(Response.json(transaction))
    .mockResolvedValueOnce(
      Response.json({ data: [inverse, entry], has_more: false }),
    )
    .mockResolvedValueOnce(
      Response.json({
        id: "cct_reversal",
        reversal_of: "cct_1",
        entries: [inverse],
      }),
    );
  await expect(client.reverse("cca_1", "cct_1")).resolves.toEqual({
    id: "cct_reversal",
  });
  expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
    true,
  );
});
