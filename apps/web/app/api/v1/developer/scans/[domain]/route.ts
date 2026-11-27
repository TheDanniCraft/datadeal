import { domain, siteDomain } from "@datadeal/contracts";
import { createHash } from "node:crypto";
import { z } from "zod";
import { developerScanCost } from "../../../../../../lib/developer-token";
import {
  authorizeDeveloperScan,
  developerScanStatusPath,
  rejectDeveloperScan as reject,
  scanResponseHeaders as headers,
} from "../../../../../../lib/developer-scan";

import { pointApiUsage } from "../../../../../../lib/point-usage";

const acceptedScan = z.object({ id: z.uuid() });

function accepted(response: unknown) {
  const scan = acceptedScan.safeParse(response);
  if (!scan.success) return reject("scan_unavailable", 503);
  return Response.json(scan.data, {
    status: 202,
    headers: { ...headers, Location: developerScanStatusPath(scan.data.id) },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ domain: string }> },
) {
  const auth = await authorizeDeveloperScan(request);
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const parsed = siteDomain.safeParse((await params).domain);
  if (!parsed.success) return reject("invalid_domain", 400);
  const key = request.headers.get("Idempotency-Key");
  if (!key || !/^[A-Za-z0-9._:-]{1,160}$/.test(key))
    return reject("invalid_idempotency_key", 400);
  const requestHash = createHash("sha256")
    .update("scan:request\0" + parsed.data)
    .digest("hex");
  if (developerScanCost === null) return reject("scan_unavailable", 503);
  const result = await pointApiUsage(
    userId,
    { key, requestHash, points: developerScanCost },
    parsed.data,
    "scan",
  );
  switch (result.code) {
    case "applied":
    case "replayed":
      return accepted(result.response);
    case "conflict":
      return reject("idempotency_conflict", 409);
    case "insufficient":
      return Response.json(
        { code: "insufficient_points", required: developerScanCost },
        { status: 402, headers },
      );
    case "daily_limit":
    case "hourly_limit": {
      const window = result.code === "daily_limit" ? 86400 : 3600;
      return reject(
        result.code,
        429,
        window - (Math.floor(Date.now() / 1000) % window),
      );
    }
    case "scan_in_progress":
      return reject(result.code, 409);
    case "domain_cooldown":
      return reject(result.code, 429, result.retryAfter);
    case "queue_full":
      return reject(result.code, 429, 60);
  }
  return reject("scan_unavailable", 503);
}
