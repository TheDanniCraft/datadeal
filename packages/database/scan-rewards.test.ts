import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import postgres from "postgres";
import { connect, type VerifiedScanRewardReceipt } from "./index";

const url = process.env.DATADEAL_TEST_DATABASE_URL;

async function withRewardFixture(
  verify: (fixture: {
    db: ReturnType<typeof connect>;
    sql: ReturnType<typeof postgres>;
    scan: string;
    otherScan: string;
    demo: string;
    queued: string;
    userId: string;
    otherUserId: string;
    holderHash: string;
  }) => Promise<void>,
) {
  const db = connect(url!);
  const sql = postgres(url!);
  const domain = `reward-${randomUUID()}.example.com`;
  const [scan, otherScan, demo, queued, userId, otherUserId] = Array.from(
    { length: 6 },
    () => randomUUID(),
  );
  const holderHash = createHash("sha256").update(randomBytes(32)).digest("hex");
  try {
    await sql`insert into domains(name) values (${domain})`;
    await sql`insert into "user"(id, name, email) values
      (${userId}, 'First account', ${userId + "@example.test"}),
      (${otherUserId}, 'Second account', ${otherUserId + "@example.test"})`;
    for (const [id, state] of [
      [scan, "completed"],
      [otherScan, "partially_completed"],
      [demo, "completed"],
      [queued, "queued"],
    ]) {
      const report = {
        id,
        domain,
        completedAt: new Date().toISOString(),
        demo: id === demo,
        partial: state === "partially_completed",
        findings: [],
        evidence: [
          {
            id: "default-visit",
            kind: "observed_technical",
            retrievedAt: new Date().toISOString(),
            scanId: id,
            excerpt: "The default visit requested an outside asset.",
            consentScenario: "default",
            observation: {
              type: "browser_consent_counts",
              requests: 1,
              cookies: 0,
              externalDomains: ["assets.example.net"],
            },
          },
        ],
      };
      await sql`insert into scans(id, domain, state, report)
        values (${id}, ${domain}, ${state}, ${sql.json(report)})`;
    }
    await verify({
      db,
      sql,
      scan,
      otherScan,
      demo,
      queued,
      userId,
      otherUserId,
      holderHash,
    });
  } finally {
    await sql`delete from scan_reward_grants where scan_id in (${scan}, ${otherScan}, ${demo}, ${queued})`;
    await Promise.all([db.close(), sql.end()]);
  }
}

it.skipIf(!url)(
  "grants exactly one published scan per verified receipt without Pro",
  async () => {
    await withRewardFixture(
      async ({
        db,
        sql,
        scan,
        otherScan,
        demo,
        queued,
        userId,
        otherUserId,
      }) => {
        const receipt: VerifiedScanRewardReceipt = {
          provider: "google_ad_manager",
          receiptId: randomUUID(),
          scanId: scan,
          holder: { kind: "user", userId },
        };
        const results = await Promise.all(
          Array.from({ length: 5 }, () => db.grantScanReward(receipt)),
        );
        expect(results.sort()).toEqual([
          "duplicate_receipt",
          "duplicate_receipt",
          "duplicate_receipt",
          "duplicate_receipt",
          "granted",
        ]);
        expect(await db.hasScanReward(scan, receipt.holder)).toBe(true);
        expect(await db.hasPro(userId)).toBe(false);
        expect(await db.hasScanReward(otherScan, receipt.holder)).toBe(false);
        const [{ domain }] = await sql<{ domain: string }[]>`
          select domain from scans where id = ${scan}`;
        expect(await db.accountReportUnlocks(userId)).toEqual([
          { scanId: scan, domain },
        ]);
        expect(await db.accountReportUnlocks(otherUserId)).toEqual([]);
        expect(
          await db.previousRewardedScan(domain, otherScan, userId, []),
        ).toBe(scan);
        expect(
          await db.previousRewardedScan(domain, otherScan, otherUserId, []),
        ).toBeUndefined();
        expect(
          await db.hasScanReward(scan, { kind: "user", userId: otherUserId }),
        ).toBe(false);
        expect(
          await db.grantScanReward({ ...receipt, scanId: otherScan }),
        ).toBe("duplicate_receipt");
        for (const scanId of [demo, queued, randomUUID()]) {
          const rejected = { ...receipt, scanId, receiptId: randomUUID() };
          expect(await db.grantScanReward(rejected)).toBe("unavailable");
          expect(await db.grantScanReward({ ...rejected, scanId: scan })).toBe(
            "duplicate_receipt",
          );
        }
        await sql`delete from "user" where id = ${userId}`;
        expect(await db.hasScanReward(scan, receipt.holder)).toBe(false);
        expect(
          await db.grantScanReward({
            ...receipt,
            holder: { kind: "user", userId: otherUserId },
          }),
        ).toBe("duplicate_receipt");
      },
    );
  },
);

it.skipIf(!url)(
  "requires real advanced detail at settlement and binds inherited access to a published target on the same domain",
  async () => {
    await withRewardFixture(
      async ({ db, sql, scan, otherScan, queued, demo, holderHash }) => {
        const [{ domain }] = await sql<
          { domain: string }[]
        >`select domain from scans where id=${scan}`;
        const foreign = randomUUID(),
          foreignDomain = `other-${foreign}.example.net`;
        await sql`insert into domains(name) values (${foreignDomain})`;
        await sql`insert into scans(id,domain,state,report) select ${foreign},${foreignDomain},state,
        report || jsonb_build_object('domain',${foreignDomain}::text,'id',${foreign}::text)
        from scans where id=${scan}`;
        try {
          const holder = { kind: "guest" as const, holderHash };
          const receipt = {
            provider: "local_sample" as const,
            receiptId: randomUUID(),
            scanId: scan,
            holder,
          };
          expect(await db.grantScanReward(receipt)).toBe("granted");
          const guests = [{ scanId: scan, holderHash }];
          expect(
            await db.previousRewardedScan(domain, otherScan, null, guests),
          ).toBe(scan);
          for (const target of [foreign, queued, demo, randomUUID()]) {
            expect(
              await db.previousRewardedScan(domain, target, null, guests),
            ).toBeUndefined();
          }
          expect(
            await db.previousRewardedScan(foreignDomain, foreign, null, guests),
          ).toBeUndefined();

          const actor = {
            userId: null,
            browserHash: randomBytes(32).toString("hex"),
          };
          const offer = await db.createReportOffer(
            domain,
            otherScan,
            "unlock",
            actor,
          );
          expect(offer).toBeTruthy();
          await sql`update scans set report=jsonb_set(report,'{evidence}','[]'::jsonb) where id=${otherScan}`;
          expect(
            (
              await db.reportOfferAction(offer!, actor, "complete", {
                host: domain,
                scanId: otherScan,
                grantHash: holderHash,
              })
            ).code,
          ).toBe("missing");
          expect(
            await db.grantScanReward({
              ...receipt,
              scanId: otherScan,
              receiptId: randomUUID(),
            }),
          ).toBe("unavailable");
          expect(await db.hasScanReward(otherScan, holder)).toBe(false);
        } finally {
          await sql`delete from scans where id=${foreign}`;
          await sql`delete from domains where name=${foreignDomain}`;
        }
      },
    );
  },
);

it.skipIf(!url)(
  "expires anonymous access after 24 hours without allowing receipt replay",
  async () => {
    await withRewardFixture(
      async ({ db, sql, scan, otherScan, holderHash, userId }) => {
        const receipt: VerifiedScanRewardReceipt = {
          provider: "google_ad_manager",
          receiptId: randomUUID(),
          scanId: scan,
          holder: { kind: "guest", holderHash },
        };
        expect(await db.grantScanReward(receipt)).toBe("granted");
        const [stored] =
          await sql`select expires_at > now() + interval '23 hours'
      and expires_at <= now() + interval '24 hours' as valid
      from scan_reward_grants where scan_id = ${scan} and holder_hash = ${holderHash}`;
        expect(stored?.valid).toBe(true);
        expect(await db.hasScanReward(scan, receipt.holder)).toBe(true);
        const [{ domain }] = await sql<{ domain: string }[]>`
        select domain from scans where id = ${scan}`;
        expect(
          await db.previousRewardedScan(domain, otherScan, null, [
            { scanId: scan, holderHash },
          ]),
        ).toBe(scan);
        expect(
          await db.previousRewardedScan(domain, otherScan, null, [
            { scanId: otherScan, holderHash },
          ]),
        ).toBeUndefined();
        await sql`update scan_reward_grants set expires_at = now() - interval '1 second'
      where scan_id = ${scan} and holder_hash = ${holderHash}`;
        expect(await db.hasScanReward(scan, receipt.holder)).toBe(false);
        expect(
          await db.previousRewardedScan(domain, otherScan, null, [
            { scanId: scan, holderHash },
          ]),
        ).toBeUndefined();
        expect(await db.claimGuestScanReward(scan, holderHash, userId)).toBe(
          false,
        );
        expect((await db.pruneExpiredPrivateData()).scanRewards).toBe(1);
        expect(await db.grantScanReward(receipt)).toBe("duplicate_receipt");
        expect(await db.hasScanReward(scan, receipt.holder)).toBe(false);
      },
    );
  },
);

it.skipIf(!url)(
  "saves the exact scan to one account and preserves the original browser window",
  async () => {
    await withRewardFixture(
      async ({ db, sql, scan, otherScan, holderHash, userId, otherUserId }) => {
        const holder = { kind: "guest", holderHash } as const;
        const receipt: VerifiedScanRewardReceipt = {
          provider: "google_ad_manager",
          receiptId: randomUUID(),
          scanId: scan,
          holder,
        };
        expect(await db.grantScanReward(receipt)).toBe("granted");
        expect(
          await db.grantScanReward({
            ...receipt,
            scanId: otherScan,
            receiptId: randomUUID(),
          }),
        ).toBe("granted");
        expect(
          await db.claimGuestScanReward(scan, "0".repeat(64), userId),
        ).toBe(false);
        expect(
          await db.claimGuestScanReward(scan, holderHash, randomUUID()),
        ).toBe(false);
        const users = [userId, otherUserId];
        const originalWindow =
          await sql`select expires_at::text from scan_reward_grants
          where scan_id=${scan} and holder_hash=${holderHash}`;
        const claims = await Promise.all(
          users.map((user) => db.claimGuestScanReward(scan, holderHash, user)),
        );
        expect(claims.filter(Boolean)).toHaveLength(1);
        for (const [index, user] of users.entries()) {
          expect(
            await db.hasScanReward(scan, { kind: "user", userId: user }),
          ).toBe(claims[index]);
          expect(
            await db.hasScanReward(otherScan, { kind: "user", userId: user }),
          ).toBe(false);
        }
        const owner = users[claims.indexOf(true)];
        const other = users[claims.indexOf(false)];
        expect(await db.claimGuestScanReward(scan, holderHash, owner)).toBe(
          false,
        );
        expect(await db.claimGuestScanReward(scan, holderHash, other)).toBe(
          false,
        );
        expect(await db.hasScanReward(scan, holder)).toBe(true);
        expect(
          await sql`select expires_at::text from scan_reward_grants
          where scan_id=${scan} and holder_hash=${holderHash}`,
        ).toEqual(originalWindow);
        const [{ domain }] = await sql<
          { domain: string }[]
        >`select domain from scans where id=${scan}`;
        expect(
          await db.previousRewardedScan(domain, otherScan, null, [
            { scanId: scan, holderHash },
          ]),
        ).toBe(scan);
        expect(await db.hasPro(owner)).toBe(false);
        expect(await db.hasScanReward(otherScan, holder)).toBe(true);
        expect(await db.grantScanReward(receipt)).toBe("duplicate_receipt");
        await sql`delete from "user" where id=${owner}`;
        expect(
          await db.hasScanReward(scan, { kind: "user", userId: owner }),
        ).toBe(false);
        expect(await db.claimGuestScanReward(scan, holderHash, other)).toBe(
          false,
        );
        expect(await db.hasScanReward(scan, holder)).toBe(true);
        expect(await db.grantScanReward(receipt)).toBe("duplicate_receipt");
      },
    );
  },
);

it.skipIf(!url)(
  "honors a historical guest window with no provable account-claim state",
  async () => {
    await withRewardFixture(async ({ db, sql, scan, userId, holderHash }) => {
      await sql`insert into scan_reward_grants(scan_id,holder_hash,expires_at)
        values (${scan},${holderHash},now()+interval '1 hour')`;
      expect(await db.hasScanReward(scan, { kind: "guest", holderHash })).toBe(
        true,
      );
      expect(await db.claimGuestScanReward(scan, holderHash, userId)).toBe(
        false,
      );
      expect(await db.hasScanReward(scan, { kind: "user", userId })).toBe(
        false,
      );
    });
  },
);

it.skipIf(!url)(
  "keeps a signed-in local sample's exact scan after the browser's same-domain window expires",
  async () => {
    await withRewardFixture(
      async ({ db, sql, scan, otherScan, userId, otherUserId, holderHash }) => {
        const receipt = {
          provider: "local_sample" as const,
          receiptId: randomUUID(),
          scanId: scan,
          holder: { kind: "guest" as const, holderHash },
          signedInUserId: userId,
        };
        expect(await db.grantScanReward(receipt)).toBe("granted");
        expect(
          await db.claimGuestScanReward(scan, holderHash, otherUserId),
        ).toBe(false);
        expect(
          await db.grantScanReward({ ...receipt, signedInUserId: otherUserId }),
        ).toBe("duplicate_receipt");
        const account = { kind: "user" as const, userId };
        expect(await db.hasScanReward(scan, account)).toBe(true);
        expect(await db.hasScanReward(otherScan, account)).toBe(false);
        expect(
          await db.hasScanReward(scan, { kind: "user", userId: otherUserId }),
        ).toBe(false);
        const [{ domain }] = await sql<
          { domain: string }[]
        >`select domain from scans where id=${scan}`;
        const guest = [{ scanId: scan, holderHash }];
        expect(
          await db.previousRewardedScan(domain, otherScan, null, guest),
        ).toBe(scan);
        expect(
          await db.previousRewardedScan(
            "other.example",
            otherScan,
            null,
            guest,
          ),
        ).toBeUndefined();
        await sql`update scan_reward_grants set expires_at=now() where scan_id=${scan} and holder_hash=${holderHash}`;
        expect(
          await db.previousRewardedScan(domain, otherScan, null, guest),
        ).toBeUndefined();
        expect(await db.hasScanReward(scan, account)).toBe(true);
      },
    );
  },
);
