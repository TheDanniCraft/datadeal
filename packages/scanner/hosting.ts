import { Resolver } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { isEuropean } from "@datadeal/contracts";

export { isEuropean };

type Provider = { name: string; country: string };

/** Network owners matched by ASN name. Order matters: first match wins. */
const providers: [RegExp, Provider][] = [
  [/cloudflare/i, { name: "Cloudflare", country: "US" }],
  [/amazon|aws/i, { name: "Amazon Web Services", country: "US" }],
  [/google/i, { name: "Google Cloud", country: "US" }],
  [/microsoft|azure/i, { name: "Microsoft Azure", country: "US" }],
  [/fastly/i, { name: "Fastly", country: "US" }],
  [/akamai|linode/i, { name: "Akamai", country: "US" }],
  [/vercel/i, { name: "Vercel", country: "US" }],
  [/netlify/i, { name: "Netlify", country: "US" }],
  [/digitalocean/i, { name: "DigitalOcean", country: "US" }],
  [/oracle/i, { name: "Oracle Cloud", country: "US" }],
  [/github/i, { name: "GitHub", country: "US" }],
  [/hetzner/i, { name: "Hetzner", country: "DE" }],
  [/\bovh/i, { name: "OVHcloud", country: "FR" }],
  [/ionos|1&1|oneandone/i, { name: "IONOS", country: "DE" }],
  [/strato/i, { name: "Strato", country: "DE" }],
  [/netcup/i, { name: "netcup", country: "DE" }],
  [/contabo/i, { name: "Contabo", country: "DE" }],
  [/scaleway|online s\.?a\.?s/i, { name: "Scaleway", country: "FR" }],
  [/bunny/i, { name: "bunny.net", country: "SI" }],
  [/g-?core/i, { name: "Gcore", country: "LU" }],
  [/leaseweb/i, { name: "Leaseweb", country: "NL" }],
  [/hostinger/i, { name: "Hostinger", country: "LT" }],
  [/infomaniak/i, { name: "Infomaniak", country: "CH" }],
  [/hosteurope|host europe/i, { name: "Host Europe", country: "DE" }],
  [/all-?inkl/i, { name: "ALL-INKL.COM", country: "DE" }],
  [/plusserver/i, { name: "plusserver", country: "DE" }],
];

/** Response headers that name a CDN or proxy in front of the site. */
const cdnHeaders: [string, RegExp | null, Provider][] = [
  ["cf-ray", null, { name: "Cloudflare", country: "US" }],
  ["x-amz-cf-id", null, { name: "Amazon CloudFront", country: "US" }],
  ["x-vercel-id", null, { name: "Vercel", country: "US" }],
  ["x-nf-request-id", null, { name: "Netlify", country: "US" }],
  ["x-azure-ref", null, { name: "Microsoft Azure Front Door", country: "US" }],
  ["x-served-by", /cache-/i, { name: "Fastly", country: "US" }],
  ["x-akamai-transformed", null, { name: "Akamai", country: "US" }],
  ["server", /akamaighost/i, { name: "Akamai", country: "US" }],
  ["cdn-pullzone", null, { name: "bunny.net", country: "SI" }],
  ["fly-request-id", null, { name: "Fly.io", country: "US" }],
];

export const hostingHeaderNames = [
  ...new Set([...cdnHeaders.map(([name]) => name), "server", "via"]),
];

export type HostingObservation = {
  type: "hosting";
  ip?: string;
  asn?: number;
  network?: string;
  networkCountry?: string;
  host?: Provider;
  cdn?: Provider;
};

function cymruName(ip: string) {
  const parsed = ipaddr.parse(ip);
  if (parsed.kind() === "ipv4")
    return (
      parsed.toString().split(".").reverse().join(".") + ".origin.asn.cymru.com"
    );
  const nibbles = (parsed as ipaddr.IPv6)
    .toNormalizedString()
    .split(":")
    .map((part) => part.padStart(4, "0"))
    .join("")
    .split("")
    .reverse()
    .join(".");
  return nibbles + ".origin6.asn.cymru.com";
}

/**
 * Who runs the server behind the site. The network owner comes from Team
 * Cymru's public IP-to-ASN DNS service; a CDN from its response headers.
 * The registry country is where the network is registered, which is the
 * best public signal for the operator's jurisdiction, not the data centre.
 */
export async function detectHosting(
  ip: string | undefined,
  headers: Record<string, string>,
): Promise<HostingObservation> {
  const observation: HostingObservation = { type: "hosting" };
  for (const [name, pattern, provider] of cdnHeaders) {
    const value = headers[name];
    if (value !== undefined && (!pattern || pattern.test(value))) {
      observation.cdn = provider;
      break;
    }
  }
  if (!ip) return observation;
  observation.ip = ip;
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  const txt = async (name: string) =>
    (await resolver.resolveTxt(name).catch(() => []))[0]?.join("") ?? "";
  const [asn, , country] = (await txt(cymruName(ip)))
    .split("|")
    .map((part) => part.trim());
  if (!/^\d+$/.test(asn ?? "")) return observation;
  observation.asn = Number(asn);
  if (/^[A-Z]{2}$/.test(country ?? "")) observation.networkCountry = country;
  const owner = (await txt(`AS${asn}.asn.cymru.com`)).split("|")[4]?.trim();
  if (owner) observation.network = owner.slice(0, 120);
  const known = providers.find(([pattern]) => pattern.test(owner ?? ""));
  observation.host = known
    ? known[1]
    : owner
      ? {
          name: owner.replace(/^[A-Z0-9-]+ - /, "").replace(/, [A-Z]{2}$/, ""),
          country: observation.networkCountry ?? "",
        }
      : undefined;
  // A CDN that is also the network owner is one company, not two.
  const company = (provider?: Provider) =>
    provider?.name.split(" ")[0].toLowerCase();
  if (observation.cdn && company(observation.cdn) === company(observation.host))
    delete observation.cdn;
  return observation;
}
