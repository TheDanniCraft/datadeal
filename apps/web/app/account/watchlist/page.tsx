import { headers } from "next/headers";
import Link from "next/link";
import { AccountScreen, AccountLink, AccountEmpty } from "../account-ui";
import { auth } from "../../../lib/auth";
import { proPlansPath } from "../../../lib/checkout-return";
import { database } from "../../../lib/reports";
import { Watchlist } from "./watchlist";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const session = await auth?.api.getSession({ headers: await headers() });
  const [pro, websites] =
    session && database
      ? await Promise.all([
          database.hasPro(session.user.id),
          database.listWatchlist(session.user.id),
        ])
      : ([false, []] as const);
  return (
    <AccountScreen
      title="Watchlist"
      description="Keep the sites you follow together and jump back to their latest privacy reports."
      current={session ? "/account/watchlist" : undefined}
    >
      {session ? (
        <>
          {!pro && (
            <p>
              <Link
                className="text-accent underline underline-offset-2"
                href={proPlansPath}
              >
                Get DataDeal Pro
              </Link>{" "}
              to save websites.
            </p>
          )}
          <Watchlist
            domains={websites.map((item) => item.domain)}
            canSave={pro}
          />
        </>
      ) : (
        <AccountEmpty
          symbol="watchlist"
          title="Your saved websites"
          action={
            <AccountLink href="/account?returnTo=/account/watchlist">
              Sign in
            </AccountLink>
          }
        >
          Sign in to see your watchlist. Pro lets you save domains and follow
          changes.
        </AccountEmpty>
      )}
    </AccountScreen>
  );
}
