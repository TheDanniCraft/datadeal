# Scoring v2: investigate the ingredients

Status: approved and implemented (25 Nov 2026); live-scan verification pending. Methodology stays 1.x; rules revision `contextual-practices-6`.

## Why

Two sites that both "exist, have a policy and mention advertising" must not get the same score. The current
revision rates a site by its single worst substantiated practice, and the collector throws away the name of
every cookie it does not already know (bild.de: 34 of 37 cookies reached the AI as an anonymous count). The AI
therefore cannot tell a Chatwoot conversation cookie from an advertising ID.

## Pipeline

1. **Collect** (Playwright worker today, volunteer extension later). Fresh browser, three scenarios:
   before choice, after reject, after accept all. Every cookie and storage key is kept by **masked name** with
   a **value description** (length class, shape such as flag/number/uuid/hex, `identifierLike`). Values never
   leave the worker. Requests keep destination, phase, initiator and field categories as today.
2. **Inventory**. One row per unique item: mechanism, masked name, owning site, first-/third-party scope,
   lifetime/expiry, value description, phases where it was present, and whether its value was later seen in a
   request to another domain (identifier linkage).
3. **Classify** (Claude, one request). For each row: purpose (`essential` · `security` · `consent` ·
   `preferences` · `support` · `analytics` · `advertising` · `personalization` · `social` · `unknown`), who
   controls the data (`first_party` · `processor` · `independent` · `unknown`), vendor if known, confidence,
   one-sentence reason. Claude may ask for **research** on a vendor domain that was actually observed in the
   scan (never an arbitrary URL).
4. **Research** (bounded: max 3 vendor domains per scan). The worker fetches that vendor's privacy/cookie
   pages with the existing SSRF-safe fetcher and Claude re-classifies the still-unknown rows, citing the
   vendor's text.
5. **Score** with deterministic rules (below). Claude never sets numbers.

## Headline

Always the **Accept all** visit, for every site (the typical visitor's choice). Before-choice and reject
results stay visible as comparisons.

## Rubric (revision `contextual-practices-7`)

Each classified row or request gets a cost (table below). The score is built in three steps:

1. **Worst practice** counts in full.
2. **Breadth**: everything else adds `6 × log2(1 + sum_of_other_costs / 10)`, capped at **30**. More trackers
   are worse, each extra one matters less, and count alone cannot push a site to zero.
3. **Coverage**: `score = 50 + (raw − 50) × coverage`. A scan that saw less cannot claim a perfect or a
   hopeless result. Coverage multiplies: reject choice untested ×0.93; homepage only ×0.90, one sampled page
   ×0.94, two or more ×0.97; features named in the policy not tried ×0.97; capture limits hit ×0.95;
   unknown items ×(1 − 0.3 × unknown share). The report states the coverage and why.

Rows the policy names for a feature the visitor chooses (booking, chat; phase `on_use`) are listed as
"When you use a feature" and cost 1 for a contracted service, or half the normal cost if they track.
Same-site requests carrying a known vendor event (e.g. a Plausible proxy) count as that vendor.

| Practice (accept-all visit)                                                                | Cost                    |
| ------------------------------------------------------------------------------------------ | ----------------------- |
| Essential, security, consent record, preferences, support conversation                     | 0                       |
| First-party / processor analytics without a cross-site ID (e.g. Plausible, also via proxy) | 3                       |
| Unknown purpose, persistent and identifier-like, after research                            | 4 (and lowers coverage) |
| Independent third party receives data (no identifier observed)                             | 8                       |
| Analytics with a persistent visitor ID (e.g. `_ga`)                                        | 10                      |
| Advertising / social cookie with a persistent identifier                                   | 15                      |
| Identifier sent to an independent advertising recipient (linked)                           | 25                      |
| Email-shaped value sent to an advertising recipient                                        | 35                      |

**Consent penalty**: a non-essential item already present before the choice or after reject costs +50%.

Grades unchanged: 90 Excellent · 75 Good · 60 Mixed · 40 Concerning · 20 Poor · 0 Critical.

## Examples (expected)

- Personal site with only a consent cookie and a Chatwoot conversation ID: ~100, Excellent.
- Blog with self-hosted Plausible: ~97, Excellent.
- Shop with `_ga` + Meta pixel (`_fbp` sent to facebook.com): 100 − 25 − 15·0.5 − 10·0.25 = 65, Mixed.
- Publisher with 30 ad partners receiving IDs, some before consent: well below 40.
