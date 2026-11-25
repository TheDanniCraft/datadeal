import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import ipaddr from "ipaddr.js";
import { domain } from "@datadeal/contracts";

export function selectPublicAddress(addresses: LookupAddress[]) {
  const allPublic = addresses.every(({ address, family }) => {
    const parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv4") {
      return family === 4 && parsed.range() === "unicast";
    }
    const v6 = parsed as ipaddr.IPv6;
    return (
      family === 6 &&
      v6.range() === "unicast" &&
      v6.match(ipaddr.parse("2000::") as ipaddr.IPv6, 3)
    );
  });
  if (!addresses.length || !allPublic) {
    throw new Error("Destination is outside the public network");
  }
  return addresses[0];
}

export async function resolvePublicAddress(host: string) {
  return selectPublicAddress(await lookup(domain.parse(host), { all: true }));
}
