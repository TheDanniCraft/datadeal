import {
  buildStorageInventory,
  storageInventory,
  type InventoryClassification,
  type StorageInventory,
} from "@datadeal/contracts/storage-inventory";
import type { Evidence, ScanReport } from "@datadeal/contracts";
import { inventoryPromptVersion, type EvidenceAnalyzer } from "@datadeal/ai";

type Research = (
  scanId: string,
  vendor: string,
  referringEvidenceId: string,
  signal: AbortSignal,
) => Promise<Evidence[]>;

const unresolved = (c: InventoryClassification | undefined) =>
  !c || c.purpose === "unknown" || c.controller === "unknown";

/**
 * Scoring v2: classify every storage item and recipient, research up to three
 * vendors for what remains unknown, then classify those items again with the
 * vendor's own documentation. Researched passages are added to the report as
 * cited third-party evidence.
 */
export async function analyzeInventory(
  analyzer: EvidenceAnalyzer,
  report: ScanReport,
  research: Research,
  stillOwned: () => Promise<boolean> = async () => true,
): Promise<StorageInventory | undefined> {
  if (!analyzer.classifyInventory) return undefined;
  const base = buildStorageInventory(report);
  const empty = { classifications: [], research: [] };
  if (!base.storage.length && !base.recipients.length)
    return storageInventory.parse({ ...base, ...empty });
  if (!(await stillOwned())) return undefined;
  // Classification takes several model calls; the job lease is short, so keep
  // renewing it while we work and give up if another worker took the job.
  let owned = true;
  const heartbeat = setInterval(() => {
    void stillOwned().then((ok) => {
      if (!ok) owned = false;
    });
  }, 20_000);
  try {
    return owned ? await classifyAndResearch() : undefined;
  } finally {
    clearInterval(heartbeat);
  }
  async function classifyAndResearch() {
    const first = await analyzer.classifyInventory!(base, report.evidence);
    const byId = new Map(first.classifications.map((c) => [c.itemId, c]));
    const allIds = [...base.storage, ...base.recipients].map(({ id }) => id);
    const researched: StorageInventory["research"] = [];
    const open = allIds.filter((id) => unresolved(byId.get(id)));
    if (first.research.length && open.length) {
      for (const domain of first.research) {
        const recipient = base.recipients.find((r) => r.domain === domain);
        if (!recipient) continue;
        const rows = await research(
          report.id,
          domain,
          recipient.evidenceIds[0],
          AbortSignal.timeout(8000),
        ).catch(() => []);
        const taken = new Set(report.evidence.map(({ id }) => id));
        const fresh = rows.filter(({ id }) => !taken.has(id));
        report.evidence.push(...fresh);
        researched.push({
          domain,
          status: fresh.length ? "fetched" : "unavailable",
          evidenceIds: fresh.slice(0, 4).map(({ id }) => id),
        });
      }
      if (researched.some(({ status }) => status === "fetched") && owned) {
        const second = await analyzer.classifyInventory!(
          base,
          report.evidence,
          open,
        );
        for (const c of second.classifications)
          if (unresolved(byId.get(c.itemId)) && !unresolved(c))
            byId.set(c.itemId, c);
      }
    }
    if (!owned) return undefined;
    return storageInventory.parse({
      ...base,
      classifications: allIds.flatMap((id) => byId.get(id) ?? []),
      research: researched,
      model: analyzer.model.slice(0, 160),
      promptVersion: inventoryPromptVersion,
    });
  }
}
