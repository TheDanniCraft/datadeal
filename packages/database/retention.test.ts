import { expect, it } from "vitest";
import postgres from "postgres";
import { connect } from "./index";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
it.skipIf(!url)("prunes only expired private records", async () => {
  const db = connect(url!);
  const sql = postgres(url!);
  try {
    await sql`insert into "user"(id, name, email) values ('retention', 'Retention Test', 'retention@example.test')`;
    await sql`insert into session(id, "expiresAt", token, "userId") values
      ('expired', now() - interval '1 second', 'old-test-token', 'retention'),
      ('current', now() + interval '1 day', 'new-test-token', 'retention')`;
    await sql`insert into verification(id, identifier, value, "expiresAt") values
      ('expired', 'expired', 'test', now() - interval '1 second'),
      ('current', 'current', 'test', now() + interval '1 day')`;
    await sql`insert into "rateLimit"(id, key, count, "lastRequest") values
      ('expired', 'expired', 1, (extract(epoch from now() - interval '2 days') * 1000)::bigint),
      ('current', 'current', 1, (extract(epoch from now()) * 1000)::bigint)`;
    await sql`insert into scan_request_limits(bucket, hour, hits) values
      ('expired', date_trunc('hour', now()) - interval '2 hours', 1),
      ('current', date_trunc('hour', now()), 1)`;
    expect(await db.pruneExpiredPrivateData()).toEqual({
      sessions: 1,
      verifications: 1,
      authLimits: 1,
      scanLimits: 1,
      scanRewards: 0,
      scanArtifacts: 0,
    });
    expect(await db.pruneExpiredPrivateData()).toEqual({
      sessions: 0,
      verifications: 0,
      authLimits: 0,
      scanLimits: 0,
      scanRewards: 0,
      scanArtifacts: 0,
    });
    expect(
      await sql`select id from session where "userId" = 'retention'`,
    ).toEqual([{ id: "current" }]);
    expect(
      await sql`select id from verification where id = 'current'`,
    ).toHaveLength(1);
    expect(
      await sql`select id from "rateLimit" where id = 'current'`,
    ).toHaveLength(1);
    expect(
      await sql`select bucket from scan_request_limits where bucket = 'current'`,
    ).toHaveLength(1);
  } finally {
    await sql.end();
    await db.close();
  }
});
