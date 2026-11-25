import { survivalProbability } from "@datadeal/contracts/paper-plane";
export function FlightOdds() {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      <p>
        Collect before the plane lands to earn 1–1,000 report points. A missed
        flight earns 0. There’s no entry fee, and your existing points stay
        yours.
      </p>
      <details>
        <summary className="inline-link cursor-pointer">
          Flight odds and rules
        </summary>
        <div className="space-y-2 pt-2">
          <p>
            Choose an automatic target before takeoff or bank the live offer.
          </p>
          <table className="w-full max-w-xs text-left tabular-nums">
            <caption className="sr-only">
              Chance of reaching each automatic bank target
            </caption>
            <thead>
              <tr>
                <th scope="col">Target</th>
                <th scope="col">Chance to bank</th>
              </tr>
            </thead>
            <tbody>
              {[36, 50, 100, 200, 1000].map((n) => (
                <tr key={n}>
                  <td>{n.toLocaleString("en-US")} pts</td>
                  <td>{(survivalProbability(n) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            The chance of reaching target n is (200 ÷ (199 + n))². After roughly
            six seconds, surviving flights pause at 36 for up to ten seconds.
            The cap of 1,000 banks automatically. A preset target works even if
            you close the page.
          </p>
          <p>
            Points can be used only by your account for eligible DataDeal
            reports and refreshes. They have no cash value.
          </p>
        </div>
      </details>
    </div>
  );
}
