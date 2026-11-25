import postgres, { type Sql } from "postgres";

export type ApiTokenRecord = {
  id: string;
  label: string;
  scope: "reports:read" | "scans:request";
  createdAt: Date;
  rotatedAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

type ApiTokenRow = Omit<
  ApiTokenRecord,
  "createdAt" | "rotatedAt" | "lastUsedAt" | "revokedAt"
> & {
  createdAt: Date | string;
  rotatedAt: Date | string | null;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
};

function tokenMetadata(token: ApiTokenRow): ApiTokenRecord {
  return {
    ...token,
    createdAt: new Date(token.createdAt),
    rotatedAt: token.rotatedAt === null ? null : new Date(token.rotatedAt),
    lastUsedAt: token.lastUsedAt === null ? null : new Date(token.lastUsedAt),
    revokedAt: token.revokedAt === null ? null : new Date(token.revokedAt),
  };
}

const sha256 = /^[a-f0-9]{64}$/;
const tokenId =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const activeTokenLimit = 10;
const revokedTokenHistory = 20;
const requestsPerMinute = 60;

export function apiTokenStorage(sql: Sql) {
  const metadata = sql`id, label, scope, created_at as "createdAt", rotated_at as "rotatedAt",
    last_used_at as "lastUsedAt", revoked_at as "revokedAt"`;

  return {
    async createApiToken(
      userId: string,
      {
        label,
        hash,
        scope = "reports:read",
      }: {
        label: string;
        hash: string;
        scope?: ApiTokenRecord["scope"];
      },
    ) {
      const name = label.trim();
      if (!name || name.length > 80 || !sha256.test(hash)) return null;
      return sql.begin(async (tx) => {
        // Serialize token creation per account, including when it has no tokens yet.
        const [owner] = await tx`
          select id from "user" where id = ${userId} for no key update`;
        if (!owner) return null;
        const [token] = await tx<ApiTokenRow[]>`
          insert into api_tokens(user_id, label, token_hash, scope)
          select ${userId}, ${name}, ${hash}, ${scope}
          where (
            select count(*) from api_tokens where user_id = ${userId} and revoked_at is null
          ) < ${activeTokenLimit}
          on conflict (token_hash) do nothing
          returning ${metadata}`;
        if (!token) return null;
        await tx`
          delete from api_tokens where id in (
            select id from api_tokens where user_id = ${userId} and revoked_at is not null
            order by revoked_at desc, id offset ${revokedTokenHistory}
          )`;
        return tokenMetadata(token);
      });
    },
    async listApiTokens(userId: string) {
      const tokens = await sql<ApiTokenRow[]>`
        select ${metadata} from api_tokens where user_id = ${userId}
        order by created_at desc, id`;
      return tokens.map(tokenMetadata);
    },
    async rotateApiToken(userId: string, id: string, replacementHash: string) {
      if (!tokenId.test(id) || !sha256.test(replacementHash)) return null;
      try {
        const [token] = await sql<ApiTokenRow[]>`
          update api_tokens
          set token_hash = ${replacementHash}, rotated_at = now()
          where id = ${id} and user_id = ${userId} and revoked_at is null
            and token_hash <> ${replacementHash}
          returning ${metadata}`;
        return token ? tokenMetadata(token) : null;
      } catch (error) {
        if (
          error instanceof postgres.PostgresError &&
          error.code === "23505" &&
          error.constraint_name === "api_tokens_token_hash_key"
        )
          return null;
        throw error;
      }
    },
    async revokeApiToken(userId: string, id: string) {
      if (!tokenId.test(id)) return false;
      const [token] = await sql`
        update api_tokens set revoked_at = now(), token_hash = null
        where id = ${id} and user_id = ${userId} and revoked_at is null
        returning id`;
      return Boolean(token);
    },
    async verifyApiToken(id: string, hash: string) {
      if (!tokenId.test(id) || !sha256.test(hash)) return null;
      return sql.begin(async (tx) => {
        const [token] = await tx<
          {
            userId: string;
            scope: ApiTokenRecord["scope"];
            count: number;
            retryAfter: number;
          }[]
        >`
          select user_id as "userId", scope,
            case when request_minute = floor(extract(epoch from now()) / 60)
              then request_count else 0 end as count,
            (60 - mod(floor(extract(epoch from now()))::bigint, 60))::int as "retryAfter"
          from api_tokens
          where id = ${id} and token_hash = ${hash} and revoked_at is null
          for update`;
        if (!token) return null;
        if (token.count >= requestsPerMinute)
          return { retryAfter: token.retryAfter };
        await tx`
          update api_tokens set last_used_at = now(), request_count = ${token.count + 1},
            request_minute = floor(extract(epoch from now()) / 60)
          where id = ${id}`;
        return { userId: token.userId, scope: token.scope };
      });
    },
  };
}
