import Link from "next/link";
import {
  defaultRefreshPointCost,
  defaultReportPointCost,
  flightCap,
  queueBoostCost,
} from "@datadeal/contracts/paper-plane";
import { watchCheckCost } from "@datadeal/contracts/watch-schedule";
import { developerApiPreview } from "../../lib/developer-token";
import {
  describePointPacks,
  purchasablePointPacks,
} from "../../lib/point-packs";

const points = (amount: number) => amount.toLocaleString("en") + " points";

/** How points are bought or earned and what they pay for. */
export function PointsPricing({
  earn,
  formatPrice,
}: {
  /** Earning by ads and paper-plane flights is live (sample ads only). */
  earn: boolean;
  formatPrice: (cents: number) => string;
}) {
  const config = purchasablePointPacks();
  const packs = config ? describePointPacks(config.packs) : [];
  const api = developerApiPreview ? "" : " (preview)";
  const prices = [
    ["Unlock an advanced report", defaultReportPointCost],
    ["Skip the scan queue", queueBoostCost],
    ["Recheck a watched site, per check", watchCheckCost],
    ["API: saved report" + api, defaultReportPointCost],
    ["API: new scan" + api, defaultRefreshPointCost],
  ] as const;
  return (
    <section
      aria-labelledby="points-title"
      className="mx-auto mt-6 grid w-full max-w-4xl gap-6 rounded-3xl border border-separator p-6 md:p-8"
    >
      <div className="grid gap-1">
        <h2 id="points-title" className="m-0! text-lg font-semibold">
          Points
        </h2>
        <p className="m-0! text-sm text-muted">
          Pay as you go, without a subscription. Saving sites to your Library is
          always free.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="grid content-start gap-3">
          <h3 className="m-0! text-sm font-semibold">Get points</h3>
          {packs.length ? (
            <ul className="m-0! grid list-none gap-2 p-0! text-sm">
              {packs.map((pack) => (
                <li
                  key={pack.product}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span>{points(pack.points)}</span>
                  <span className="font-semibold tabular-nums">
                    {formatPrice(pack.price)}
                    {pack.save > 0 && (
                      <span className="ml-2 text-xs font-normal text-success">
                        −{pack.save}%
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0! text-sm text-muted">
              Point packs are not available right now.
            </p>
          )}
          <p className="m-0! text-sm text-muted">
            {earn
              ? `Or earn them free: watch a short ad, then fly the paper plane for 1–${flightCap} points.`
              : `Coming soon: earn points free by watching a short ad and flying the paper plane for 1–${flightCap} points.`}
          </p>
          {packs.length > 0 && (
            <Link className="inline-link text-sm" href="/account/rewards">
              Buy points
            </Link>
          )}
        </div>
        <div className="grid content-start gap-3">
          <h3 className="m-0! text-sm font-semibold">What they cost</h3>
          <dl className="m-0! grid gap-2 text-sm">
            {prices.map(([label, cost]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3"
              >
                <dt className="text-muted">{label}</dt>
                <dd className="m-0 font-semibold tabular-nums">
                  {points(cost)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="m-0! text-xs text-muted">
            Watched sites recheck on the schedule you pick, from hourly to every
            90 days.
          </p>
        </div>
      </div>
    </section>
  );
}
