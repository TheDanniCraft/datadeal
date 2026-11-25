export function umamiConfig() {
  const address = process.env.DATADEAL_UMAMI_ORIGIN?.trim();
  const websiteId = process.env.DATADEAL_UMAMI_WEBSITE_ID?.trim();
  if (
    !address ||
    !websiteId ||
    !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(websiteId)
  )
    return;
  const origin = URL.parse(address);
  if (
    !origin ||
    origin.username ||
    origin.password ||
    origin.href !== origin.origin + "/"
  )
    return;
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    origin.hostname,
  );
  if (
    origin.protocol !== "https:" &&
    !(
      loopback &&
      origin.protocol === "http:" &&
      process.env.NODE_ENV !== "production"
    )
  )
    return;
  return { endpoint: origin.origin + "/api/send", websiteId };
}

const publicPages = new Set([
  "/",
  "/advertising-disclosure",
  "/compare",
  "/data-flow",
  "/developers",
  "/learn",
  "/methodology",
  "/pricing",
  "/privacy",
  "/terms",
]);

export function publicPageCategory(pathname: string) {
  if (/^\/report\/[^/]+\/?$/.test(pathname)) return "/report";
  return publicPages.has(pathname) ? pathname : undefined;
}
