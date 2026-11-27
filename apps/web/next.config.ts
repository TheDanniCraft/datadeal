import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  distDir:
    process.env.DATADEAL_BROWSER_TEST === "true"
      ? `.next-review/e2e${process.env.DATADEAL_BROWSER_TEST_RUNNER ? `-${process.env.DATADEAL_BROWSER_TEST_RUNNER}` : ""}`
      : ".next",
  ...(process.env.DATADEAL_STANDALONE === "true" && {
    output: "standalone",
    outputFileTracingRoot: resolve(__dirname, "../.."),
  }),
  transpilePackages: [
    "@datadeal/contracts",
    "@datadeal/database",
    "@datadeal/scoring",
    "@datadeal/config",
    "@datadeal/ui",
  ],
  poweredByHeader: false,
  devIndicators: false,
  webpack(config, { webpack, isServer, dev }) {
    if (!isServer && !dev)
      config.plugins.push(require("./scripts/client-notices.cjs"));
    // HeroUI Pro beta.11's TextShimmer uses custom merge groups. In
    // tailwind-variants 4 these live in the package's config entry.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^tailwind-variants$/,
        (resource: { context: string; request: string }) => {
          if (
            /[\\/]@heroui-pro[\\/]react[\\/]dist[\\/]components[\\/]text-shimmer$/.test(
              resource.context,
            )
          )
            resource.request = "tailwind-variants/config";
        },
      ),
    );
    return config;
  },
  agentRules: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // No script/frame/connect/img allowlist on purpose: AdSense, Google's
          // consent message and ad creatives load from many Google hosts,
          // including country domains (adservice.google.<tld>). Google advises
          // against allowlist CSPs for AdSense; a nonce-based strict-dynamic
          // policy is the supported alternative if fetch directives are added.
          {
            key: "Content-Security-Policy",
            value:
              "object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
