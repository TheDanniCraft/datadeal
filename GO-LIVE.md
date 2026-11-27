# Go-live checklist

What is left between the current `master` and DataDeal running on
`https://datadeal.app`. Everything in the code is done; these are the
account and hosting steps.

## 1. Cloudflare

- [ ] Point `datadeal.app` (and `www`, redirecting to the apex) at the Coolify
      server. Proxy on is fine; SSL mode **Full (strict)**.
- [ ] Do not let Cloudflare rewrite or minify HTML/JS (Rocket Loader off):
      it breaks the AdSense tag and Next.js hydration.

## 2. Coolify

Deploy `compose.yaml` from `TheDanniCraft/datadeal` (`master`). Build secret:
`HEROUI_AUTH_TOKEN` (HeroUI Pro installer).

Required environment:

| Variable                                                     | Value                                |
| ------------------------------------------------------------ | ------------------------------------ |
| `APP_ORIGIN`                                                 | `https://datadeal.app`               |
| `BETTER_AUTH_SECRET`                                         | 32+ random characters                |
| `DATADEAL_SCAN_LIMIT_SECRET`                                 | 32+ random characters                |
| `DATADEAL_DB_PASSWORD` / `DATADEAL_DB_ADMIN_PASSWORD`        | strong, different                    |
| `ANTHROPIC_API_KEY`                                          | Claude API key (worker)              |
| `DATADEAL_MAIL_MODE`, `DATADEAL_MAIL_FROM`, `RESEND_API_KEY` | sign-in links and watch alert emails |
| `DATADEAL_OPERATOR_NAME`, `DATADEAL_PRIVACY_EMAIL`           | legal pages                          |
| `DATADEAL_TRUSTED_CLIENT_IP_HEADER`                          | `CF-Connecting-IP` behind Cloudflare |

Billing (Creem, **live** mode):

- [ ] In Creem switch to live and create the same products as in test mode:
      Pro Monthly €3.99, Pro Yearly €34.99, point packs 10,000 / €5,
      25,000 / €11, 50,000 / €20 (EUR, tax included, digital goods,
      abandoned-cart emails off).
- [ ] Live webhook → `https://datadeal.app/api/v1/billing/creem` with
      `checkout.completed`, `refund.created` and the `subscription.*` events.
- [ ] `CREEM_MODE=live`, `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`,
      `CREEM_MONTHLY_PRODUCT`, `CREEM_YEARLY_PRODUCT`,
      `CREEM_POINT_PACKS=10000:500:<id>,25000:1100:<id>,50000:2000:<id>`.

Features:

- `DATADEAL_POINTS=true` turns on points (balance, buying packs, unlocks,
  watching, skipping the queue). Earning points with ads stays off until
  rewarded ads exist (see 4).
- `DATADEAL_DEVELOPER_API_PREVIEW=true` opens the paid API (optional).
- `DATADEAL_UMAMI_ORIGIN`, `DATADEAL_UMAMI_WEBSITE_ID` for cookieless analytics.
- `DATADEAL_EXTENSION_URL` once the extension is in the stores.

## 3. Google AdSense

- [ ] Websites → datadeal.app → request review once the site is live. The
      `google-adsense-account` meta tag and `/ads.txt` are already served.
- [ ] Privacy & messaging → European regulations → message
      **"DataDeal EU consent"** (draft, already created for datadeal.app):
  - turn on the **Do not consent** button,
  - Websites → datadeal.app → site name `DataDeal`, privacy policy
    `https://datadeal.app/privacy`,
  - publish it once the site is live.
- [ ] Optionally publish the US state regulations message.
- [ ] After approval: create two display ad units (responsive banner, vertical
      rail) and set `DATADEAL_ADSENSE=true`,
      `DATADEAL_ADSENSE_SLOT_BANNER=<id>`, `DATADEAL_ADSENSE_SLOT_RAIL=<id>`.
      Leave Auto ads off.

How consent works: the AdSense tag loads Google's certified consent message
(IAB TCF) for non-Pro visitors; "Privacy settings" in the footer reopens it.
Pro visitors load no Google script. Umami is cookieless and skips GPC/DNT.

## 4. Later

- **Rewarded ads (earn points by watching ads, paper-plane flights)** need a
  Google Ad Manager account with a rewarded web ad unit and server-side
  verification of completed views. Until then earning is shown as
  "coming soon"; buying packs works.
- Extension store listings (Chrome Web Store, Firefox Add-ons).
