import { expect, it } from "vitest";
import postgres from "postgres";
import { connect } from "./index";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
it.skipIf(!url)(
  "enforces Pro and isolates watchlists, including removal after expiry",
  async () => {
    const sql = postgres(url!);
    const db = connect(url!);
    try {
      await sql`insert into "user"(id, name, email) values ('watcher','Watcher','watcher@example.test'),
      ('watcher-free','Free','watcher-free@example.test')`;
      expect(await db.saveWatchlistDomain("watcher-free", "example.org")).toBe(
        "forbidden",
      );
      await db.applyBillingEvent({
        id: "watchlist-paid",
        time: 1,
        subscription: "watchlist-sub",
        customer: "watchlist-cust",
        product: "watchlist-product",
        status: "active",
        userId: "watcher",
        accessUntil: "2099-01-01T00:00:00Z",
      });
      await Promise.all([
        db.saveWatchlistDomain("watcher", "Example.org"),
        db.saveWatchlistDomain("watcher", "example.org"),
      ]);
      expect(await db.listWatchlist("watcher")).toMatchObject([
        { domain: "example.org" },
      ]);
      expect(await db.listWatchlist("watcher-free")).toEqual([]);
      await db.removeWatchlistDomain("watcher-free", "example.org");
      expect(await db.listWatchlist("watcher")).toHaveLength(1);
      await sql`update subscriptions set status = 'expired' where user_id = 'watcher'`;
      expect(await db.saveWatchlistDomain("watcher", "example.com")).toBe(
        "forbidden",
      );
      await db.removeWatchlistDomain("watcher", "example.org");
      expect(await db.listWatchlist("watcher")).toHaveLength(0);
    } finally {
      await sql.end();
      await db.close();
    }
  },
);
