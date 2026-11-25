import { developerApiPreview, readDeveloperToken } from "./developer-token";
import { database } from "./reports";

export const scanResponseHeaders = { "Cache-Control": "private, no-store" };

export function rejectDeveloperScan(
  code: string,
  status: number,
  retryAfter?: number,
) {
  return Response.json(
    { code },
    {
      status,
      headers: {
        ...scanResponseHeaders,
        ...(retryAfter && { "Retry-After": String(retryAfter) }),
        ...(status === 401 && { "WWW-Authenticate": "Bearer" }),
      },
    },
  );
}

export async function authorizeDeveloperScan(request: Request) {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(request.url).hostname,
  );
  if (!developerApiPreview || !local || !database)
    return rejectDeveloperScan("unavailable", 404);
  const token = readDeveloperToken(request.headers.get("Authorization"));
  const verified =
    token && (await database.verifyApiToken(token.id, token.hash));
  if (!verified) return rejectDeveloperScan("invalid_token", 401);
  if ("retryAfter" in verified)
    return rejectDeveloperScan("rate_limit", 429, verified.retryAfter);
  if (verified.scope !== "scans:request")
    return rejectDeveloperScan("insufficient_scope", 403);
  return { database, userId: verified.userId };
}

export function developerScanStatusPath(id: string) {
  return "/api/v1/developer/scans/status/" + encodeURIComponent(id);
}
