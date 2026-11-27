import { database } from "../../../../../lib/reports";
import { auth } from "../../../../../lib/auth";
import { customerCreditSummary } from "../../../../../lib/customer-credit-summary";

export async function GET(request: Request) {
  const session = await auth?.api.getSession({ headers: request.headers });
  const headers = { "Cache-Control": "private, no-store" };
  if (!auth || !session)
    return Response.json(
      { error: "Sign in to export your account" },
      { status: 401, headers },
    );
  if (!database)
    return Response.json(
      { error: "Account data is temporarily unavailable" },
      { status: 503, headers },
    );
  const sessions = await auth.api.listSessions({ headers: request.headers });
  return Response.json(
    {
      exportedAt: new Date().toISOString(),
      proBilling: await database.exportProBilling(session.user.id),
      reportUnlocks: await database.accountReportUnlocks(session.user.id),
      profile: {
        id: session.user.id,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
        name: session.user.name,
        image: session.user.image,
        createdAt: session.user.createdAt,
        updatedAt: session.user.updatedAt,
      },
      watchlist: await database.listWatchlist(session.user.id),
      privacyProfile: (await database.privacyProfile(session.user.id)) ?? null,
      reportPoints: await database.exportReportRewards(session.user.id),
      pointPackPurchases: await database.pointPackPurchases(session.user.id),
      pointApiOperations: await database.pointApiOperations(session.user.id),
      apiTokens: await database.listApiTokens(session.user.id),
      // Earlier API credits, kept for history after the merge into points.
      apiCredits: await database.apiCreditSummary(session.user.id, {
        fullHistory: true,
      }),
      creemCredits: await customerCreditSummary(database, session.user.id, {
        fullHistory: true,
      }),
      creemCreditPurchases: await database.creemCreditPurchases(
        session.user.id,
      ),
      apiUsage: await database.nativeUsageHistory(session.user.id),
      sessions: sessions.map(
        ({ createdAt, updatedAt, expiresAt, ipAddress, userAgent }) => ({
          createdAt,
          updatedAt,
          expiresAt,
          ipAddress,
          userAgent,
        }),
      ),
    },
    {
      headers: {
        ...headers,
        "Content-Disposition": 'attachment; filename="datadeal-account.json"',
      },
    },
  );
}
