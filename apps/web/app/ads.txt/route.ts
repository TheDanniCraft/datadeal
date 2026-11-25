import { adsensePublisher } from "../../lib/ads/adsense";

export const dynamic = "force-static";

export function GET() {
  return new Response(
    `google.com, ${adsensePublisher}, DIRECT, f08c47fec0942fa0\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
