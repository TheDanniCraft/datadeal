import { ConsentDialog, ConsentDialogLink } from "@c15t/nextjs";
import { headers } from "next/headers";
import { ConsentBoundary, ConsentPrompt } from "./consent-prompt";
import { AudienceMeasurement } from "./audience-measurement";
import { umamiConfig } from "../lib/umami";
import { limitedDisplayUnit } from "../lib/ads/inventory";
import { adsensePublisher } from "../lib/ads/adsense";
import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { brand } from "@datadeal/config";
import { SiteNavigation } from "./site-navigation";
import { ScanToastProvider } from "./report/[domain]/request-scan";
import "./globals.css";

const inter = localFont({
  src: "./fonts/Inter.ttf",
  weight: "100 900",
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: brand.name, template: "%s · DataDeal" },
  description: brand.tagline,
  other: { "google-adsense-account": `ca-${adsensePublisher}` },
};

export default async function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const hasLimitedUnit = Boolean(limitedDisplayUnit());
  const measurement = umamiConfig();
  return (
    <html
      lang="en"
      className={inter.variable}
      data-theme="mouve-light"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "var dataDealColorScheme=window.matchMedia('(prefers-color-scheme: dark)');function dataDealTheme(){document.documentElement.dataset.theme=dataDealColorScheme.matches?'mouve-dark':'mouve-light'}dataDealTheme();dataDealColorScheme.addEventListener('change',dataDealTheme);",
          }}
        />
      </head>
      <body>
        <ConsentBoundary
          headerGpc={(await headers()).get("sec-gpc") === "1"}
          hasLimitedUnit={hasLimitedUnit}
        >
          {measurement && <AudienceMeasurement {...measurement} />}
          <a
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3"
            href="#main"
          >
            Skip to content
          </a>
          <header className="border-b border-border bg-surface">
            <div className="mx-auto flex min-h-18 max-w-[68.5rem] items-center justify-between gap-3 px-5">
              <Link
                className="inline-flex items-center gap-2.5 text-xl font-bold tracking-tight"
                href="/"
              >
                <span
                  className="grid size-8 place-items-center rounded-xl bg-accent font-extrabold text-accent-foreground"
                  aria-hidden="true"
                >
                  D
                </span>
                DataDeal
              </Link>
              <SiteNavigation />
            </div>
          </header>
          <main id="main" className="mx-auto min-h-[69vh] max-w-[68.5rem] px-5">
            {children}
          </main>
          <footer className="mx-auto flex max-w-[68.5rem] flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-5 py-8 text-sm text-muted [&_a]:py-1 hover:[&_a]:underline">
            <Link href="/">DataDeal</Link>
            <Link href="/developers">API docs</Link>
            <Link href="/data-flow">Data flow</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/advertising-disclosure">Advertising disclosure</Link>
            <Link href="/terms">Terms</Link>
            <ConsentDialogLink>Privacy settings</ConsentDialogLink>
          </footer>
          <ConsentPrompt hasLimitedUnit={hasLimitedUnit} />
          <ConsentDialog hideBranding />
          <ScanToastProvider />
        </ConsentBoundary>
      </body>
    </html>
  );
}
