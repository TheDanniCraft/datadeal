import { once } from "node:events";
import { createConnection, createServer, type NetConnectOpts } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { selectPublicAddress } from "../../packages/scanner/public-address";
import { startBrowserEgressProxy } from "./egress-proxy";

// Keep these transport tests entirely on loopback. DNS and the upstream
// connector are replaced, while the actual proxy parses and serves requests.
const mock = vi.hoisted(() => ({
  lookup: vi.fn(async (_host: string) => [{ address: "8.8.8.8", family: 4 }]),
  connect: vi.fn<(options: NetConnectOpts) => import("node:net").Socket>(),
}));
vi.mock("node:dns/promises", () => ({ lookup: mock.lookup }));
vi.mock("node:net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:net")>()),
  connect: mock.connect,
}));
afterEach(() => vi.clearAllMocks());

async function request(port: number, message: string) {
  const client = createConnection(port, "127.0.0.1");
  client.setEncoding("utf8");
  try {
    await once(client, "connect");
    client.write(message);
    const [response] = await once(client, "data");
    return String(response);
  } finally {
    client.destroy();
  }
}

it("refuses literal and mixed private destinations before opening a connection", async () => {
  const proxy = await startBrowserEgressProxy("127.0.0.1", 0);
  const port = Number(new URL(proxy.url).port);
  try {
    for (const target of [
      "localhost:443",
      "127.0.0.1:443",
      "[::1]:443",
      "example.org:80",
    ]) {
      expect(
        await request(
          port,
          `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`,
        ),
      ).toContain("403");
    }
    expect(mock.lookup).not.toHaveBeenCalled();
    mock.lookup.mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(
      await request(
        port,
        "CONNECT mixed.example:443 HTTP/1.1\r\nHost: mixed.example\r\n\r\n",
      ),
    ).toContain("403");
    expect(mock.connect).not.toHaveBeenCalled();
  } finally {
    proxy.close();
  }
});

it("serves only a local health check without forwarding ordinary HTTP", async () => {
  const proxy = await startBrowserEgressProxy("127.0.0.1", 0);
  const port = Number(new URL(proxy.url).port);
  try {
    expect(
      await request(port, "GET /healthz HTTP/1.1\r\nHost: proxy\r\n\r\n"),
    ).toContain("204");
    expect(
      await request(
        port,
        "GET http://site.example/healthz HTTP/1.1\r\nHost: site.example\r\n\r\n",
      ),
    ).toContain("403");
    expect(mock.lookup).not.toHaveBeenCalled();
    expect(mock.connect).not.toHaveBeenCalled();
  } finally {
    proxy.close();
  }
});

it("bounds outstanding DNS work and closes clients waiting for it on shutdown", async () => {
  const proxy = await startBrowserEgressProxy("127.0.0.1", 0);
  const port = Number(new URL(proxy.url).port);
  let release!: () => void;
  const pending = new Promise<{ address: string; family: number }[]>(
    (resolve) => {
      release = () => resolve([]);
    },
  );
  const clients: import("node:net").Socket[] = [];
  try {
    for (let i = 0; i < 32; i++) {
      mock.lookup.mockImplementationOnce(() => pending);
      const client = createConnection(port, "127.0.0.1");
      clients.push(client);
      await once(client, "connect");
      client.write(
        "CONNECT awaiting.example:443 HTTP/1.1\r\nHost: awaiting.example\r\n\r\n",
      );
    }
    await vi.waitFor(() => expect(mock.lookup).toHaveBeenCalledTimes(32));
    expect(
      await request(
        port,
        "CONNECT busy.example:443 HTTP/1.1\r\nHost: busy.example\r\n\r\n",
      ),
    ).toContain("503");
    const closed = Promise.all(clients.map((client) => once(client, "close")));
    proxy.close();
    await closed;
    expect(mock.connect).not.toHaveBeenCalled();
  } finally {
    release();
    clients.forEach((client) => client.destroy());
    proxy.close();
  }
});

it("opens the tunnel to the selected numeric address without a second lookup", async () => {
  const upstream = createServer((socket) => socket.end("fixture"));
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture port");
  mock.connect.mockImplementationOnce(() =>
    createConnection(address.port, "127.0.0.1"),
  );
  const proxy = await startBrowserEgressProxy("127.0.0.1", 0);
  try {
    expect(
      await request(
        Number(new URL(proxy.url).port),
        "CONNECT site.example:443 HTTP/1.1\r\nHost: site.example\r\n\r\n",
      ),
    ).toContain("200 Connection Established");
    expect(mock.lookup).toHaveBeenCalledExactlyOnceWith("site.example", {
      all: true,
    });
    expect(mock.connect).toHaveBeenCalledExactlyOnceWith({
      host: "8.8.8.8",
      family: 4,
      port: 443,
    });
  } finally {
    proxy.close();
    upstream.close();
  }
});

it("rejects private, mapped, special-use, and empty DNS answers", () => {
  for (const address of [
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "4000::1",
  ]) {
    expect(() =>
      selectPublicAddress([{ address, family: address.includes(":") ? 6 : 4 }]),
    ).toThrow();
  }
  expect(() => selectPublicAddress([])).toThrow();
  expect(
    selectPublicAddress([{ address: "2606:4700:4700::1111", family: 6 }])
      .family,
  ).toBe(6);
});
