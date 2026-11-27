import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";

/**
 * Helpers for the PostgreSQL tests, which run only with
 * DATADEAL_TEST_DATABASE_URL. Point it at a dedicated test database: the
 * helpers remove queued test jobs and reset the shared hourly scan limit.
 */

/** A unique, non-reserved host, so public listings include it. */
export const testHost = (label = "site") =>
  `${label}.${randomUUID()}.dd-test.dev`;

/** A unique id for fixed test records (users, subscriptions, events). */
export const testId = (label: string) => `${label}-${randomUUID()}`;

/**
 * Tests that claim jobs expect an empty queue. Drops jobs left behind by
 * earlier test runs (test hosts only) and the global hourly request bucket.
 */
export async function resetTestQueue(sql: Sql) {
  await sql`with dropped as (
      delete from scan_jobs where scan_id in (
        select id from scans
        where domain ~ '(^|\\.)(example\\.(com|org|net)|dd-test\\.dev|example|test)$')
      returning scan_id
    ) update scans set state = 'failed' where id in (select scan_id from dropped)`;
  await sql`delete from scan_request_limits where bucket = 'global'`;
}

export async function insertTestUser(sql: Sql, label: string) {
  const id = testId(label);
  await sql`insert into "user"(id, name, email)
    values (${id}, ${label}, ${id + "@example.test"})`;
  return id;
}

export async function activatePro(
  db: {
    applyBillingEvent: (event: {
      id: string;
      time: number;
      subscription: string;
      customer: string;
      product: string;
      status: string;
      userId?: string;
      accessUntil?: string;
    }) => Promise<unknown>;
  },
  userId: string,
) {
  await db.applyBillingEvent({
    id: testId("paid"),
    time: 1,
    subscription: testId("sub"),
    customer: testId("customer"),
    product: "test-pro",
    status: "active",
    userId,
    accessUntil: "2099-01-01T00:00:00Z",
  });
}
