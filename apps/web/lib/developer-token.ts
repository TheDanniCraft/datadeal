import { createHash, randomBytes } from "node:crypto";
import {
  defaultRefreshPointCost,
  defaultReportPointCost,
} from "@datadeal/contracts/paper-plane";
import { pointsEnabled } from "./local-reward";

export const developerApiPreview =
  process.env.NODE_ENV === "development" &&
  process.env.DATADEAL_DEVELOPER_API_PREVIEW === "true";

/**
 * API requests are paid in points: a saved report read costs the same as a
 * report unlock, a new scan the same as a rescan. Null while points are off.
 */
export const developerReportReadCost = pointsEnabled()
  ? defaultReportPointCost
  : null;
export const developerScanCost = pointsEnabled()
  ? defaultRefreshPointCost
  : null;

export function hashDeveloperToken(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export function createDeveloperTokenSecret() {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: hashDeveloperToken(secret) };
}

export function readDeveloperToken(authorization: string | null) {
  const match = /^Bearer dd_([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(
    authorization ?? "",
  );
  return match ? { id: match[1], hash: hashDeveloperToken(match[2]) } : null;
}
