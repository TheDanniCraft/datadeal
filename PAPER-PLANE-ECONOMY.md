# Paper-plane rewards

## What one ad buys

**Guests.** “Watch one ad to unlock the advanced report for this domain for 24 hours.” Open the report as soon as completion is verified, in the same guest browser, without registration. The window starts at grant and includes later published scans of that domain. Offer the ad only when advanced data and eligible inventory exist. The free report remains available after a decline or no fill. Domain access can be exercised locally with Google's development sample. Production settlement requires an authenticated provider receipt bound to the pending offer and guest.

**Local account reward experiment.** The main “Watch an ad to unlock” action opens the report immediately on completion. A secondary reward option lets a guest defer redemption. Show the guaranteed unlock, the account requirement for a flight, its odds and its possible zero payout before opt-in. On completion, show “Open report for 24 hours” as the primary action and “Create an account to try a flight” as the secondary action on the same screen. Keep the guaranteed claim available if signup is cancelled. Redeem the claim atomically for exactly one benefit. Once the guest report is open, a dismissible invitation can say “Want a chance at more? Create an account to try a flight with your next eligible ad.” Ignoring it leaves the open report and its expiry alone. Each ad has one promised reward: direct access, account points, a flight, or one explicitly offered choice ticket. A signed-in visitor chooses between the domain unlock and **one flight for 0–500 points**; there is no flat-points option, because 50 points would only buy the same unlock. Signed-in visitors can also earn flights without a report on the points page (Account → Get more points): each fully watched ad gives exactly one flight, and a closed or failed ad gives nothing. Unlocks and refreshes cost **150 points**: a flight averages about 125 points when collected near 250, so one flight buys a little less than one report. A flight chosen after an ad but not flown waits on the points page as a free flight; an unclaimed choice is not kept. Choosing a flight uses that ad's entire reward, including when the payout is zero. Earnings from previous flights remain in the wallet. There is no entry fee or stake. The local worker and website support flight settlement and the points wallet with development sample ads. Production issuance remains disabled.

**Current prices.** Points are DataDeal's only currency (`packages/contracts/paper-plane.ts`, `watch-schedule.ts`): a report unlock costs **150**, a rescan **150** (kept for refunds; the paid rescan is not offered in the UI), skipping the scan queue **225**, each recheck of a watched site **135** (schedule from hourly to every 90 days, or a cron), and Developer API requests **150** per saved report or new scan. Point packs sell **10,000 for €5, 25,000 for €11 and 50,000 for €20** (€0.50, €0.44 and €0.40 per 1,000 points). An existing entitlement, unavailable advanced report or in-progress scan incurs no new debit. A charged scan that ends in terminal failure is refunded exactly once, keyed to the original debit. Pro (€3.99 a month, €34.99 a year) is ad-free, opens every advanced report, includes 2 watched sites with weekly email alerts and 5 free skip-the-line scans a month, and includes no points.

The proposed volunteer pilot would award points per verified contribution; its amount needs re-pricing against the 150-point unlock before launch. Earnings from voluntary studies and account ad rewards could be spent from the same points balance. [Volunteer browser measurements](./VOLUNTEER-MEASUREMENTS.md)

## What the handoff can tell us

The three selected flights ended at **3, 93 and 236**. The median endpoint was **93**, while the amounts actually banked were **0, 90 and 81**, with a median payout of **81**. The original rewards were seconds removed from a wait. For scale, a DataDeal flight paying 81 points covers about half of a 150-point unlock. Three selected examples cannot predict a typical DataDeal payout. A separate mention of 31 in the handoff has no confirmed outcome type. The earlier uniform model had 360 losing thresholds plus one cap win. Under that assumption collecting at 90 succeeds on 271/361 draws and yields about 67.6 units per attempt. It was a hypothetical pilot, and its three-attempt variant changes those odds again.

The timing CSV supports an accelerating offer of approximately `exp(0.59085 × active flight seconds)`. The recording pauses at 36; DataDeal pauses once at the **50**-point checkpoint. After taking 81 the player sees the receipt immediately while the animation continues to 236. Preserve those distinct banked and final amounts. For DataDeal display points, keep a single draw through pauses, and allow an automatic bank target before launch for keyboard, mobile and reduced-motion users.

## Local development balance

Use a single continuous offer with a maximum of **500** points. The hidden end point is uniform, so a flight is still in the air at integer `n` with probability `1 − (n − 1) / 500`: failing before 20 happens about 4% of the time, before 50 about 10%, and the 500 cap is reached (and auto-banked) once in 500 flights. The median maximum is 250.

| Choice                   | Active seconds | Chance to bank | Unlocks (150) on success | Mean points per ad |
| ------------------------ | -------------: | -------------: | -----------------------: | -----------------: |
| Collect 50 at checkpoint |           6.62 |          90.2% |                        0 |               45.1 |
| Collect 100              |           7.79 |          80.2% |                        0 |               80.2 |
| Collect 150              |           8.48 |          70.2% |                        1 |              105.3 |
| Collect 250              |           9.34 |          50.2% |                        1 |              125.5 |
| Collect 300              |           9.65 |          40.2% |                        2 |              120.6 |
| Collect 400              |          10.14 |          20.2% |                        2 |               80.8 |
| Reach cap of 500         |          10.52 |           0.2% |                        3 |                1.0 |

**Example.** A player who wants one unlock from a single flight banks at 150 and succeeds about 70 times in 100. Continuing and missing adds zero. Previous earnings are always retained.

**Endpoint.** The server draws one uniform `u` in (0, 1) and sets the endpoint `T = 1 + 500 × (1 − u)` (`drawFlightEndpoint`). A target succeeds strictly before T; reaching 500 auto-banks the cap. No collect can exceed the floored live offer. The server uses cryptographic randomness and an authoritative clock. These odds assume no endpoint clues and exclude manual timing and network delay. The timing beyond the recorded endpoint is extrapolated.

## Cost and limits

The largest expected payout of any fixed target is **125.5 points** per completed ad, at 250 (`n × (1 − (n − 1) / 500)`). The maximum liability on a single flight is 500 points. Do not lower published odds, confiscate balances or assume an arbitrary cap on ads to make the economics balance.

Measure net publisher revenue per verified completion, including no-fill and unearned traffic. Measure scan cost (browser pages and consent scenarios, proxy traffic, model tokens, failed attempts, storage) and cached unlock cost separately. To keep an illustrative 30% reserve on ad-earned points, require:

    125.5 × [q × scan cost / 135 + (1 − q) × cached unlock cost / 150] ≤ 0.70 × net revenue per completion

Here `q` is the share of earned points spent on scans (rechecks at 135; a 225-point queue skip adds priority, not a scan). The formula budgets full redemption at the highest expected issuance.

**Illustration, using assumed and unverified prices.** At €0.010 net per completion, €0.025 per scan and €0.0003 per cached unlock, about 29% of earned points can fund scans. If everyone spends on rechecks, the same reserve needs roughly €0.033 net per completion. No live ad revenue, fill rate or scan cost has been verified, which is one reason earning points from ads stays development-only.

**Packs and Pro, same assumptions.** 1,000 bought points sell for €0.40–€0.50 before payment provider fees (not verified) and buy about 7.4 rechecks, about €0.19 of assumed scan cost, or 6.7 cached unlocks at negligible cost. Pro's 2 weekly watched sites are about 8.7 checks a month, about €0.22 of assumed scan cost, against €3.99 a month (€2.92 billed yearly). Recalculate when scans add pages or scenarios.

## Reward delivery

Before each ad, identify the exact selected action, the beneficiary and the time window. For a flight offer, use copy such as “Complete one ad for one flight. Collect before it ends to earn 1–500 points. A missed flight earns 0.” Link the full odds formula and examples, with the guaranteed option equally accessible before opt-in. Keep the normal free visit usable after a decline or skipped ad. Rewards remain usable only by the earning visitor inside DataDeal. They have no transfer, cash, resale or subscription conversion. Google's rules permit conditional random rewards with prior disclosure of all possible outcomes including zero. This design proposal does not establish publisher approval. [Google rewarded-ad policies](https://support.google.com/adsense/answer/9121589?hl=en)

Bind the selected offer and its terms to one server-side ad intent. Verify completion, issue exactly one entitlement or flight ticket, and bank once even across reconnects or multiple tabs. The promised flight can be resumed if the page closes after a grant. After launch, a disconnect does not redraw the endpoint. Preselected targets settle on the server. Report unavailable inventory before offering a reward. Keep production settlement gated on verifying authentic callbacks, completion IDs and recipient binding in the configured web inventory. [Google Ad Manager rewarded web setup](https://support.google.com/admanager/answer/9116812?hl=en)
