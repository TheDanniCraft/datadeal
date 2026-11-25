import { domain, scanReport } from "@datadeal/contracts";
import { readSiteFavicon } from "@datadeal/scanner/favicon";
import { database } from "../../../../../../lib/reports";
import { bundledSiteFavicon } from "../../../../../../lib/site-favicon";

// Fetched server-side so a visitor's browser never contacts the domain
// (often an ad or tracking host) just to draw its icon.
const fetched = new Map<string, { icon?: string; until: number }>();
const pending = new Map<string, Promise<string | undefined>>();
const day = 86_400_000;

async function remoteFavicon(host: string) {
  const cached = fetched.get(host);
  if (cached && cached.until > Date.now()) return cached.icon;
  let request = pending.get(host);
  if (!request) {
    request = readSiteFavicon(host, AbortSignal.timeout(5000))
      .catch(() => undefined)
      .then((icon) => {
        if (fetched.size > 2000) fetched.clear();
        fetched.set(host, {
          icon,
          until: Date.now() + (icon ? day : day / 4),
        });
        pending.delete(host);
        return icon;
      });
    pending.set(host, request);
  }
  return request;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ domain: string }> },
) {
  const host = domain.safeParse((await params).domain);
  const headers = {
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
  };
  if (!host.success) return new Response(null, { status: 404, headers });
  const bundled = bundledSiteFavicon(host.data);
  if (bundled)
    return new Response(null, {
      status: 307,
      headers: { ...headers, Location: bundled },
    });
  const stored = scanReport.shape.favicon.safeParse(
    await database?.publishedFavicon(host.data),
  );
  const icon =
    (stored.success && stored.data) || (await remoteFavicon(host.data));
  if (!icon)
    return new Response(null, {
      status: 404,
      headers: { ...headers, "Cache-Control": "public, max-age=21600" },
    });
  const [metadata, encoded] = icon.split(",", 2);
  const type =
    metadata === "data:image/png;base64" ? "image/png" : "image/x-icon";
  return new Response(new Uint8Array(Buffer.from(encoded, "base64")), {
    headers: { ...headers, "Content-Type": type },
  });
}
