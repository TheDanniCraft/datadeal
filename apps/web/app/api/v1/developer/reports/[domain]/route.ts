import { domain, siteDomain } from "@datadeal/contracts";
import { createHash } from "node:crypto";
import {
  developerApiPreview,
  developerReportReadCost,
  readDeveloperToken,
} from "../../../../../../lib/developer-token";
import { publishedReportPayload } from "../../../../../../lib/published-report";
import { database } from "../../../../../../lib/reports";

import { nativeApiUsage } from "../../../../../../lib/native-usage";

const headers = { "Cache-Control": "private, no-store" };

async function readReport(
  request: Request,
  { params }: { params: Promise<{ domain: string }> },
) {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(request.url).hostname,
  );
  if (!developerApiPreview || !local || !database)
    return new Response(null, { status: 404, headers });

  const token = readDeveloperToken(request.headers.get("Authorization"));
  const verified =
    token && (await database.verifyApiToken(token.id, token.hash));
  if (!verified)
    return Response.json(
      { code: "invalid_token" },
      { status: 401, headers: { ...headers, "WWW-Authenticate": "Bearer" } },
    );
  if ("retryAfter" in verified)
    return Response.json(
      { code: "rate_limit" },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(verified.retryAfter) },
      },
    );
  if (verified.scope !== "reports:read")
    return Response.json(
      { code: "insufficient_scope" },
      { status: 403, headers },
    );

  const parsed = siteDomain.safeParse((await params).domain);
  if (!parsed.success)
    return Response.json({ code: "invalid_domain" }, { status: 400, headers });

  const conflict = () =>
    Response.json({ code: "idempotency_conflict" }, { status: 409, headers });
  let charge: { key: string; requestHash: string; amount: number } | undefined;
  if (request.method === "POST") {
    const key = request.headers.get("Idempotency-Key");
    if (!key || !/^[A-Za-z0-9._:-]{1,160}$/.test(key))
      return Response.json(
        { code: "invalid_idempotency_key" },
        { status: 400, headers },
      );
    const requestHash = createHash("sha256")
      .update("report:read\0" + parsed.data)
      .digest("hex");
    if (developerReportReadCost === null)
      return Response.json(
        { code: "paid_read_unavailable" },
        { status: 503, headers },
      );
    charge = { key, requestHash, amount: developerReportReadCost };
  }

  const load = async () => {
    const payload = await publishedReportPayload(parsed.data);
    return payload.report && !payload.report.demo ? payload : null;
  };
  const missing = () =>
    Response.json({ code: "report_unavailable" }, { status: 404, headers });
  if (!charge) {
    const payload = await load();
    return payload ? Response.json(payload, { headers }) : missing();
  }
  const result = await nativeApiUsage(
    verified.userId,
    charge,
    parsed.data,
    "datadeal_report_read",
    load,
  );
  if (result.code === "report_unavailable") return missing();
  if (result.code === "conflict") return conflict();
  if (result.code === "expired")
    return Response.json(
      { code: "read_expired_use_new_key" },
      { status: 410, headers },
    );
  if (result.code === "insufficient")
    return Response.json(
      { code: "insufficient_credits", required: charge.amount },
      { status: 402, headers },
    );
  if (result.code === "applied" || result.code === "replayed")
    return Response.json(result.response, {
      headers:
        result.code === "replayed"
          ? { ...headers, "Idempotency-Replayed": "true" }
          : headers,
    });
  return Response.json(
    { code: "credit_debit_unavailable" },
    { status: 503, headers },
  );
}

export { readReport as GET, readReport as POST };
