import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import postgres from "postgres";
import { connect, type ApiTokenRecord } from "./index";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
const hash = () => createHash("sha256").update(randomBytes(32)).digest("hex");

it.skipIf(!url)(
  "admits only one concurrent request at the token limit",
  async () => {
    await withAccounts(async (db, sql, owner) => {
      const digest = hash();
      const token = (await db.createApiToken(owner, {
        label: "Rate limited",
        hash: digest,
      }))!;
      const [{ retryAfter }] = await sql<{ retryAfter: number }[]>`
      select (60 - mod(floor(extract(epoch from now()))::bigint, 60))::int as "retryAfter"`;
      if (retryAfter <= 2) await sql`select pg_sleep(${retryAfter})`;
      await sql`update api_tokens
      set request_minute = floor(extract(epoch from now()) / 60), request_count = 59
      where id = ${token.id}`;
      const results = await Promise.all(
        Array.from({ length: 4 }, () => db.verifyApiToken(token.id, digest)),
      );
      expect(results.filter((item) => item && "userId" in item)).toHaveLength(
        1,
      );
      expect(
        results.filter((item) => item && "retryAfter" in item),
      ).toHaveLength(3);
      await sql`update api_tokens set request_minute = request_minute - 1
      where id = ${token.id}`;
      expect(await db.verifyApiToken(token.id, digest)).toEqual({
        userId: owner,
        scope: "reports:read",
      });
    });
  },
);

async function withAccounts(
  run: (
    db: ReturnType<typeof connect>,
    sql: ReturnType<typeof postgres>,
    owner: string,
    other: string,
  ) => Promise<void>,
) {
  const db = connect(url!);
  const sql = postgres(url!);
  const [owner, other] = [randomUUID(), randomUUID()];
  try {
    await sql`insert into "user"(id, name, email) values
      (${owner}, 'Token owner', ${owner + "@example.test"}),
      (${other}, 'Other account', ${other + "@example.test"})`;
    await run(db, sql, owner, other);
  } finally {
    await Promise.all([db.close(), sql.end()]);
  }
}

it.skipIf(!url)(
  "stores only a token digest and scopes lifecycle operations to its owner",
  async () => {
    await withAccounts(async (db, sql, owner, other) => {
      const firstDigest = hash();
      const newDigest = hash();
      const foreignDigest = hash();
      expect(
        await db.createApiToken(randomUUID(), {
          label: "Missing",
          hash: firstDigest,
        }),
      ).toBeNull();
      const token = await db.createApiToken(owner, {
        label: " Reports ",
        hash: firstDigest,
      });
      expect(token).toEqual({
        id: expect.any(String),
        label: "Reports",
        scope: "reports:read",
        createdAt: expect.any(Date),
        rotatedAt: null,
        lastUsedAt: null,
        revokedAt: null,
      });
      if (!token) throw new Error("Token creation failed");
      expect(
        await sql`select token_hash from api_tokens where id = ${token.id}`,
      ).toEqual([{ token_hash: firstDigest }]);
      expect(await db.listApiTokens(other)).toEqual([]);
      expect(await db.rotateApiToken(other, token.id, newDigest)).toBeNull();
      expect(await db.revokeApiToken(other, token.id)).toBe(false);
      expect(await db.verifyApiToken(token.id, hash())).toBeNull();
      expect(await db.verifyApiToken("invalid-id", firstDigest)).toBeNull();
      expect(await db.listApiTokens(owner)).toEqual([token]);
      expect(await db.verifyApiToken(token.id, firstDigest)).toEqual({
        userId: owner,
        scope: "reports:read",
      });
      expect(await db.listApiTokens(owner)).toEqual([
        { ...token, lastUsedAt: expect.any(Date) },
      ]);
      expect(
        await db.createApiToken(other, {
          label: "Foreign",
          hash: foreignDigest,
        }),
      ).not.toBeNull();
      expect(
        await db.rotateApiToken(owner, token.id, foreignDigest),
      ).toBeNull();
      const rotated = await db.rotateApiToken(owner, token.id, newDigest);
      expect(rotated).toMatchObject({
        id: token.id,
        createdAt: token.createdAt,
        rotatedAt: expect.any(Date),
        lastUsedAt: expect.any(Date),
      });
      expect(await db.rotateApiToken(owner, token.id, newDigest)).toBeNull();
      expect(await db.verifyApiToken(token.id, firstDigest)).toBeNull();
      expect(await db.verifyApiToken(token.id, newDigest)).toEqual({
        userId: owner,
        scope: "reports:read",
      });
      expect(await db.revokeApiToken(owner, token.id)).toBe(true);
      expect(await db.revokeApiToken(owner, token.id)).toBe(false);
      expect(await db.rotateApiToken(owner, token.id, hash())).toBeNull();
      expect(await db.verifyApiToken(token.id, newDigest)).toBeNull();
      expect(
        await sql`select token_hash from api_tokens where id = ${token.id}`,
      ).toEqual([{ token_hash: null }]);
      expect((await db.listApiTokens(owner))[0].revokedAt).toBeInstanceOf(Date);
      await sql`delete from "user" where id = ${owner}`;
      expect(await db.listApiTokens(owner)).toEqual([]);
      expect(await db.listApiTokens(other)).toHaveLength(1);
    });
  },
);

it.skipIf(!url)(
  "atomically caps active tokens and bounds revoked token history",
  async () => {
    await withAccounts(async (db, _sql, owner, other) => {
      const creates = await Promise.all(
        Array.from({ length: 14 }, () =>
          db.createApiToken(owner, { label: "Concurrent", hash: hash() }),
        ),
      );
      const active = creates.filter((token): token is ApiTokenRecord =>
        Boolean(token),
      );
      expect(active).toHaveLength(10);
      expect(
        await db.createApiToken(other, {
          label: "Other account",
          hash: hash(),
        }),
      ).not.toBeNull();
      let current = active[0];
      for (let index = 0; index < 23; index++) {
        expect(await db.revokeApiToken(owner, current.id)).toBe(true);
        const replacement = await db.createApiToken(owner, {
          label: "Replacement",
          hash: hash(),
        });
        if (!replacement) throw new Error("Revoked token did not free a slot");
        current = replacement;
      }
      const tokens = await db.listApiTokens(owner);
      expect(tokens.filter(({ revokedAt }) => !revokedAt)).toHaveLength(10);
      expect(tokens.filter(({ revokedAt }) => revokedAt)).toHaveLength(20);
      expect(tokens.find(({ id }) => id === active[0].id)).toBeUndefined();
    });
  },
);
