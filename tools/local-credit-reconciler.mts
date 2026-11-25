import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { connect, creemCreditsClient } from "../packages/database";

const config = parseEnv(
  await readFile(new URL("../apps/web/.env.local", import.meta.url), "utf8"),
);
const dbUrl = new URL(config.DATABASE_URL);
if (
  !["postgres:", "postgresql:"].includes(dbUrl.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(dbUrl.hostname) ||
  config.CREEM_MODE !== "test" ||
  !config.CREEM_API_KEY ||
  config.DATADEAL_DEVELOPER_API_PREVIEW !== "true"
)
  throw Error(
    "The local billing reconciler requires a loopback preview database and Creem test credentials.",
  );
process.env.CREEM_MODE = config.CREEM_MODE;
process.env.CREEM_API_KEY = config.CREEM_API_KEY;
const provider = creemCreditsClient();
if (!provider) throw Error("Creem sandbox client unavailable");
const db = connect(dbUrl.href);
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
try {
  await db.checkScanStorage();
  console.log("DataDeal sandbox billing reconciler ready");
  while (!stopping) {
    try {
      await db.retryNativeUsage(provider);
    } catch {
      console.warn("Sandbox billing reconciliation unavailable");
    }
    if (!stopping) await delay(3000);
  }
} finally {
  await db.close();
}
