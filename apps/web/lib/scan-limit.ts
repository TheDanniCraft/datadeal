import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export function scanClientKey(
  request: Request,
  window: "hour" | "day" = "hour",
) {
  const header = process.env.DATADEAL_TRUSTED_CLIENT_IP_HEADER;
  const secret = process.env.DATADEAL_SCAN_LIMIT_SECRET;
  if (
    !header ||
    !/^[A-Za-z0-9_-]+$/.test(header) ||
    !secret ||
    secret.length < 32
  )
    return null;
  const candidate = request.headers.get(header)?.trim();
  if (!candidate || !isIP(candidate)) return null;
  return (
    (window === "day" ? "daily:client:" : "client:") +
    createHmac("sha256", secret)
      .update(new Date().toISOString().slice(0, window === "day" ? 10 : 13))
      .update("|")
      .update(
        new URL(
          "http://[" +
            (isIP(candidate) === 6 ? candidate : "::ffff:" + candidate) +
            "]/",
        ).hostname,
      )
      .digest("hex")
  );
}
