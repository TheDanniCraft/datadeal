import { database } from "./reports";

type Charge = { key: string; points: number; requestHash: string };

/**
 * Pay for a developer API request with points: replay a known key first, then
 * charge before the work (a saved report read, or admitting a scan).
 */
export async function pointApiUsage(
  userId: string,
  charge: Charge,
  domain: string,
  kind: "report_read" | "scan",
  loadReport?: () => Promise<object | null>,
) {
  if (!database) return { code: "unavailable" } as const;
  const { key, requestHash } = charge;
  try {
    // Keys first used with earlier API credits keep replaying, never recharged.
    const earlier =
      (await database.apiCreditReplay(userId, key, requestHash)) ??
      (await database.creemApiReplay(userId, key, requestHash)) ??
      (await database.pointApiReplay(userId, key, requestHash));
    if (earlier) return earlier;
    const payload = loadReport ? await loadReport() : null;
    if (loadReport && !payload) return { code: "report_unavailable" } as const;
    const result = await database.chargeApiPoints(
      userId,
      charge,
      domain,
      kind,
      payload,
    );
    return result.code === "invalid"
      ? ({ code: "unavailable" } as const)
      : result;
  } catch {
    return { code: "unavailable" } as const;
  }
}
