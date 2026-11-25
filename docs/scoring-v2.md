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

## Rubric (to confirm)

Start at **100**. Each row/request gets a cost; costs combine as _worst + breadth_. Sort costs descending,
then `score = 100 − c₁ − c₂·0.5 − c₃·0.25 − …` (each further cost counts half the previous weight, but at
least 0.1), floored at 0. One bad practice is never drowned out, and thirty ad partners score clearly below one.

| Practice (accept-all visit)                                                                  | Cost                      |
| -------------------------------------------------------------------------------------------- | ------------------------- |
| Essential, security, consent record, preferences, support conversation (e.g. Chatwoot)       | 0                         |
| First-party / processor analytics without a cross-site ID (e.g. self-hosted Plausible/Umami) | 3                         |
| Analytics with a persistent visitor ID (e.g. `_ga`)                                          | 10                        |
| Unknown purpose, persistent and identifier-like, after research                              | 4 (and lowers confidence) |
| Independent third party receives data (no identifier observed)                               | 8                         |
| Advertising / social cookie with a persistent identifier                                     | 15                        |
| Identifier sent to an independent advertising recipient (linked)                             | 25                        |
| Email-shaped value sent to an advertising recipient                                          | 35                        |

**Consent penalty**: any non-essential item that already appears **before the choice** or **after
reject** costs an extra **+50%** of its cost (tracking without consent, which GDPR/ePrivacy does not allow
by default).

**Confidence**: high when most rows are classified with cited reasons; lowered by unknown rows, capped
captures or a failed accept-all click. A site is **Unrated** only when the accept-all visit itself could not
be measured.

Grades unchanged: 90 Excellent · 75 Good · 60 Mixed · 40 Concerning · 20 Poor · 0 Critical.

## Examples (expected)

- Personal site with only a consent cookie and a Chatwoot conversation ID: ~100, Excellent.
- Blog with self-hosted Plausible: ~97, Excellent.
- Shop with `_ga` + Meta pixel (`_fbp` sent to facebook.com): 100 − 25 − 15·0.5 − 10·0.25 = 65, Mixed.
- Publisher with 30 ad partners receiving IDs, some before consent: well below 40.
