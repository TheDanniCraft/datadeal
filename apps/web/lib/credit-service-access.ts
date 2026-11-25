/** Check the configured store can read its native ledger before offering a pack. */
export async function creditServiceAccessible(config: {
  api: string;
  key: string;
}) {
  try {
    const result = await fetch(
      config.api + "/v1/customer-credits/accounts?limit=1",
      {
        headers: { "x-api-key": config.key },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(4000),
      },
    );
    await result.body?.cancel();
    return result.ok;
  } catch {
    return false;
  }
}
