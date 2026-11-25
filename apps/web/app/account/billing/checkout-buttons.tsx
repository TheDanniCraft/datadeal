"use client";

import { Button } from "@heroui/react";
import { useState } from "react";
import { proPlansPath } from "../../../lib/checkout-return";

function useCheckout() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function checkout(plan: "monthly" | "yearly" | "api-credits") {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const target =
        plan === "api-credits" ? "/account/developer" : "/account/billing";
      if (response.status === 401) {
        window.location.assign(
          "/account?returnTo=" +
            encodeURIComponent(plan === "api-credits" ? target : proPlansPath),
        );
        return;
      }
      if (response.status === 409 && plan !== "api-credits") {
        window.location.assign(target);
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
      <p role="status" className="basis-full empty:hidden">
        {notice}
      </p>
    </div>
  );
}

export function CreditPackCheckout({
  credits,
  price,
}: {
  credits: number;
  price: string;
}) {
  const { busy, notice, checkout } = useCheckout();
  return (
    <>
      <Button
        variant="secondary"
        onPress={() => void checkout("api-credits")}
        isDisabled={busy}
      >
        Buy {credits} test credits for {price}
      </Button>
      <p role="status">{notice}</p>
    </>
  );
}
