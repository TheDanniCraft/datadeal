import { domain, scanReport } from "@datadeal/contracts";
import { database } from "../../../../../../lib/reports";
import { bundledSiteFavicon } from "../../../../../../lib/site-favicon";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ domain: string }> },
) {
  const host = domain.safeParse((await params).domain);
  const headers = {
    "Cache-Control": "public, max-age=60",
    "X-Content-Type-Options": "nosniff",
  };
  if (!host.success) return new Response(null, { status: 404, headers });
  const icon = scanReport.shape.favicon.safeParse(
    await database?.publishedFavicon(host.data),
  );
  if (!icon.success || !icon.data) {
    const fallback = bundledSiteFavicon(host.data);
    return fallback
      ? new Response(null, {
          status: 307,
          headers: { ...headers, Location: fallback },
        })
      : new Response(null, { status: 404, headers });
  }
  const [metadata, encoded] = icon.data.split(",", 2);
  const type =
    metadata === "data:image/png;base64" ? "image/png" : "image/x-icon";
  return new Response(new Uint8Array(Buffer.from(encoded, "base64")), {
    headers: { ...headers, "Content-Type": type },
  });
}
