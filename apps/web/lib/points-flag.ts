// Environment-only switches, free of server imports so account UI shared with
// client components can read them.

/** Local development with a loopback database and a usable auth secret. */
export function localRewardEnabled() {
  const database = process.env.DATABASE_URL;
  return (
    process.env.NODE_ENV === "development" &&
    (process.env.BETTER_AUTH_SECRET?.length ?? 0) >= 32 &&
    Boolean(
      database &&
      URL.canParse(database) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(database).hostname),
    )
  );
}

/**
 * Points earned from the local sample ad unit. Only this stays dev-only: there
 * is no approved rewarded ad unit yet, so ad-driven points never reach production.
 */
export function localPointsEnabled() {
  return (
    localRewardEnabled() && process.env.DATADEAL_LOCAL_SAMPLE_ADS === "true"
  );
}

/**
 * Points as a currency: balance, packs, unlocks, boosts, watches and API
 * prices. On locally with sample ads, or in production with DATADEAL_POINTS.
 */
export function pointsEnabled() {
  return localPointsEnabled() || process.env.DATADEAL_POINTS === "true";
}
