import { headers } from "next/headers";
import { AccountScreen, AccountLink } from "../account-ui";
import { localOutboxName } from "../local-mail";
import { auth } from "../../../lib/auth";
import { DeleteAccount } from "../delete-account";

export default async function DeleteAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const session = await auth?.api.getSession({ headers: await headers() });
  return (
    <AccountScreen
      title="Delete account"
      description="Review and confirm permanent account removal."
      current={session ? "/account" : undefined}
    >
      <div className="space-y-3">
        {session &&
        typeof token === "string" &&
        /^[a-z0-9]{32}$/.test(token) ? (
          <>
            <p>
              Confirming ends any DataDeal Pro subscriptions for{" "}
              {session.user.email}, permanently deletes the account and signs
              you out.
            </p>
            <DeleteAccount token={token} />
          </>
        ) : (
          <p>
            {session
              ? "Open a current deletion link from"
              : "Sign in and open a current deletion link from"}{" "}
            {localOutboxName() ? "your local outbox" : "your inbox"}.
          </p>
        )}
        <AccountLink href="/account" secondary>
          Back to account
        </AccountLink>
      </div>
    </AccountScreen>
  );
}
