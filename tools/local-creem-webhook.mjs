import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { parseEnv } from "node:util";

const path = "/api/v1/billing/creem";
const maxBytes = 128_000;
const sign = (body, secret) =>
  createHmac("sha256", secret).update(body).digest();

export function localWebhookRelay(secret, forward) {
  return createServer({ requestTimeout: 15_000 }, async (req, res) => {
    if (req.method !== "POST" || req.url !== path)
      return res.writeHead(404).end();
    const signature = req.headers["creem-signature"];
    if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature))
      return res.writeHead(401).end();
    let length = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        length += chunk.length;
        if (length > maxBytes) return res.writeHead(413).end();
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks, length);
      if (!timingSafeEqual(sign(body, secret), Buffer.from(signature, "hex")))
        return res.writeHead(401).end();
      const response = await forward(body, signature);
      res.writeHead(response.status).end();
    } catch {
      res.writeHead(502).end();
    }
  });
}

if (import.meta.main) {
  const config = parseEnv(
    await readFile(new URL("../apps/web/.env.local", import.meta.url), "utf8"),
  );
  if (config.CREEM_MODE !== "test" || !config.CREEM_WEBHOOK_SECRET)
    throw new Error(
      "Configure the Creem test webhook in apps/web/.env.local first.",
    );
  const forward = (body, signature) =>
    fetch("http://127.0.0.1:3000" + path, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "content-type": "application/json",
        "creem-signature": signature,
      },
      body,
    });

  // An unhandled event verifies the running app's secret without writing a purchase.
  const probe = JSON.stringify({
    id: "local-relay-check",
    eventType: "local.relay_check",
    created_at: Date.now(),
    object: {},
  });
  const health = await forward(
    probe,
    sign(probe, config.CREEM_WEBHOOK_SECRET).toString("hex"),
  );
  if (!health.ok)
    throw new Error("Local Creem handler returned HTTP " + health.status);

  const server = localWebhookRelay(config.CREEM_WEBHOOK_SECRET, forward);
  server.listen(56451, "127.0.0.1");
  await once(server, "listening");
  console.log(
    "Use the printed HTTPS tunnel address followed by " +
      path +
      " in the Creem test dashboard.",
  );
  const tunnel = spawn(
    "cloudflared",
    ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:56451"],
    { stdio: "inherit", windowsHide: true },
  );
  const stop = () => tunnel.kill();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const [code, signal] = await once(tunnel, "exit");
    process.exitCode = code ?? (signal === "SIGTERM" ? 0 : 1);
  } finally {
    server.close();
    server.closeAllConnections();
  }
}
