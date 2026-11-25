import type { Browser, BrowserContext } from "playwright";
import type { Evidence } from "@datadeal/contracts";
import {
  metaCookiePolicy,
  metaSecurityHeading,
  metaSecurityQuote,
  metaSecuritySection,
} from "@datadeal/contracts/meta-cookies";

/** Meta's cookie-policy sections load when opened. The document is read in
 * its own context so its requests and storage cannot enter the visit findings. */
export async function readMetaCookiePolicy(
  browser: Browser,
  scanId: string,
): Promise<Evidence | undefined> {
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      locale: "en",
      extraHTTPHeaders: { "Accept-Language": "en" },
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    const page = await context.newPage();
    const response = await page.goto(metaCookiePolicy, {
      waitUntil: "domcontentloaded",
      timeout: 8000,
    });
    if (!response?.ok() || page.url() !== metaCookiePolicy) return;
    const link = page.getByRole("link", {
      name: metaSecurityHeading,
      exact: true,
    });
    const href = await link.getAttribute("href", { timeout: 4000 });
    if (!href || !metaSecuritySection(new URL(href, page.url()).href)) return;
    await link.click({ timeout: 3000 });
    const paragraph = page
      .getByRole("listitem")
      .filter({ hasText: /identify your browser securely/i });
    const text = (await paragraph.innerText({ timeout: 3500 }))
      .replace(/\s+/g, " ")
      .trim();
    if (
      text.length > 1600 ||
      !metaSecuritySection(page.url()) ||
      (!metaSecurityQuote(text, "sb") && !metaSecurityQuote(text, "datr"))
    )
      return;
    return {
      id: "meta-cookie-security",
      scanId,
      retrievedAt: new Date().toISOString(),
      kind: "declared_first_party",
      language: "en",
      url: page.url(),
      excerpt: text,
      observation: {
        type: "policy_section",
        topic: "purpose",
        heading: metaSecurityHeading,
      },
    };
  } catch {
    // An unavailable disclosure leaves the two observed names unclassified.
  } finally {
    await context?.close().catch(() => {});
  }
}
