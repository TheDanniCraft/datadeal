import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import postgres from "../../packages/database/node_modules/postgres";
import { hasAdvancedSnapshotDetails } from "../../apps/web/lib/browser-summary";

// Copy only eligible public snapshots. The destination starts without accounts,
// payments, captures or entitlements.
const domain = process.env.DATADEAL_SELF_ASSESSMENT_DOMAIN!;
const source = new URL(
  process.env.DATADEAL_SELF_ASSESSMENT_SOURCE_URL ||
    parseEnv(await readFile("apps/web/.env.local", "utf8")).DATABASE_URL,
);
const target = new URL(process.env.DATADEAL_TEST_DATABASE_URL!);
if (
  ![source, target].every((db) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(db.hostname),
  ) ||
  (source.port === target.port && source.pathname === target.pathname)
)
  throw new Error(
    "The report source and assessment database must be distinct loopback databases.",
  );
const src = postgres(source.href),
  dest = postgres(target.href);
try {
  const handoff = process.env.DATADEAL_REWARD_HANDOFF_TEST === "true";
  const needed = handoff ? 2 : 1;
  const rows =
    await src`select id, domain, state, requested_at, report from scans where domain=${domain} and state in ('completed','partially_completed') and report->'demo'='false'::jsonb order by requested_at desc, id desc limit ${handoff ? 20 : 1}`;
  const scans = rows
    .filter((row) => hasAdvancedSnapshotDetails(row.report))
    .slice(0, needed);
  if (scans.length !== needed)
    throw new Error(
      `Choose a domain with ${needed} published advanced report(s) in the local store.`,
    );
  await dest.begin(async (tx) => {
    await tx`insert into domains(name) values(${domain})`;
    for (const scan of scans)
      await tx`insert into scans(id,domain,state,requested_at,report) values(${scan.id},${domain},${scan.state},${scan.requested_at},${tx.json(scan.report)})`;
  });
  if (handoff) console.log(scans[1].id);
} finally {
  await Promise.all([src.end(), dest.end()]);
}
