import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, it } from "vitest";
import { connect } from "./index";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
it.skipIf(!url)(
  "binds the chosen benefit, flight clock and report spend across retries and simultaneous requests",
  async () => {
    const sql = postgres(url!),
      db = connect(url!);
    const id = randomUUID(),
      host = "reward-" + id + ".example.org",
      scanId = randomUUID(),
      partial = randomUUID(),
      userId = randomUUID(),
      second = randomUUID(),
      stamp = new Date().toISOString();
    const actor = { userId, browserHash: randomBytes(32).toString("hex") },
      guest = { ...actor, userId: null };
    const args = { host, scanId, grantHash: randomBytes(32).toString("hex") };
    try {
      await sql`insert into domains(name) values(${host})`;
      await sql`insert into "user"(id,name,email) values(${userId},'First',${userId + "@example.org"}),(${second},'Second',${second + "@example.org"})`;
      for (const scan of [scanId, partial]) {
        const report = {
          id: scan,
          domain: host,
          demo: false,
          partial: scan === partial,
          completedAt: stamp,
          findings: [],
          evidence:
            scan === partial
              ? []
              : [
                  {
                    id: "visit",
                    kind: "observed_technical",
                    retrievedAt: stamp,
                    scanId: scan,
                    excerpt: "A measured request",
                    consentScenario: "default",
                    observation: {
                      type: "browser_consent_counts",
                      requests: 1,
                      cookies: 0,
                      externalDomains: ["static.example.org"],
                    },
                  },
                ],
        };
        await sql`insert into scans(id,domain,state,report) values(${scan},${host},'completed',${sql.json(report)})`;
      }
      expect(
        await db.createReportOffer(host, partial, "unlock", guest),
      ).toBeNull();
      expect(
        await db.createReportOffer(host, scanId, "flight", guest),
      ).toBeNull();
      expect(await db.spendOnReport(host, scanId, userId, [])).toBe(
        "insufficient",
      );
      const guaranteed = (await db.createReportOffer(
        host,
        scanId,
        "points",
        actor,
      ))!;
      expect(
        (
          await db.reportOfferAction(
            guaranteed,
            { ...actor, userId: second },
            "complete",
            args,
          )
        ).code,
      ).toBe("forbidden");
      await Promise.all(
        [1, 2, 3].map(() =>
          db.reportOfferAction(guaranteed, actor, "complete", args),
        ),
      );
      expect((await db.reportPointWallet(userId)).balance).toBe(50);
      expect(
        await db.grantScanReward({
          provider: "local_sample",
          receiptId: guaranteed,
          scanId,
          holder: { kind: "guest", holderHash: args.grantHash },
        }),
      ).toBe("duplicate_receipt");
      expect(await db.hasScanReward(scanId, { kind: "user", userId })).toBe(
        false,
      );
      expect(await db.spendOnReport(host, partial, userId, [])).toBe(
        "unavailable",
      );
      expect(
        (
          await Promise.all(
            [1, 2, 3].map(() => db.spendOnReport(host, scanId, userId, [])),
          )
        ).sort(),
      ).toEqual(["owned", "owned", "unlocked"]);
      expect((await db.reportPointWallet(userId)).balance).toBe(0);
      const choice = (await db.createReportOffer(
        host,
        scanId,
        "choice",
        guest,
      ))!;
      expect(
        (await db.reportOfferAction(choice, guest, "complete", args)).reward
          ?.state,
      ).toBe("choose");
      expect(
        (
          await db.reportOfferAction(
            choice,
            { userId: second, browserHash: "f".repeat(64) },
            "chooseFlight",
          )
        ).code,
      ).toBe("forbidden");
      expect(
        (await db.reportOfferAction(choice, actor, "chooseFlight")).reward
          ?.state,
      ).toBe("ready");
      expect(
        (await db.reportOfferAction(choice, actor, "open", args)).code,
      ).toBe("conflict");
      const launch = await db.reportOfferAction(choice, actor, "launch", {
        target: 100,
      });
      expect(launch.reward?.state).toBe("flying");
      expect(launch.reward).not.toHaveProperty("endpoint");
      await sql`update report_reward_offers set endpoint=236.9,launched_at=now()-interval '8 seconds' where id=${choice}`;
      expect(
        (await db.reportOfferAction(choice, actor, "status")).reward,
      ).toMatchObject({
        state: "flying",
        live: 50,
        checkpoint: true,
        finalAmount: null,
      });
      expect(
        (await db.reportOfferAction(choice, actor, "continue")).reward
          ?.checkpoint,
      ).toBe(false);
      await sql`update report_reward_offers set launched_at=now()-interval '30 seconds' where id=${choice}`;
      await Promise.all([
        db.settleOfflineFlights(),
        db.reportOfferAction(choice, actor, "bank"),
      ]);
      expect(
        (await db.reportOfferAction(choice, actor, "status")).reward,
      ).toMatchObject({ payout: 100, finalAmount: 236 });
      const loss = (await db.createReportOffer(host, scanId, "flight", actor))!;
      await db.reportOfferAction(loss, actor, "complete", args);
      await db.reportOfferAction(loss, actor, "launch", { target: 100 });
      await sql`update report_reward_offers set endpoint=3.1,launched_at=now()-interval '30 seconds' where id=${loss}`;
      await db.settleOfflineFlights();
      expect(
        (await db.reportOfferAction(loss, actor, "bank")).reward,
      ).toMatchObject({ state: "missed", payout: 0 });
      expect((await db.reportPointWallet(userId)).balance).toBe(100);
    } finally {
      await Promise.all([db.close(), sql.end()]);
    }
  },
);
