import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const directory = new URL("./migrations/", import.meta.url);
const migrations = (await readdir(directory))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  const applied = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('datadeal-schema-migrations'))`;
    await tx`create table if not exists datadeal_schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now()
    )`;
    const recorded =
      await tx`select name, checksum from datadeal_schema_migrations`;
    const checksums = new Map(
      recorded.map(({ name, checksum }) => [name, checksum]),
    );
    const applied = [];
    for (const name of migrations) {
      const source = (
        await readFile(new URL(name, directory), "utf8")
      ).replaceAll("\r\n", "\n");
      const checksum = createHash("sha256").update(source).digest("hex");
      if (checksums.has(name)) {
        if (checksums.get(name) !== checksum)
          throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      const body = source.trim().match(/^BEGIN;\s*([\s\S]+?)\s*COMMIT;$/i)?.[1];
      if (!body) throw new Error(`Expected transaction wrapper in ${name}`);
      await tx.unsafe(body).simple();
      await tx`insert into datadeal_schema_migrations (name, checksum) values (${name}, ${checksum})`;
      applied.push(name);
    }
    return applied;
  });
  console.log(
    applied.length
      ? `Applied ${applied.length} migrations`
      : "Database schema is up to date",
  );
} finally {
  await sql.end();
}
