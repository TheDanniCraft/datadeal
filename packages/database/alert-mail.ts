import { writeFile } from "node:fs/promises";
import type { Sql } from "postgres";
import { watchlistAlerts } from "./watchlist-alerts";

export type AlertMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};
export type AlertMailer = (mail: AlertMail) => Promise<void>;

/**
 * The account mail transport (the same one the sign-in link uses): Resend in
 * production, the local outbox file in development. Null when mail is not
 * configured, so alerts are skipped instead of failing a scan.
 */
export function alertMailer(
  env: Record<string, string | undefined> = process.env,
): { origin: string; send: AlertMailer } | null {
  const {
    APP_ORIGIN,
    NODE_ENV,
    DATADEAL_MAIL_MODE,
    DATADEAL_LOCAL_MAIL_FILE,
    RESEND_API_KEY,
    DATADEAL_MAIL_FROM,
  } = env;
  if (!APP_ORIGIN || !URL.canParse(APP_ORIGIN)) return null;
  const origin = new URL(APP_ORIGIN);
  if (origin.origin !== APP_ORIGIN) return null;
  if (
    DATADEAL_MAIL_MODE === "local" &&
    NODE_ENV === "development" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) &&
    DATADEAL_LOCAL_MAIL_FILE
  ) {
    const file = DATADEAL_LOCAL_MAIL_FILE;
    return {
      origin: origin.origin,
      send: async (mail) => {
        await writeFile(
          file,
          `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
      },
    };
  }
  if (
    DATADEAL_MAIL_MODE !== "resend" ||
    !RESEND_API_KEY ||
    !DATADEAL_MAIL_FROM ||
    (NODE_ENV === "production" && origin.protocol !== "https:")
  )
    return null;
  return {
    origin: origin.origin,
    send: async (mail) => {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: DATADEAL_MAIL_FROM,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Alert email delivery failed");
    },
  };
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function alertMessage(
  origin: string,
  alert: {
    scan_id: string;
    domain: string;
    document_count: number;
    score_before: number | null;
    score_after: number | null;
  },
  to: string,
): AlertMail {
  const { domain, document_count: documents } = alert;
  const score =
    alert.score_before !== null && alert.score_after !== null
      ? `score ${alert.score_before} → ${alert.score_after}`
      : null;
  const documentLine = documents
    ? `${documents} privacy ${documents === 1 ? "document" : "documents"} changed`
    : null;
  const report = `${origin}/report/${domain}?scan=${alert.scan_id}#history`;
  const library = `${origin}/account/library`;
  const changes = [
    score && `Score: ${alert.score_before} → ${alert.score_after}`,
    documentLine &&
      documentLine.charAt(0).toUpperCase() + documentLine.slice(1),
  ].filter((line): line is string => Boolean(line));
  const text = [
    `A new scan of ${domain} found changes.`,
    "",
    ...changes,
    "",
    `See what changed: ${report}`,
    "",
    `You get this email because you watch ${domain}. To stop watching, open your Library: ${library}`,
  ].join("\n");
  const html = [
    `<p>A new scan of <strong>${escape(domain)}</strong> found changes.</p>`,
    `<ul>${changes.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>`,
    `<p><a href="${escape(report)}">See what changed</a></p>`,
    `<p style="color:#666;font-size:13px">You get this email because you watch ${escape(domain)}. <a href="${escape(library)}">Stop watching in your Library</a>.</p>`,
  ].join("\n");
  return {
    to,
    subject: `${domain} changed: ${score ?? documentLine}`,
    text,
    html,
  };
}

/**
 * Emails the watchers of a scan's site when the scan is their newest change.
 * Each (account, scan) is claimed before sending, so it is emailed at most
 * once, even when two workers finish the same scan's follow-up.
 */
export async function sendScanAlerts(
  sql: Sql,
  scanId: string,
  mailer: { origin: string; send: AlertMailer },
) {
  const counts = { sent: 0, failed: 0 };
  const [alert] = await sql<{ domain: string }[]>`
    select domain from alerts where scan_id = ${scanId}`;
  if (!alert) return counts;
  const watchers = await sql<{ id: string; email: string }[]>`
    select u.id, u.email from "user" u
    where (exists (select 1 from watchlists w where w.user_id = u.id
          and w.domain = ${alert.domain} and w.document_alerts
          and exists (select 1 from subscriptions s where s.user_id = u.id
            and s.access_until > now() and s.status in ('active','canceled','past_due')))
        or exists (select 1 from site_monitors m where m.user_id = u.id
          and m.domain = ${alert.domain}))
      and not exists (select 1 from alert_deliveries d
        where d.user_id = u.id and d.scan_id = ${scanId})
    order by u.id`;
  for (const watcher of watchers) {
    const [latest] = await watchlistAlerts(sql, watcher.id, alert.domain);
    if (latest?.scan_id !== scanId) continue;
    const [claimed] = await sql`
      insert into alert_deliveries(user_id, scan_id) values(${watcher.id}, ${scanId})
      on conflict do nothing returning user_id`;
    if (!claimed) continue;
    try {
      await mailer.send(alertMessage(mailer.origin, latest, watcher.email));
      await sql`update alert_deliveries set sent_at = now()
        where user_id = ${watcher.id} and scan_id = ${scanId}`;
      counts.sent++;
    } catch {
      counts.failed++;
    }
  }
  return counts;
}
