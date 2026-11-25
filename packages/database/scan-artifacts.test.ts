import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, it, vi } from "vitest";
import type { Evidence, ScanReport } from "@datadeal/contracts";
import { connect } from "./index";
import { postgresScanArtifacts } from "./scan-artifacts";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
it.skipIf(!url)(
  "publishes bounded sanitized capture objects under the scan lease, expires bytes and retains the report",
  async () => {
    const db = connect(url!),
      sql = postgres(url!);
    const id = randomUUID(),
      host = "manifest-" + id + ".example.org",
      owner = randomUUID(),
      stamp = "2026-01-05T01:02:03.123Z";
    const secret = "private-value-that-must-not-enter-capture";
    const base = {
      scanId: id,
      retrievedAt: stamp,
      excerpt: secret,
      id: secret,
      url: "https://" + host + "/private-path?token=" + secret,
    };
    const digest = createHash("sha256")
      .update("fixture document text")
      .digest("hex");
    const visit: Evidence = {
      ...base,
      kind: "observed_technical",
      consentScenario: "accepted",
      observation: {
        type: "browser_consent_counts",
        requests: 11,
        cookies: 0,
        storage: { localEntries: 0, sessionEntries: 1 },
        externalDomains: ["external.example.org"],
        afterChoice: { requests: 4, externalDomains: [], acceptedAll: true },
      },
    };
    const source: Evidence = {
      ...base,
      kind: "declared_first_party",
      hash: digest,
      documentKind: "privacy",
    };
    const evidence: Evidence[] = [
      {
        ...base,
        kind: "observed_technical",
        observation: {
          type: "response_cookie_attributes",
          count: 2,
          secure: 1,
          httpOnly: 2,
          sameSite: 1,
        },
      },
      source,
      visit,
      { ...source, id: "unrelated-doc", scanId: randomUUID() },
      { ...base, kind: "unknown" },
      ...Array.from({ length: 130 }, () => visit),
    ];
    const report: ScanReport = {
      id,
      domain: host,
      partial: true,
      demo: false,
      completedAt: stamp,
      evidence,
      findings: [],
    };
    try {
      await sql`insert into domains(name) values(${host})`;
      await sql`insert into scans(id,domain,state) values(${id},${host},'fetching')`;
      await sql`insert into scan_jobs(scan_id,owner,lease_until) values(${id},${owner},now()+interval '1 hour')`;
      expect(await db.finish(id, randomUUID(), report)).toBe(false);
      expect(
        await sql`select scan_id from scan_artifacts where scan_id=${id}`,
      ).toHaveLength(0);
      // An object-write conflict must roll back both snapshot publication and lease release.
      await sql`insert into scan_artifacts(scan_id,version,content,sha256) values(${id},1,'{}',${createHash("sha256").update("{}").digest("hex")})`;
      await expect(db.finish(id, owner, report)).rejects.toThrow(
        "Conflicting immutable",
      );
      const [stillOwned] =
        await sql`select s.state,s.report,j.owner from scans s join scan_jobs j on j.scan_id=s.id where s.id=${id}`;
      expect(stillOwned).toMatchObject({
        state: "fetching",
        report: null,
        owner,
      });
      await sql`delete from scan_artifacts where scan_id=${id}`;
      expect(await db.finish(id, owner, report)).toBe(true);
      const object = await db.getScanArtifact(host, id);
      expect(object).not.toBeNull();
      const { manifest } = object!;
      expect(manifest.observations).toHaveLength(128);
      expect(manifest.omitted).toBe(5);
      expect(manifest.observations.slice(0, 3)).toMatchObject([
        { type: "response_cookie_attributes", evidenceIndex: 0, count: 2 },
        {
          type: "document_digest",
          evidenceIndex: 1,
          documentKind: "privacy",
          textSha256: digest,
        },
        {
          type: "browser_consent_counts",
          evidenceIndex: 2,
          scenario: "accepted",
          afterChoiceRequests: 4,
          acceptedAll: true,
        },
      ]);
      const content = JSON.stringify(manifest);
      expect(content).not.toContain(secret);
      expect(content).not.toContain(host);
      expect(content).not.toContain("external.example.org");
      expect(object!.sha256).toBe(
        createHash("sha256").update(content).digest("hex"),
      );
      expect(object!.byteLength).toBe(Buffer.byteLength(content));
      expect(object!.byteLength).toBeLessThanOrEqual(65536);
      const [lifetime] =
        await sql`select expires_at=created_at+interval '30 days' as expected from scan_artifacts where scan_id=${id}`;
      expect(lifetime.expected).toBe(true);
      const originalExpiry = object!.expiresAt;
      const storage = postgresScanArtifacts(sql);
      await storage.put(report);
      expect((await db.getScanArtifact(host, id))!.expiresAt).toBe(
        originalExpiry,
      );
      await expect(
        storage.put({ ...report, evidence: [source] }),
      ).rejects.toThrow("Conflicting immutable");
      expect(await db.getScanArtifact("other.example.org", id)).toBeNull();
      expect(await db.getScanArtifact(host, randomUUID())).toBeNull();
      const demoId = randomUUID();
      await storage.put({ ...report, id: demoId, demo: true });
      await storage.put({ ...report, id: demoId, evidence: [] });
      expect(
        await sql`select scan_id from scan_artifacts where scan_id=${demoId}`,
      ).toHaveLength(0);
      await sql`update scan_artifacts set sha256=repeat('0',64) where scan_id=${id}`;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(await db.getScanArtifact(host, id)).toBeNull();
        expect(warn).toHaveBeenCalledWith(
          JSON.stringify({
            event: "scan_artifact_digest_mismatch",
            scanId: id,
          }),
        );
      } finally {
        warn.mockRestore();
      }
      await sql`update scan_artifacts set expires_at=now()-interval '1 second' where scan_id=${id}`;
      expect(await db.getScanArtifact(host, id)).toBeNull();
      expect(
        (await db.pruneExpiredPrivateData()).scanArtifacts,
      ).toBeGreaterThanOrEqual(1);
      expect(
        await sql`select content from scan_artifacts where scan_id=${id}`,
      ).toHaveLength(0);
      expect((await db.archivedReports(host, id, false))[0]).toBeDefined();
    } finally {
      await Promise.all([db.close(), sql.end()]);
    }
  },
);
