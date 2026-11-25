import { creemCreditsClient } from "@datadeal/database";
import { database } from "./reports";

type Charge = { key: string; amount: number; requestHash: string };

export async function nativeApiUsage(
  userId: string,
  charge: Charge,
  domain: string,
  name: "datadeal_report_read" | "datadeal_scan_requested",
  loadReport?: () => Promise<object | null>,
) {
  if (!database) return { code: "unavailable" } as const;
  // Preserve idempotency for local operations accepted before native cutover.
  const legacy = await database.apiCreditReplay(
    userId,
    charge.key,
    charge.requestHash,
  );
  if (legacy) return legacy;
  const provider = creemCreditsClient();
  if (!provider) return { code: "unavailable" } as const;
  let intent = await database.lookupNativeUsage(
    userId,
    charge.key,
    charge.requestHash,
  );
  if (!intent) {
    const payload = loadReport ? await loadReport() : null;
    if (loadReport && !payload) return { code: "report_unavailable" } as const;
    const binding = await database.creemCreditAccount(userId);
    if (!binding) return { code: "insufficient" } as const;
    intent = await database.reserveNativeUsage(
      userId,
      charge,
      binding,
      domain,
      name,
      payload,
    );
  }
  if (intent.conflict) return { code: "conflict" } as const;
  return database.serveNativeUsage(intent.id, provider);
}
