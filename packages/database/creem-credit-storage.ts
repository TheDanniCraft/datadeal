import type { Sql } from "postgres";
import type { creemCreditsClient } from "./creem-credit-client";

type Client = NonNullable<ReturnType<typeof creemCreditsClient>>;
type Account = { accountId: string; customerId: string };
type Purchase = {
  orderId: string;
  transactionId: string;
  reversalId: string | null;
  credits: number;
  createdAt: Date;
};

export function creemCreditStorage(sql: Sql) {
  async function creditReceiptDetails(
    userId: string,
    reference: { orderId: string } | { requestId: string },
  ) {
    let orderId: string;
    if ("requestId" in reference) {
      const [request] = await sql<{ order_id: string }[]>`
        select order_id from creem_credit_checkout_requests
        where user_id = ${userId} and request_id = ${reference.requestId}`;
      if (!request) return { status: "pending" as const, credits: null };
      orderId = request.order_id;
    } else {
      orderId = reference.orderId;
    }
    const [receipt] = await sql<{ refunded: boolean; credits: number }[]>`
      select reversal_id is not null as refunded, credits from creem_credit_purchases
      where user_id = ${userId} and order_id = ${orderId}
      union all
      select exists(select 1 from api_credit_entries r where r.user_id = p.user_id
        and r.reference = p.reference and r.kind = 'payment_refund') as refunded, p.delta as credits
      from api_credit_entries p where p.user_id = ${userId} and p.kind = 'purchase'
        and p.reference = ${"creem:test:" + orderId}`;
    if (!receipt) return { status: "pending" as const, credits: null };
    return {
      status: receipt.refunded ? ("refunded" as const) : ("confirmed" as const),
      credits: receipt.credits,
    };
  }
  return {
    creditReceiptDetails,
    async creditCheckoutReceipt(userId: string, requestId: string) {
      return (await creditReceiptDetails(userId, { requestId })).status;
    },
    async checkoutReceipt(
      userId: string,
      kind: "subscription" | "credits",
      id: string,
    ) {
      if (kind === "credits")
        return (await creditReceiptDetails(userId, { orderId: id })).status;
      const [subscription] = await sql<{ active: boolean }[]>`
        select (access_until > now() and status in ('active','canceled','past_due')) as active
        from subscriptions where user_id = ${userId} and id = ${id}`;
      if (!subscription) return "pending" as const;
      return subscription.active
        ? ("confirmed" as const)
        : ("inactive" as const);
    },
    async recordSandboxCreditProduct(productId: string) {
      await sql`insert into creem_sandbox_credit_products(product_id) values(${productId})
        on conflict (product_id) do nothing`;
    },
    async wasSandboxCreditProductOffered(productId: string) {
      const [row] =
        await sql`select 1 from creem_sandbox_credit_products where product_id=${productId}`;
      return Boolean(row);
    },
    async creemCreditActivity(userId: string, transactionIds: string[]) {
      if (!transactionIds.length) return [];
      const ids = sql.array(transactionIds);
      return sql<
        {
          transactionId: string;
          kind:
            | "pack"
            | "pack_refund"
            | "scan"
            | "read"
            | "scan_refund"
            | "read_refund";
          context: string;
        }[]
      >`
        select transaction_id as "transactionId", 'pack' as kind, order_id as context
        from creem_credit_purchases where user_id=${userId} and transaction_id=any(${ids}::text[])
        union all
        select reversal_id, 'pack_refund', order_id
        from creem_credit_purchases where user_id=${userId} and reversal_id=any(${ids}::text[])
        union all
        select transaction_id, case when event_name='datadeal_scan_requested' then 'scan' else 'read' end, domain
        from creem_api_operations where user_id=${userId} and transaction_id=any(${ids}::text[])
        union all
        select reversal_id, case when event_name='datadeal_scan_requested' then 'scan_refund' else 'read_refund' end, domain
        from creem_api_operations where user_id=${userId} and reversal_id=any(${ids}::text[])`;
    },
    async creemCreditAccount(userId: string) {
      const [row] = await sql<
        Account[]
      >`select account_id as "accountId", customer_id as "customerId" from creem_credit_accounts where user_id=${userId}`;
      return row ?? null;
    },
    async creemCreditPurchases(userId: string) {
      return sql<
        Purchase[]
      >`select order_id as "orderId", credits, transaction_id as "transactionId", reversal_id as "reversalId", created_at as "createdAt" from creem_credit_purchases where user_id=${userId} order by created_at desc, order_id`;
    },
    async settleCreemCreditPurchase(
      client: Client,
      data: {
        userId: string;
        customerId: string;
        email: string;
        orderId: string;
        requestId: string;
        credits: number;
      },
    ) {
      const { userId, customerId, email, orderId, requestId, credits } = data;
      return sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${"creem-order:" + orderId},0))`;
        // Reserve both IDs before contacting Creem. A conflicting retry must never issue credits.
        async function bindRequest() {
          const [inserted] =
            await tx`insert into creem_credit_checkout_requests(request_id,order_id,user_id)
            values(${requestId},${orderId},${userId}) on conflict do nothing returning request_id`;
          if (inserted) return true;
          const [bound] = await tx`select 1 from creem_credit_checkout_requests
            where request_id=${requestId} and order_id=${orderId} and user_id=${userId}`;
          return Boolean(bound);
        }
        const [previous] =
          await tx`select p.user_id,p.credits,a.customer_id from creem_credit_purchases p
          join creem_credit_accounts a using(user_id) where order_id=${orderId}
          union all select user_id,delta,null from api_credit_entries
          where kind='purchase' and reference=${"creem:test:" + orderId}`;
        if (previous) {
          if (
            previous.user_id !== userId ||
            previous.credits !== credits ||
            (previous.customer_id && previous.customer_id !== customerId)
          )
            return "conflict";
          return (await bindRequest()) ? "replayed" : "conflict";
        }
        const [owner] =
          await tx`select id, email, "emailVerified" from "user" where id=${userId} for update`;
        if (!owner) return "account_missing";
        if (
          !owner.emailVerified ||
          owner.email.toLowerCase() !== email.toLowerCase()
        )
          return "conflict";
        await tx`select pg_advisory_xact_lock(hashtextextended(${"creem-customer:" + customerId},0))`;
        const mappings =
          await tx`select user_id,account_id,customer_id from creem_credit_accounts where user_id=${userId} or customer_id=${customerId}`;
        if (
          mappings.some(
            (row) => row.user_id !== userId || row.customer_id !== customerId,
          )
        )
          return "conflict";
        let accountId: string = mappings[0]?.account_id;
        if (!(await bindRequest())) return "conflict";
        if (!accountId) {
          accountId = await client.ensureAccount(userId, customerId);
          await tx`insert into creem_credit_accounts(user_id, customer_id, account_id) values(${userId},${customerId},${accountId})`;
        }
        const reference = "datadeal:pack:" + orderId;
        const native = await client.credit(
          accountId,
          credits,
          reference,
          reference,
        );
        await tx`insert into creem_credit_purchases(order_id,user_id,credits,transaction_id) values(${orderId},${userId},${credits},${native.id})`;
        return "applied";
      });
    },
    async reverseCreemCreditPurchase(client: Client, orderId: string) {
      return sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${"creem-order:" + orderId},0))`;
        const [payment] =
          await tx`select p.transaction_id,p.reversal_id,a.account_id from creem_credit_purchases p join creem_credit_accounts a using(user_id) where p.order_id=${orderId} for update of p`;
        if (!payment) return "missing";
        if (payment.reversal_id) return "replayed";
        const reversal = await client.reverse(
          payment.account_id,
          payment.transaction_id,
        );
        await tx`update creem_credit_purchases set reversal_id=${reversal.id} where order_id=${orderId}`;
        return "applied";
      });
    },
  };
}
