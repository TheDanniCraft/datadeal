import { startBrowserEgressProxy } from "./egress-proxy";

const proxy = await startBrowserEgressProxy(
  process.env.DATADEAL_PROXY_BIND_ADDRESS ?? "0.0.0.0",
  8080,
);
process.once("SIGTERM", proxy.close);
process.once("SIGINT", proxy.close);
