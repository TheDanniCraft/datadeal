import { createHash } from "node:crypto";
import {
  accountBalance,
  accountPage,
  creditFailure,
  creditId,
  entryPage,
  nativeAccount,
  nativeEntry,
  nativeTransaction,
  txPage,
} from "@datadeal/contracts/creem-credits";

export class CreemCreditError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super("Creem Customer Credits: " + code);
  }
}

export function creemCreditsClient() {
  const key = process.env.CREEM_API_KEY;
  if (process.env.CREEM_MODE !== "test" || !key) return null;
  const api = "https://test-api.creem.io/v1/customer-credits/";
  const request = async (path: string, body?: object): Promise<unknown> => {
    const result = await fetch(api + path, {
      method: body ? "POST" : "GET",
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        "x-api-key": key,
        ...(body && { "Content-Type": "application/json" }),
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    const data: unknown = await result.json().catch(() => null);
    if (!result.ok) {
      const parsed = creditFailure.safeParse(data);
      const code = parsed.success ? parsed.data.error.code : "provider_error";
      throw new CreemCreditError(
        code === "insufficient_funds" ? "insufficient_balance" : code,
        result.status,
      );
    }
    return data;
  };
  const accountPath = (id: string) => "accounts/" + creditId.parse(id);
  const mismatch = () => new CreemCreditError("unexpected_transaction", 502);
  async function post(
    side: "credit" | "debit",
    accountId: string,
    amount: number,
    reference: string,
    idempotencyKey: string,
  ) {
    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      !reference ||
      !idempotencyKey
    )
      throw new Error("Invalid Creem credit operation");
    const matches = (item: typeof nativeTransaction._output) =>
      item.idempotency_key === idempotencyKey &&
      item.reference === reference &&
      item.entries.some(
        (e) =>
          e.transaction_id === item.id &&
          e.side === side &&
          e.account_id === accountId &&
          e.amount === String(amount),
      );
    try {
      const result = nativeTransaction.parse(
        await request(accountPath(accountId) + "/" + side, {
          amount: String(amount),
          reference,
          idempotency_key: idempotencyKey,
        }),
      );
      if (!matches(result)) throw mismatch();
      return { id: result.id };
    } catch (error) {
      if (
        !(error instanceof CreemCreditError) ||
        error.status !== 409 ||
        error.code === "insufficient_balance"
      )
        throw error;
      const { data } = txPage.parse(
        await request("transactions?" + new URLSearchParams({ reference })),
      );
      const found = data.find(matches);
      if (!found) throw error;
      return { id: found.id };
    }
  }

  async function* entries(accountId: string, full: boolean) {
    let cursor = "";
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({ limit: full ? "100" : "25" });
      if (cursor) query.set("starting_after", cursor);
      const page = entryPage.parse(
        await request(accountPath(accountId) + "/entries?" + query),
      );
      for (const item of page.data) {
        if (item.account_id !== accountId || seen.has(item.id))
          throw mismatch();
        seen.add(item.id);
        yield item;
      }
      if (!full || !page.has_more) return;
      cursor = page.data.at(-1)?.id ?? "";
      if (!cursor) throw mismatch();
    } while (cursor);
  }

  return {
    async ensureAccount(userId: string, customerId: string) {
      creditId.parse(customerId);
      const name =
        "datadeal-api-" +
        createHash("sha256").update(userId).digest("hex").slice(0, 32);
      const belongs = (account: typeof nativeAccount._output) =>
        account.name.toLowerCase() === name &&
        account.customer_id === customerId;
      try {
        const result = nativeAccount.parse(
          await request("accounts", {
            customer_id: customerId,
            name,
            unit_label: "credits",
          }),
        );
        if (!belongs(result)) throw mismatch();
        return result.id;
      } catch (error) {
        if (!(error instanceof CreemCreditError) || error.status !== 409)
          throw error;
        const query = new URLSearchParams({
          customer_id: customerId,
          limit: "100",
        });
        const seen = new Set<string>();
        for (;;) {
          const page = accountPage.parse(await request("accounts?" + query));
          const found = page.data.find(belongs);
          if (found) return found.id;
          const last = page.data.at(-1)?.id;
          if (!page.has_more || !last || seen.has(last)) throw error;
          seen.add(last);
          query.set("starting_after", last);
        }
      }
    },
    credit: (
      accountId: string,
      amount: number,
      reference: string,
      idempotencyKey: string,
    ) => post("credit", accountId, amount, reference, idempotencyKey),
    debit: (
      accountId: string,
      amount: number,
      reference: string,
      idempotencyKey: string,
    ) => post("debit", accountId, amount, reference, idempotencyKey),
    async reverse(accountId: string, transactionId: string) {
      creditId.parse(transactionId);
      const path = accountPath(accountId);
      const prior = nativeTransaction.parse(
        await request("transactions/" + transactionId),
      );
      const original = prior.entries.find(
        (e) => e.account_id === accountId && e.transaction_id === transactionId,
      );
      if (prior.id !== transactionId || !original || prior.reversal_of)
        throw mismatch();
      const matches = (tx: typeof nativeTransaction._output) =>
        tx.reversal_of === transactionId &&
        tx.entries.some(
          (e) =>
            e.transaction_id === tx.id &&
            e.account_id === accountId &&
            e.side !== original.side &&
            e.amount === original.amount,
        );
      // Creem reverse takes only the original transaction ID. Reconcile a lost reply
      // against the provider's ledger before submitting a new reversal.
      for await (const entry of entries(accountId, true)) {
        if (
          entry.side === original.side ||
          entry.amount !== original.amount ||
          Date.parse(entry.created_at) < Date.parse(original.created_at)
        )
          continue;
        const candidate = nativeTransaction.parse(
          await request("transactions/" + entry.transaction_id),
        );
        if (matches(candidate)) return { id: candidate.id };
      }
      const result = nativeTransaction.parse(
        await request(path + "/reverse", { transaction_id: transactionId }),
      );
      if (!matches(result)) throw mismatch();
      return { id: result.id };
    },
    async summary(accountId: string, options: { fullHistory?: boolean } = {}) {
      const history = async () => {
        const rows: (Pick<
          typeof nativeEntry._output,
          "id" | "side" | "amount"
        > & { createdAt: string; transactionId: string })[] = [];
        for await (const item of entries(
          accountId,
          options.fullHistory === true,
        )) {
          rows.push({
            id: item.id,
            side: item.side,
            amount: item.amount,
            createdAt: item.created_at,
            transactionId: item.transaction_id,
          });
        }
        return rows;
      };
      const [balance, items] = await Promise.all([
        request(accountPath(accountId) + "/balance"),
        history(),
      ]);
      return { balance: accountBalance.parse(balance).balance, entries: items };
    },
  };
}
