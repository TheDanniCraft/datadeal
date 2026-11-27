"use client";

import { Button, Modal, Spinner } from "@heroui/react";
import { useState } from "react";
import type { PointPackOffer } from "../../../lib/point-packs";

const euro = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
});
const count = new Intl.NumberFormat("en");

/** Buy a test-mode point pack: pick an amount, then one checkout button. */
export function BuyPoints({
  packs,
  returnTo,
}: {
  packs: PointPackOffer[];
  /** Where a signed-out buyer comes back to. */
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(
    packs[Math.min(1, packs.length - 1)]?.product,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const pack = packs.find((item) => item.product === selected);

  async function checkout() {
    if (!pack) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "points", pack: pack.product }),
      });
      if (response.status === 401) {
        window.location.assign(
          "/account?returnTo=" + encodeURIComponent(returnTo),
        );
        return;
      }
      if (!response.ok) throw new Error("Checkout unavailable");
      const { url } = (await response.json()) as { url: string };
      window.location.assign(url);
    } catch {
      setNotice("Checkout is unavailable. Try again later.");
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onPress={() => setOpen(true)}>
        Buy points
      </Button>
      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container size="md">
          <Modal.Dialog className="min-w-0">
            <Modal.CloseTrigger aria-label="Close" />
            <Modal.Header>
              <Modal.Heading>Buy points</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="grid gap-4 text-sm">
              <p className="m-0 text-muted">
                Points open reports, skip the scan line, keep sites updated and
                pay for Developer API requests. Packs are a one-time test-mode
                payment.
              </p>
              <div
                role="radiogroup"
                aria-label="Point pack"
                className="grid gap-2"
              >
                {packs.map((item) => {
                  const checked = item.product === selected;
                  return (
                    <button
                      key={item.product}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => setSelected(item.product)}
                      className={
                        "grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-focus " +
                        (checked
                          ? "border-accent bg-accent/10"
                          : "border-separator hover:bg-default/60")
                      }
                    >
                      <span className="text-base font-semibold tabular-nums">
                        {count.format(item.points)} points
                      </span>
                      <span className="text-base font-semibold tabular-nums">
                        {euro.format(item.price / 100)}
                      </span>
                      <span className="text-xs text-muted tabular-nums">
                        {euro.format(item.perThousand / 100)} per 1,000 points
                      </span>
                      <span
                        className={
                          "text-xs font-medium " +
                          (item.save > 0 ? "text-success" : "text-muted")
                        }
                      >
                        {item.save > 0
                          ? `Save ${item.save}%`
                          : packs.length > 1
                            ? "Base price"
                            : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="grid">
                <Button
                  className="gap-2"
                  isDisabled={busy || !pack}
                  onPress={() => void checkout()}
                >
                  {busy && (
                    <Spinner size="sm" color="current" aria-hidden="true" />
                  )}
                  {pack
                    ? `Buy ${count.format(pack.points)} points for ${euro.format(pack.price / 100)}`
                    : "Choose a pack"}
                </Button>
              </div>
              {notice && (
                <p role="status" className="m-0 text-xs text-danger">
                  {notice}
                </p>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
