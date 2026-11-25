import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const origin = process.env.APP_ORIGIN;
  if (
    process.env.NODE_ENV !== "development" ||
    !origin ||
    request.method !== "GET" ||
    !request.headers.get("accept")?.includes("text/html")
  )
    return;

  const destination = new URL(origin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  if (!loopback.includes(destination.hostname)) return;
  const host = request.headers.get("host");
  const aliases = loopback.map((name) =>
    destination.port ? name + ":" + destination.port : name,
  );
  if (!host || !aliases.includes(host) || host === destination.host) return;

  // Next makes proxy redirects relative to its bind address. A route handler
  // preserves the absolute Location header when the browser used an alias.
  const route = request.nextUrl.clone();
  route.pathname = "/api/local-origin";
  route.search = "";
  route.searchParams.set("path", request.nextUrl.pathname);
  route.searchParams.set("query", request.nextUrl.search);
  return NextResponse.rewrite(route);
}

export const config = {
  matcher: "/((?!api(?:/|$)|_next(?:/|$)).*)",
};
