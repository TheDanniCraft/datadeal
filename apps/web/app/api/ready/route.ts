import { database } from "../../../lib/reports";

export const dynamic = "force-dynamic";

export async function GET() {
  let ready = false;
  if (database) {
    try {
      await database.checkScanStorage();
      ready = true;
    } catch {
      ready = false;
    }
  }
  return Response.json(
    { ready },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
