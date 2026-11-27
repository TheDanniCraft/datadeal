"use client";

import { Button } from "@heroui/react";
import { useState } from "react";
import { proPlansPath } from "../../../lib/checkout-return";

function useCheckout() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function checkout(plan: "monthly" | "yearly") {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (response.status === 401) {
        window.location.assign(
          "/account?returnTo=" + encodeURIComponent(proPlansPath),
        );
        return;
      }
      if (response.status === 409) {
        window.location.assign("/account/billing");
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
  return { busy, notice, checkout };
}

export function CheckoutButtons({
  monthly,
  yearly,
  yearlyBestValue,
}: {
  monthly: string;
  yearly: string;
  yearlyBestValue: boolean;
}) {
  const { busy, notice, checkout } = useCheckout();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        onPress={() => void checkout("monthly")}
        isDisabled={busy}
      >
        {monthly} monthly
      </Button>
      <Button
        variant="primary"
        onPress={() => void checkout("yearly")}
        isDisabled={busy}
      >
        {yearly} yearly{yearlyBestValue && " · Best value"}
      </Button>
      <p
        role="status"
        className="m-0 basis-full text-sm text-danger empty:hidden"
      >
        {notice}
      </p>
    </div>
  );
}
