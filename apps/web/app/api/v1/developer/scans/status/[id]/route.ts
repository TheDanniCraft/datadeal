import { z } from "zod";
import {
  authorizeDeveloperScan,
  rejectDeveloperScan,
  scanResponseHeaders,
} from "../../../../../../../lib/developer-scan";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeDeveloperScan(request);
  if (auth instanceof Response) return auth;
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) return rejectDeveloperScan("invalid_scan_id", 400);
  const scan = await auth.database.apiScanStatus(auth.userId, parsed.data);
  if (!scan) return rejectDeveloperScan("scan_unavailable", 404);
  const { reportPublished, ...status } = scan;
  return Response.json(
    {
      ...status,
      reportPath: reportPublished
        ? `/report/${scan.domain}?scan=${scan.id}`
        : null,
    },
    { headers: scanResponseHeaders },
  );
}
