import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

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

export function localRewardCookie(scanId: string) {
  return "dd-test-reward-" + scanId;
}

export function createLocalRewardHolder(completionId: string) {
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update("local-sample-completion:" + completionId)
    .digest("base64url");
}

export function localRewardHolder(scanId: string, value?: string) {
  if (!localRewardEnabled() || !value || !/^[A-Za-z0-9_-]{43}$/.test(value))
    return null;
  return {
    kind: "guest" as const,
    holderHash: createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
      .update(`local-sample-holder:${scanId}:${value}`)
      .digest("hex"),
  };
}

export function guestReportHolders(
  cookies: Iterable<{ name: string; value: string }>,
) {
  const holders = [];
  for (const { name, value } of cookies) {
    const scanId = name.slice("dd-test-reward-".length);
    if (
      name !== localRewardCookie(scanId) ||
      !z.uuid().safeParse(scanId).success
    )
      continue;
    const holder = localRewardHolder(scanId, value);
    if (holder) holders.push({ scanId, holderHash: holder.holderHash });
  }
  return holders;
}

export function signLocalReward(scanId: string, expires: number) {
  const digest = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(`local-sample-reward:${scanId}:${expires}`)
    .digest("hex");
  return `${expires}.${digest}`;
}

export function hasLocalReward(scanId: string, value?: string) {
  if (!localRewardEnabled() || !value || !/^\d{13}\.[a-f0-9]{64}$/.test(value))
    return false;
  const expires = Number(value.slice(0, 13));
  return (
    expires > Date.now() &&
    timingSafeEqual(
      Buffer.from(value),
      Buffer.from(signLocalReward(scanId, expires)),
    )
  );
}

export function localPointsEnabled() {
  return (
    localRewardEnabled() && process.env.DATADEAL_LOCAL_SAMPLE_ADS === "true"
  );
}
export const offerBrowserCookie = "dd-reward-browser";
export function offerBrowserHash(value?: string) {
  if (!localPointsEnabled() || !value || !/^[A-Za-z0-9_-]{43}$/.test(value))
    return "";
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update("reward-browser:" + value)
    .digest("hex");
}
