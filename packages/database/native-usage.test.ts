import { randomUUID, createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import postgres from "postgres";
import { connect } from "./index";
import type { ScanReport } from "@datadeal/contracts";
import {
  sendCreemUsageEvent,
  type NativeUsageProvider,
  type SendUsageEvent,
} from "./native-usage";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
it("validates the provider receipt before completing event delivery", async () => {
  vi.stubEnv("CREEM_MODE", "test");
  vi.stubEnv("CREEM_API_KEY", "unit-test-only");
  const event = {
    name: "datadeal_scan_requested",
    event_id: "evt_one",
    customer_id: "cust_mock",
    timestamp: new Date().toISOString(),
  } as const;
  const receipt = { accepted: 1, event_ids: [event.event_id] };
  const post = vi.fn();
  vi.stubGlobal("fetch", post);
  try {
    for (const body of [
      {},
      { ...receipt, accepted: 0 },
      { ...receipt, event_ids: ["evt_other"] },
      { ...receipt, warnings: [{ index: 2, code: "meter_archived" }] },
    ]) {
      post.mockResolvedValueOnce(Response.json(body, { status: 202 }));
      await expect(sendCreemUsageEvent(event)).rejects.toThrow();
    }
    post.mockResolvedValueOnce(
      Response.json(
        {
          ...receipt,
          warnings: [
            {
              index: 0,
              code: "meter_archived",
              message: "Only archived meters match.",
            },
          ],
        },
        { status: 202 },
      ),
    );
    expect(await sendCreemUsageEvent(event)).toEqual(["meter_archived"]);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
it("submits one native count event with the accepted timestamp and no domain data", async () => {
  const post = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ accepted: 1, event_ids: ["unique"] }, { status: 202 }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 422 }));
  vi.stubEnv("CREEM_MODE", "test");
  vi.stubEnv("CREEM_API_KEY", "unit-test-only");
  vi.stubGlobal("fetch", post);
  const event = {
    name: "datadeal_report_read",
    customer_id: "cust_mock",
    event_id: "unique",
    timestamp: new Date().toISOString(),
  } as const;
  try {
    expect(await sendCreemUsageEvent(event)).toEqual([]);
    expect(post.mock.calls[0][0]).toBe(
      "https://test-api.creem.io/v1/events/ingest",
    );
    expect(JSON.parse(post.mock.calls[0][1].body)).toEqual({ events: [event] });
    await expect(sendCreemUsageEvent(event)).rejects.toThrow();
    vi.stubEnv("CREEM_MODE", "live");
    await expect(sendCreemUsageEvent(event)).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
it.skipIf(!url)(
  "reconciles a lost native debit and retries the meter with one stable event ID",
  async () => {
    const db = connect(url!),
      sql = postgres(url!);
    const user = randomUUID(),
      host = "meter-" + user + ".example.com",
      key = "request-1",
      amount = 3;
    const binding = { customerId: "cust-example", accountId: "acct-example" };
    const requestHash = createHash("sha256").update(host).digest("hex");
    const result = { domain: host, score: 80 };
    const transactions = new Map<string, string>();
    let balance = 5;
    const provider: NativeUsageProvider = {
      debit: vi.fn(async (_account, due, ref, idempotency) => {
        expect(idempotency).toBe("debit-" + ref);
        if (transactions.has(ref)) return { id: transactions.get(ref)! };
        const id = randomUUID();
        transactions.set(ref, id);
        balance -= due;
        throw Error("response lost after provider committed debit");
      }),
      reverse: vi.fn(async (_account, txId) => {
        balance += amount;
        return { id: "rev_" + txId };
      }),
    };
    const eventIDs = new Set<string>();
    let sends = 0;
    const send: SendUsageEvent = async (e) => {
      expect(e.customer_id).toBe(binding.customerId);
      expect(e.name).toBe("datadeal_report_read");
      sends++;
      eventIDs.add(e.event_id);
      if (sends === 1) throw Error("response lost after accepting meter event");
      return ["no_matching_meter"];
    };
    try {
      await sql`insert into "user"(id,name,email) values (${user},'Usage tester',${user + "@example.test"})`;
      const ids = await Promise.all(
        [1, 2].map(() =>
          db.reserveNativeUsage(
            user,
            { key, requestHash, amount },
            binding,
            host,
            "datadeal_report_read",
            result,
          ),
        ),
      );
      expect(ids[0]).toEqual(ids[1]);
      const { id } = ids[0];
      expect(await db.serveNativeUsage(id, provider, send)).toEqual({
        code: "unavailable",
      });
      expect(balance).toBe(2);
      expect(sends).toBe(0);
      await sql`update creem_api_operations set retry_at=now() where id=${id}`;
      await db.retryNativeUsage(provider, send);
      expect(balance).toBe(2);
      expect(sends).toBe(0);
      expect(await db.serveNativeUsage(id, provider, send)).toEqual({
        code: "applied",
        response: result,
      });
      expect(await db.serveNativeUsage(id, provider, send)).toEqual({
        code: "applied",
        response: result,
      });
      expect(sends).toBe(2);
      const [receipt] =
        await sql`select metered_at is not null as acknowledged, meter_warning_codes from creem_api_operations where id=${id}`;
      expect(receipt).toEqual({
        acknowledged: true,
        meter_warning_codes: ["no_matching_meter"],
      });
      expect([...eventIDs]).toEqual([id]);
      expect(await db.lookupNativeUsage(user, key, "0".repeat(64))).toEqual({
        id,
        conflict: true,
      });
      expect(transactions.size).toBe(1);
      const abandoned = await db.reserveNativeUsage(
        user,
        { key: "abandoned", requestHash, amount },
        binding,
        host,
        "datadeal_report_read",
        result,
      );
      await db.serveNativeUsage(abandoned.id, provider, send);
      await sql`update creem_api_operations set retry_at=now() where id=${abandoned.id}`;
      await db.retryNativeUsage(provider, send);
      await sql`update creem_api_operations set claim_until=now()-interval '1 second' where id=${abandoned.id}`;
      await db.retryNativeUsage(provider, send);
      expect(await db.serveNativeUsage(abandoned.id, provider, send)).toEqual({
        code: "expired",
      });
      expect(provider.reverse).toHaveBeenCalledTimes(1);
      expect(balance).toBe(2);
      expect([...eventIDs]).toEqual([id]);
      expect(await db.nativeUsageHistory(user, 1)).toEqual([
        {
          operation: "datadeal_report_read",
          amount,
          domain: host,
          status: "refunded",
          transactionId: transactions.get(abandoned.id),
          reversalId: "rev_" + transactions.get(abandoned.id),
          createdAt: expect.any(Date),
          refundedAt: expect.any(Date),
        },
      ]);
      expect(await db.nativeUsageHistory(user)).toHaveLength(2);
      expect(await db.nativeUsageHistory(randomUUID())).toEqual([]);
    } finally {
      await sql`delete from creem_api_operations where user_id=${user}`;
      await sql`delete from "user" where id=${user}`;
      await Promise.all([db.close(), sql.end()]);
    }
  },
);

it
  .skipIf(!url)
  .each([
    "failed",
    "blocked",
    "inconclusive consent",
    "measured",
    "policy",
  ] as const)(
  "settles a %s scan against the original Creem debit",
  async (outcome) => {
    const db = connect(url!),
      sql = postgres(url!),
      user = randomUUID(),
      host = "scan-" + user + ".example.com";
    const binding = { customerId: "cust-testing", accountId: "acct-testing" };
    let balance = 0;
    const debits = new Map<
      string,
      { id: string; amount: number; reversed: boolean }
    >();
    const provider: NativeUsageProvider = {
      debit: vi.fn(async (_account, amount, ref) => {
        const previous = debits.get(ref);
        if (previous) return { id: previous.id };
        if (balance < amount)
          throw Object.assign(Error("empty"), { code: "insufficient_balance" });
        balance -= amount;
        const item = { id: "tx_" + randomUUID(), amount, reversed: false };
        debits.set(ref, item);
        return { id: item.id };
      }),
      reverse: vi.fn(async (_account, transaction) => {
        const item = [...debits.values()].find((x) => x.id === transaction)!;
        if (!item.reversed) {
          balance += item.amount;
          item.reversed = true;
        }
        return { id: "rev_" + transaction };
      }),
    };
    const events = new Set<string>();
    const send: SendUsageEvent = async (e) => {
      expect(e.name).toBe("datadeal_scan_requested");
      events.add(e.event_id);
      return [];
    };
    const prepare = async (key: string) =>
      (
        await db.reserveNativeUsage(
          user,
          {
            key,
            amount: 10,
            requestHash: createHash("sha256").update(host).digest("hex"),
          },
          binding,
          host,
          "datadeal_scan_requested",
        )
      ).id;
    try {
      await sql`insert into "user"(id,name,email) values (${user},'Usage tester',${user + "@example.test"})`;
      const empty = await prepare("empty");
      expect(await db.serveNativeUsage(empty, provider, send)).toEqual({
        code: "insufficient",
      });
      expect(await sql`select id from scans where domain=${host}`).toHaveLength(
        0,
      );
      balance = 20;
      const first = await prepare("request");
      const responses = await Promise.all([
        db.serveNativeUsage(first, provider, send),
        db.serveNativeUsage(first, provider, send),
      ]);
      expect(responses[0]).toEqual(responses[1]);
      const [scan] = await sql`select id from scans where domain=${host}`;
      expect(scan.id).toBeTruthy();
      expect(responses[0]).toEqual({
        code: "applied",
        response: { id: scan.id },
      });
      expect(await db.apiScanStatus(user, scan.id)).toMatchObject({
        creditsCharged: 10,
        creditsRefunded: 0,
      });
      expect(balance).toBe(10);
      const blocked = await prepare("other-request");
      expect((await db.serveNativeUsage(blocked, provider, send)).code).toBe(
        "scan_in_progress",
      );
      expect(balance).toBe(10);
      expect([...events]).toEqual([first]);
      const owner = randomUUID();
      await sql`update scan_jobs set owner=${owner}, lease_until=now()+interval '60 seconds' where scan_id=${scan.id}`;
      await sql`update scans set state='fetching' where id=${scan.id}`;
      const snapshot: ScanReport = {
        id: scan.id,
        domain: host,
        completedAt: new Date().toISOString(),
        demo: false,
        partial: true,
        evidence: [],
        findings: [],
        consentCoverage: {
          default: "inconclusive",
          rejected: "inconclusive",
          accepted: "untested",
        },
      };
      const source = {
        scanId: scan.id,
        id: "source",
        url: "https://" + host,
        retrievedAt: snapshot.completedAt,
      };
      if (outcome === "measured" || outcome === "inconclusive consent") {
        snapshot.consentCoverage = {
          default: "measured",
          rejected:
            outcome === "measured" ? "control_unavailable" : "inconclusive",
          accepted:
            outcome === "measured" ? "control_unavailable" : "inconclusive",
        };
        snapshot.evidence.push({
          ...source,
          kind: "observed_technical",
          consentScenario: "default",
          excerpt: "Homepage visit.",
          observation: {
            type: "browser_consent_counts",
            finalPageKnown: true,
            requests: 7,
            cookies: 0,
            externalDomains: [],
          },
        });
      } else if (outcome === "policy") {
        snapshot.evidence.push({
          ...source,
          kind: "declared_first_party",
          excerpt:
            "We use the email address you provide to answer your inquiry.",
        });
        snapshot.findings.push({
          rule: "policy_available",
          title: "Privacy policy",
          explanation: "Policy retrieved.",
          confidence: "moderate",
          severity: "positive",
          evidenceIds: [source.id],
        });
      } else if (outcome === "blocked") {
        snapshot.evidence.push({
          ...source,
          kind: "observed_technical",
          excerpt: "Homepage response headers.",
          observation: {
            type: "response_cookie_attributes",
            count: 0,
            secure: 0,
            httpOnly: 0,
            sameSite: 0,
          },
        });
      }
      const input = outcome === "failed" ? null : snapshot;
      const finished = await Promise.all([
        db.finish(scan.id, owner, input),
        db.finish(scan.id, owner, input),
      ]);
      expect(finished.sort()).toEqual([false, true]);
      await db.retryNativeUsage(provider, send);
      await db.retryNativeUsage(provider, send);
      const refunded =
        outcome === "blocked" ||
        outcome === "failed" ||
        outcome === "inconclusive consent";
      expect(await db.apiScanStatus(user, scan.id)).toMatchObject({
        state: outcome === "failed" ? "failed" : "partially_completed",
        creditsRefunded: refunded ? 10 : 0,
      });
      expect(balance).toBe(refunded ? 20 : 10);
      expect([...events]).toEqual([first]);
      const debit = debits.get(first)!.id;
      const refs = [debit, "rev_" + debit];
      expect(await db.creemCreditActivity(user, refs)).toEqual(
        expect.arrayContaining([
          { transactionId: debit, kind: "scan", context: host },
          ...(refunded
            ? [{ transactionId: refs[1], kind: "scan_refund", context: host }]
            : []),
        ]),
      );
      expect(await db.creemCreditActivity(randomUUID(), refs)).toEqual([]);
      expect(provider.reverse).toHaveBeenCalledTimes(refunded ? 2 : 1);
    } finally {
      await sql`delete from creem_api_operations where user_id=${user}`;
      await sql`delete from scan_jobs where scan_id in (select id from scans where domain=${host})`;
      await sql`delete from scans where domain=${host}`;
      await sql`delete from domains where name=${host}`;
      await sql`delete from "user" where id=${user}`;
      await Promise.all([db.close(), sql.end()]);
    }
  },
);
