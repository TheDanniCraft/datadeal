import { basename } from "node:path";

export function localOutboxName() {
  const { NODE_ENV, DATADEAL_MAIL_MODE, DATADEAL_LOCAL_MAIL_FILE, APP_ORIGIN } =
    process.env;
  if (
    NODE_ENV !== "development" ||
    DATADEAL_MAIL_MODE !== "local" ||
    !DATADEAL_LOCAL_MAIL_FILE ||
    !APP_ORIGIN ||
    !URL.canParse(APP_ORIGIN)
  )
    return undefined;
  return ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(APP_ORIGIN).hostname,
  )
    ? basename(DATADEAL_LOCAL_MAIL_FILE)
    : undefined;
}
