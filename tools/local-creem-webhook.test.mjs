import { createHmac } from "node:crypto";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { localWebhookRelay } from "./local-creem-webhook.mjs";

it("forwards only the signed webhook body and propagates the handler status", async () => {
  const key = "local-test-key";
  const forward = vi.fn(async () => new Response(null, { status: 204 }));
  const server = localWebhookRelay(key, forward);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  const url = origin + "/api/v1/billing/creem";
  const body = '{ "message": "Buchung bestätigt" }\n';
  const signature = createHmac("sha256", key).update(body).digest("hex");
  const signed = {
    method: "POST",
    body,
    headers: { "creem-signature": signature },
  };
  try {
    expect((await fetch(origin + "/account", signed)).status).toBe(404);
    expect((await fetch(url)).status).toBe(404);
    expect((await fetch(url, { method: "POST", body })).status).toBe(401);
    expect((await fetch(url, { ...signed, body: body.trimEnd() })).status).toBe(
      401,
    );
    expect(
      (await fetch(url, { ...signed, body: "a".repeat(128001) })).status,
    ).toBe(413);
    expect(forward).not.toHaveBeenCalled();
    expect((await fetch(url, signed)).status).toBe(204);
    expect(forward).toHaveBeenCalledExactlyOnceWith(
      Buffer.from(body),
      signature,
    );
    forward.mockRejectedValueOnce(new Error("upstream offline"));
    expect((await fetch(url, signed)).status).toBe(502);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
