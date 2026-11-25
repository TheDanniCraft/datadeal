export function GET(request: Request) {
  const origin = process.env.APP_ORIGIN;
  if (process.env.NODE_ENV !== "development" || !origin)
    return new Response(null, { status: 404 });
  const target = new URL(origin);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
    return new Response(null, { status: 404 });
  const query = new URL(request.url).searchParams;
  target.pathname = query.get("path") ?? "/";
  target.search = query.get("query") ?? "";
  return new Response(null, {
    status: 307,
    headers: { Location: target.href, "Cache-Control": "no-store" },
  });
}
