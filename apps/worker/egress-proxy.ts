import { once } from "node:events";
import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { resolvePublicAddress } from "../../packages/scanner/public-address";

function reject(client: Duplex, status: string) {
  if (!client.destroyed) {
    client.end(
      `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  }
}

export async function startBrowserEgressProxy(host: string, port: number) {
  const clients = new Set<Socket>();
  let pendingLookups = 0;
  const server = createServer(
    {
      maxHeaderSize: 8192,
      headersTimeout: 5000,
      requestTimeout: 5000,
      connectionsCheckingInterval: 1000,
    },
    (req, res) => {
      const health = req.method === "GET" && req.url === "/healthz";
      res.writeHead(health ? 204 : 403, { Connection: "close" }).end();
    },
  );
  server.maxConnections = 64;
  server.on("connection", (client) => {
    clients.add(client);
    const lifetime = setTimeout(() => client.destroy(), 60_000).unref();
    client.setTimeout(15_000, () => client.destroy());
    client.on("error", () => client.destroy());
    client.once("close", () => {
      clearTimeout(lifetime);
      clients.delete(client);
    });
  });
  server.on("upgrade", (_req, client) => reject(client, "403 Forbidden"));
  server.on("connect", async (req, client, head) => {
    const authority = req.url ?? "";
    if (!/^[a-z0-9.-]+:443$/i.test(authority)) {
      reject(client, "403 Forbidden");
      return;
    }
    if (pendingLookups >= 32) {
      reject(client, "503 Service Unavailable");
      return;
    }
    const deadline = setTimeout(() => client.destroy(), 5000).unref();
    client.once("close", () => clearTimeout(deadline));
    let pinned;
    try {
      pendingLookups++;
      pinned = await resolvePublicAddress(authority.slice(0, -4));
    } catch {
      reject(client, "403 Forbidden");
      return;
    } finally {
      pendingLookups--;
    }
    if (client.destroyed) return;
    const remote = connect({
      host: pinned.address,
      family: pinned.family,
      port: 443,
    });
    client.once("close", () => remote.destroy());
    remote.on("error", () => client.destroy());
    remote.once("close", () => client.destroy());
    remote.setTimeout(15_000, () => remote.destroy());
    remote.once("connect", () => {
      clearTimeout(deadline);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) remote.write(head);
      client.pipe(remote).pipe(client);
    });
  });
  server.listen(port, host);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Missing browser proxy port");
  }
  return {
    url: `http://${host}:${address.port}`,
    close() {
      server.close();
      for (const client of clients) client.destroy();
    },
  };
}
