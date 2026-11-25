import { request } from "node:https";
import type { IncomingMessage } from "node:http";
import { resolvePublicAddress } from "./public-address";

const maxIconBytes = 64_000;
const maxHtmlBytes = 300_000;

/** PNG (≤ 512 px) or ICO only. SVG can carry script, so it is never served. */
export function iconDataUrl(body: Buffer) {
  if (
    body.length >= 24 &&
    body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    if (body.readUInt32BE(16) > 512 || body.readUInt32BE(20) > 512) return;
    return "data:image/png;base64," + body.toString("base64");
  }
  if (body.length >= 6 && body.readUInt32LE(0) === 0x00010000)
    return "data:image/x-icon;base64," + body.toString("base64");
}

/** GET over HTTPS to a public address only, re-checking every redirect hop. */
async function get(
  url: URL,
  signal: AbortSignal,
  limit: number,
  redirects = 0,
): Promise<{ body: Buffer; url: URL; type: string } | undefined> {
  if (url.protocol !== "https:" || url.username || url.password) return;
  if (redirects > 3) return;
  const pinned = await resolvePublicAddress(url.hostname);
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = request(
      url,
      {
        agent: false,
        signal,
        family: pinned.family,
        lookup: (_host, _options, callback) =>
          callback(null, pinned.address, pinned.family),
        headers: { "User-Agent": "DataDealResearch/1.0" },
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
  const code = response.statusCode ?? 0;
  if ([301, 302, 303, 307, 308].includes(code) && response.headers.location) {
    response.destroy();
    return get(
      new URL(response.headers.location, url),
      signal,
      limit,
      redirects + 1,
    );
  }
  if (code !== 200) {
    response.destroy();
    return;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response as AsyncIterable<Buffer>) {
    bytes += chunk.length;
    if (bytes > limit) {
      response.destroy();
      return;
    }
    chunks.push(chunk);
  }
  return {
    body: Buffer.concat(chunks),
    url,
    type: String(response.headers["content-type"] ?? ""),
  };
}

function linkedIcons(html: string, base: URL) {
  const icons: URL[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel=["']?[^"'>]*\bicon\b/i.test(tag)) continue;
    const href = tag.match(/\bhref=["']?([^"'\s>]+)/i)?.[1];
    if (!href || /\.svg(?:$|\?)/i.test(href)) continue;
    try {
      icons.push(new URL(href.replaceAll("&amp;", "&"), base));
    } catch {
      /* Ignore malformed links. */
    }
  }
  return icons.slice(0, 3);
}

/**
 * Finds a small PNG or ICO favicon for a public host: /favicon.ico on the
 * host and its www name, then icons linked from the homepage.
 */
export async function readSiteFavicon(host: string, signal: AbortSignal) {
  const attempt = async (url: URL) => {
    const result = await get(url, signal, maxIconBytes).catch(() => undefined);
    return result && iconDataUrl(result.body);
  };
  const names = host.startsWith("www.") ? [host] : [host, "www." + host];
  for (const name of names) {
    const icon = await attempt(new URL(`https://${name}/favicon.ico`));
    if (icon) return icon;
  }
  for (const name of names) {
    const page = await get(
      new URL(`https://${name}/`),
      signal,
      maxHtmlBytes,
    ).catch(() => undefined);
    if (!page || !/text\/html/i.test(page.type)) continue;
    for (const link of linkedIcons(page.body.toString("utf8"), page.url)) {
      const icon = await attempt(link);
      if (icon) return icon;
    }
  }
}
