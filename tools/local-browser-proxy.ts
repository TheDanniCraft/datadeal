import { startBrowserEgressProxy } from "../apps/worker/egress-proxy";

export function startLocalBrowserProxy() {
  return startBrowserEgressProxy("127.0.0.1", 0);
}
