import { expect, it } from "vitest";
import postgres from "postgres";
import { connect } from "./index";
import { activatePro, insertTestUser } from "./test-support";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
it.skipIf(!url)(
  "lets any account save sites, isolates lists and keeps removal working",
  async () => {
    const sql = postgres(url!);
    const db = connect(url!);
    let watcher = "";
    let free = "";
    try {
      watcher = await insertTestUser(sql, "watcher");
      free = await insertTestUser(sql, "watcher-free");
      // Saving is free with an account.
      expect(await db.saveWatchlistDomain(free, "example.net")).toBe("saved");
      expect(await db.isSaved(free, "example.net")).toBe(true);
      await activatePro(db, watcher);
      await Promise.all([
        db.saveWatchlistDomain(watcher, "Example.org"),
        db.saveWatchlistDomain(watcher, "example.org"),
      ]);
      expect(await db.listWatchlist(watcher)).toMatchObject([
        { domain: "example.org" },
      ]);
      expect(await db.listWatchlist(free)).toMatchObject([
        { domain: "example.net", document_alerts: false },
      ]);
      await db.removeWatchlistDomain(free, "example.org");
      expect(await db.listWatchlist(watcher)).toHaveLength(1);
      await sql`update subscriptions set status = 'expired' where user_id = ${watcher}`;
      expect(await db.saveWatchlistDomain(watcher, "example.com")).toBe(
        "saved",
      );
      await db.removeWatchlistDomain(watcher, "example.com");
      await db.removeWatchlistDomain(watcher, "example.org");
      expect(await db.listWatchlist(watcher)).toHaveLength(0);
    } finally {
      await sql`delete from "user" where id in (${watcher}, ${free})`;
      await sql.end();
      await db.close();
    }
  },
);
