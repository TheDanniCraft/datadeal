import { createHash, randomBytes } from "node:crypto";

export const developerApiPreview =
  process.env.NODE_ENV === "development" &&
  process.env.DATADEAL_DEVELOPER_API_PREVIEW === "true";

function creditCost(configured = "") {
  return /^[1-9]\d{0,9}$/.test(configured) &&
    Number(configured) <= 2_147_483_647
    ? Number(configured)
    : null;
}

export const developerReportReadCost = creditCost(
  process.env.DATADEAL_API_REPORT_READ_CREDITS,
);
export const developerScanCost = creditCost(
  process.env.DATADEAL_API_SCAN_CREDITS,
);

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
