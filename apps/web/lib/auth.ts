import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { parseCookies } from "better-auth/cookies";
import { APIError } from "better-auth/api";
import { database } from "./database";
import { cancelSubscription } from "./cancel-subscription";
import { magicLink } from "better-auth/plugins";
import { Pool } from "pg";
import { z } from "zod";
import { guestReportHolders, localRewardEnabled } from "./local-reward";

function rewardVerificationId(token: string) {
  return "report-unlocks:" + createHash("sha256").update(token).digest("hex");
}

const signInHolders = z.array(
  z.object({
    scanId: z.uuid(),
    holderHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
);

function configureAuth() {
  const {
    DATABASE_URL,
    BETTER_AUTH_SECRET,
    APP_ORIGIN,
    DATADEAL_MAIL_MODE,
    DATADEAL_LOCAL_MAIL_FILE,
    RESEND_API_KEY,
    DATADEAL_MAIL_FROM,
  } = process.env;
  if (
    !DATABASE_URL ||
    !BETTER_AUTH_SECRET ||
    !APP_ORIGIN ||
    !DATADEAL_MAIL_MODE
  )
    return null;
  const origin = new URL(APP_ORIGIN);
  if (
    origin.origin !== APP_ORIGIN ||
    BETTER_AUTH_SECRET.length < 32 ||
    (process.env.NODE_ENV === "production" && origin.protocol !== "https:")
  ) {
    throw new Error("Invalid authentication origin or secret");
  }
  const local =
    DATADEAL_MAIL_MODE === "local" &&
    process.env.NODE_ENV === "development" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) &&
    DATADEAL_LOCAL_MAIL_FILE;
  if (
    !local &&
    (DATADEAL_MAIL_MODE !== "resend" || !RESEND_API_KEY || !DATADEAL_MAIL_FROM)
  ) {
    throw new Error("Invalid authentication mail configuration");
  }
  async function deliver(
    email: string,
    subject: string,
    message: string,
    url: string,
  ) {
    if (local) {
      await writeFile(local, url + "\n", { encoding: "utf8", mode: 0o600 });
      return;
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: DATADEAL_MAIL_FROM,
        to: [email],
        subject,
        text: message + "\n\n" + url,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Account email delivery failed");
  }

  const trustedIpHeader = process.env.DATADEAL_TRUSTED_CLIENT_IP_HEADER;
  return betterAuth({
    baseURL: origin.origin,
    secret: BETTER_AUTH_SECRET,
    trustedOrigins: [origin.origin],
    database: new Pool({ connectionString: DATABASE_URL, max: 5 }),
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      ipAddress: { ipAddressHeaders: trustedIpHeader ? [trustedIpHeader] : [] },
    },
    databaseHooks: {
      session: {
        create: {
          async after(session, ctx) {
            if (
              !localRewardEnabled() ||
              !database ||
              ctx?.path !== "/magic-link/verify"
            )
              return;
            const token = ctx.query?.token;
            if (typeof token !== "string") return;
            // Use the grants presented when this email was requested, even when
            // the user opens the link in another browser with different cookies.
            const handoff =
              await ctx.context.internalAdapter.consumeVerificationValue(
                rewardVerificationId(token),
              );
            if (!handoff) return;
            for (const { scanId, holderHash } of signInHolders.parse(
              JSON.parse(handoff.value),
            )) {
              await database.claimGuestScanReward(
                scanId,
                holderHash,
                session.userId,
              );
            }
          },
        },
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        deleteTokenExpiresIn: 600,
        async beforeDelete(user) {
          try {
            if (!database) throw new Error("Account storage unavailable");
            await database.prepareBillingClosure(user.id, cancelSubscription);
          } catch {
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "BILLING_CLOSURE_PENDING",
              message:
                "Your account is still open. Request a new deletion link to retry subscription verification.",
            });
          }
        },
        async sendDeleteAccountVerification({ user, token }) {
          const confirmation = new URL("/account/delete", origin);
          confirmation.searchParams.set("token", token);
          await deliver(
            user.email,
            "Confirm DataDeal account deletion",
            "Confirming deletion ends your DataDeal Pro subscriptions and permanently removes your account. Open this link while signed in. It expires in 10 minutes.",
            confirmation.href,
          );
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 600,
        storeToken: "hashed",
        async sendMagicLink({ email, url, token }, ctx) {
          if (localRewardEnabled() && ctx) {
            const jar = parseCookies(ctx.headers?.get("cookie") ?? "");
            const holders = guestReportHolders(
              Array.from(jar, ([name, value]) => ({ name, value })),
            );
            if (holders.length) {
              await ctx.context.internalAdapter.createVerificationValue({
                identifier: rewardVerificationId(token),
                value: JSON.stringify(holders),
                expiresAt: new Date(Date.now() + 600_000),
              });
            }
          }
          await deliver(
            email,
            "Sign in to DataDeal",
            "Use this link to sign in to DataDeal. It expires in 10 minutes.",
            url,
          );
        },
      }),
    ],
  });
}
export const auth = configureAuth();
