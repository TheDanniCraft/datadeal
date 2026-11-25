import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, it } from "vitest";
import { connect } from "./index";

const url = process.env.DATADEAL_TEST_DATABASE_URL;

it.skipIf(!url)(
  "uses the same stable order for an archived report and its previous publication",
  async () => {
    const db = connect(url!);
    const sql = postgres(url!);
    const host = randomUUID() + ".example.com";
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
    try {
      await sql`insert into domains (name) values (${host})`;
      for (const [index, id] of ids.entries()) {
        await sql`insert into scans (id,domain,state,requested_at,report) values
        (${id},${host},${index === 1 ? "failed" : "completed"},'2026-01-01T00:00:00Z',
         jsonb_build_object('demo',false,'id',${id}::text))`;
      }
      expect(await db.archivedReports(host, ids[2]!, false)).toEqual([
        { report: { id: ids[2], demo: false } },
        { report: { id: ids[0], demo: false } },
      ]);
      expect(await db.archivedReports(host, ids[1]!, false)).toEqual([]);
    } finally {
      await sql`delete from scans where domain=${host}`;
      await sql`delete from domains where name=${host}`;
      await Promise.all([db.close(), sql.end()]);
    }
  },
);

it.skipIf(!url)(
  "finds a published report displaced by a queued rescan",
  async () => {
    const db = connect(url!);
    const sql = postgres(url!);
    const host = randomUUID() + ".example.com";
    const previous = randomUUID();
    try {
      await sql`insert into domains (name) values (${host})`;
      await sql`insert into scans (id, domain, state, requested_at, report)
      values (${previous}, ${host}, 'completed', now() - interval '21 hours',
        jsonb_build_object('id', ${previous}::text))`;
      await sql`insert into scans (id, domain, state, requested_at)
      select gen_random_uuid(), ${host}, 'failed', now() - make_interval(hours => age)
      from generate_series(2, 20) as age`;
      expect((await db.list(host)).at(-1)?.id).toBe(previous);

      const rescan = await db.requestScan(host, null, null);
      expect(rescan.code).toBe("accepted");
      const history = await db.list(host);
      expect(history[0]?.state).toBe("queued");
      expect(history.some(({ id }) => id === previous)).toBe(false);
      expect(await db.olderPublishedReports(host, history.at(-1)!.id)).toEqual([
        { id: previous, state: "completed", report: { id: previous } },
      ]);
    } finally {
      await sql`delete from scan_jobs where scan_id in (select id from scans where domain = ${host})`;
      await sql`delete from scans where domain = ${host}`;
      await sql`delete from domains where name = ${host}`;
      await Promise.all([db.close(), sql.end()]);
    }
  },
);
