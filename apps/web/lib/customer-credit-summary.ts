import { creemCreditsClient, type connect } from "@datadeal/database";

export async function customerCreditSummary(
  db: Pick<ReturnType<typeof connect>, "creemCreditAccount">,
  userId: string,
  options: { fullHistory?: boolean } = {},
) {
  try {
    const account = await db.creemCreditAccount(userId);
    if (!account)
      return { state: "unlinked", balance: "0", entries: [] } as const;
    const client = creemCreditsClient();
    if (client) {
      const summary = await client.summary(account.accountId, options);
      return { ...summary, state: "ready" } as const;
    }
  } catch {
    // An unavailable billing service must never appear as an empty wallet.
  }
  return { state: "unavailable", balance: null, entries: [] } as const;
}
