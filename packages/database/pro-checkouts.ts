import type { Sql } from "postgres";

type ProCheckout = {
  requestId: string;
  checkoutId: string;
  userId: string;
  product: string;
  mode: "live" | "test";
};

export function proCheckoutStorage(sql: Sql) {
  function receiptReference(reference: string) {
    const column = /^ch_[a-zA-Z0-9_-]{1,100}$/.test(reference)
      ? "checkout_id"
      : /^ord_[a-zA-Z0-9_-]{1,100}$/.test(reference)
        ? "order_id"
        : /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
              reference,
            )
          ? "request_id"
          : null;
    return column ? sql`r.${sql(column)}=${reference}` : sql`false`;
  }
  const sameSubscription = sql`s.id=r.subscription_id and s.user_id=r.user_id and s.customer_id=r.customer_id`;
  return {
    async exportProBilling(userId: string) {
      return sql.begin(
        "isolation level repeatable read read only",
        async (tx) => {
          const subscriptions =
            await tx`select id as "subscriptionId", customer_id as "customerId",
          product_id as "productId", status,
          to_char(access_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "accessUntil"
          from subscriptions where user_id=${userId} order by access_until desc, id`;
          const checkouts =
            await tx`select request_id as "requestId", checkout_id as "checkoutId", mode,
          product_id as "productId", subscription_id as "subscriptionId", order_id as "orderId"
          from pro_checkout_requests where user_id=${userId} order by request_id`;
          return { subscriptions, checkouts };
        },
      );
    },
    async billingSummary(userId: string, reference?: string | null) {
      const filter =
        reference == null
          ? sql`true`
          : /^sub_[a-zA-Z0-9_-]{1,100}$/.test(reference)
            ? sql`s.id=${reference}`
            : sql`exists (select 1 from pro_checkout_requests r where ${sameSubscription} and ${receiptReference(reference)})`;
      const [record] = await sql<
        {
          customer_id: string;
          product_id: string;
          status: string;
          access_until: string | Date;
          has_access: boolean;
          needs_management: boolean;
        }[]
      >`select s.customer_id, s.product_id, s.status, s.access_until,
        (s.access_until > now() and s.status in ('active','canceled','past_due')) as has_access,
        s.status in ('active','paused','past_due','renewal_pending') as needs_management
        from subscriptions s where s.user_id=${userId} and ${filter}
        order by has_access desc, needs_management desc, s.access_until desc, s.event_time desc, s.id limit 1`;
      return (
        record && { ...record, access_until: new Date(record.access_until) }
      );
    },
    async recordProCheckout(checkout: ProCheckout) {
      await sql`insert into pro_checkout_requests(request_id,checkout_id,user_id,product_id,mode)
        values(${checkout.requestId},${checkout.checkoutId},${checkout.userId},${checkout.product},${checkout.mode})`;
    },
    async completeProCheckout(
      checkout: ProCheckout & {
        subscriptionId: string;
        customerId: string;
        orderId?: string;
      },
    ) {
      const { subscriptionId, customerId } = checkout;
      const order = checkout.orderId ?? null;
      const [row] = await sql`update pro_checkout_requests
        set subscription_id=${subscriptionId}, customer_id=${customerId}, order_id=coalesce(order_id,${order})
        where request_id=${checkout.requestId} and checkout_id=${checkout.checkoutId}
          and user_id=${checkout.userId} and product_id=${checkout.product} and mode=${checkout.mode}
          and (subscription_id is null or subscription_id=${subscriptionId})
          and (customer_id is null or customer_id=${customerId})
          and (order_id is null or ${order}::text is null or order_id=${order})
        returning request_id`;
      return Boolean(row);
    },
    async proCheckoutReceipt(userId: string, reference: string) {
      const [row] = await sql<
        { status: "pending" | "confirmed" | "inactive" }[]
      >`
        select case when s.id is null then 'pending'
          when s.access_until > now() and s.status in ('active','canceled','past_due') then 'confirmed'
          else 'inactive' end as status
        from pro_checkout_requests r
        left join subscriptions s on ${sameSubscription}
        where r.user_id=${userId} and ${receiptReference(reference)}`;
      return row?.status ?? null;
    },
  };
}
