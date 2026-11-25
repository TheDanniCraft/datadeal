import { createHash } from "node:crypto";
import type { Evidence, ScanReport } from "@datadeal/contracts";
import type { Sql, TransactionSql } from "postgres";

const version = 1;
const observationLimit = 128;
const digest = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");

function capture(source: Evidence, evidenceIndex: number) {
  const item = source.observation;
  const position = {
    evidenceIndex,
    retrievedAt: new Date(source.retrievedAt).toISOString(),
  };
  if (
    source.kind === "declared_first_party" &&
    source.hash &&
    /^[a-f0-9]{64}$/.test(source.hash)
  ) {
    return {
      ...position,
      type: "document_digest" as const,
      documentKind: source.documentKind ?? "other",
      textSha256: source.hash,
    };
  }
  if (source.kind !== "observed_technical") return;
  if (item?.type === "response_cookie_attributes") {
    return {
      ...position,
      type: item.type,
      count: item.count,
      secure: item.secure,
      httpOnly: item.httpOnly,
      sameSite: item.sameSite,
    };
  }
  if (
    (item?.type !== "browser_content_page" &&
      item?.type !== "browser_consent_counts") ||
    !source.consentScenario
  )
    return;
  return {
    ...position,
    type: item.type,
    scenario: source.consentScenario,
    ...(item.finalPageKnown !== undefined && {
      finalPageKnown: item.finalPageKnown,
    }),
    requestsAttempted: item.requests,
    outsideDomainsListed: item.externalDomains.length,
    endCookies: item.cookies,
    ...(item.storage && {
      endLocalEntries: item.storage.localEntries,
      endSessionEntries: item.storage.sessionEntries,
    }),
    ...(item.afterChoice && {
      afterChoiceRequests: item.afterChoice.requests,
      ...(item.afterChoice.acceptedAll !== undefined && {
        acceptedAll: item.afterChoice.acceptedAll,
      }),
    }),
  };
}

type Capture = NonNullable<ReturnType<typeof capture>>;
function captureManifest(report: ScanReport) {
  if (report.demo) return null;
  const observations: Capture[] = [];
  let omitted = 0;
  for (const [index, source] of report.evidence.entries()) {
    if (source.scanId !== report.id) continue;
    const row = capture(source, index);
    if (!row) continue;
    if (observations.length < observationLimit) observations.push(row);
    else omitted++;
  }
  if (!observations.length) return null;
  return {
    version,
    scanId: report.id,
    completedAt: new Date(report.completedAt).toISOString(),
    observations,
    omitted,
  };
}
type CaptureManifest = NonNullable<ReturnType<typeof captureManifest>>;
type ExportedArtifact = {
  key: string;
  sha256: string;
  byteLength: number;
  expiresAt: string;
  manifest: CaptureManifest;
};

// Publish within the scan's lease-checked transaction. Readers can only
// retrieve a particular published object's exact domain and scan ID.
export interface ScanArtifactStore {
  put(report: ScanReport): Promise<void>;
  get(domain: string, scanId: string): Promise<ExportedArtifact | null>;
  pruneExpired(): Promise<number>;
}

export function postgresScanArtifacts(
  sql: Sql | TransactionSql,
): ScanArtifactStore {
  return {
    async put(report) {
      const manifest = captureManifest(report);
      if (!manifest) return;
      // UTF-8 JSON in this field order is the v1 byte representation. TEXT
      // preserves it, unlike JSONB, which normalizes JSON object keys.
      const content = JSON.stringify(manifest);
      const sha256 = digest(content);
      const inserted =
        await sql`insert into scan_artifacts(scan_id,version,content,sha256)
        values(${report.id},${version},${content},${sha256})
        on conflict(scan_id,version) do nothing returning scan_id`;
      if (inserted.length) return;
      const [existing] =
        await sql`select sha256 from scan_artifacts where scan_id=${report.id} and version=${version}`;
      if (existing?.sha256 !== sha256)
        throw new Error("Conflicting immutable scan artifact");
    },
    async get(domain, scanId) {
      const [row] = await sql<
        { content: string; sha256: string; expires_at: Date | string }[]
      >`
        select a.content,a.sha256,a.expires_at from scan_artifacts a join scans s on s.id=a.scan_id
        where a.scan_id=${scanId} and a.version=${version} and a.expires_at>now()
          and s.domain=${domain} and s.state in ('completed','partially_completed') and s.report->>'demo'='false'`;
      if (!row) return null;
      if (digest(row.content) !== row.sha256) {
        // A damaged optional object must not prevent exporting its published snapshot.
        console.warn(
          JSON.stringify({ event: "scan_artifact_digest_mismatch", scanId }),
        );
        return null;
      }
      return {
        key: `scans/${scanId}/capture-v${version}.json`,
        sha256: row.sha256,
        byteLength: Buffer.byteLength(row.content, "utf8"),
        expiresAt: new Date(row.expires_at).toISOString(),
        manifest: JSON.parse(row.content) as CaptureManifest,
      };
    },
    async pruneExpired() {
      const rows =
        await sql`delete from scan_artifacts where (scan_id,version) in (
        select scan_id,version from scan_artifacts where expires_at<=now()
        order by expires_at limit 500 for update skip locked
      ) returning scan_id`;
      return rows.length;
    },
  };
}
