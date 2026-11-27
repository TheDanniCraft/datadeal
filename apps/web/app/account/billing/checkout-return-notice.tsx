"use client";

import { Alert, Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  checkoutAccountPath,
  isCreditRequestId,
  proCheckoutReturnPath,
  type CheckoutKind,
  type CheckoutReceipt,
} from "../../../lib/checkout-return";

const delays = [1500, 3000, 5000, 8000, 12000];

export function CheckoutReturnNotice({
  kind,
  reference,
  receipt,
  credits,
  points,
}: {
  kind: CheckoutKind;
  reference: string | null;
  receipt: CheckoutReceipt;
  credits?: number | null;
  /** A point pack: the points it added (shown instead of credits). */
  points?: number | null;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (receipt !== "pending") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempt = 0;
    const key =
      kind === "subscription"
        ? reference?.startsWith("sub_")
          ? "subscription_id"
          : "pro_receipt"
        : isCreditRequestId(reference)
          ? "request_id"
          : "order_id";
    const query = reference ? key + "=" + reference : "checkout=pro";
    async function check() {
      try {
        const result = await fetch("/api/v1/billing/return-status?" + query, {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(6000),
          ]),
        });
        if (controller.signal.aborted) return;
        if (result.status === 401) {
          const target = reference
            ? checkoutAccountPath(kind, reference)
            : proCheckoutReturnPath;
          router.replace("/account?returnTo=" + encodeURIComponent(target));
          return;
        }
        if (result.ok) {
          const { status } = await result.json();
          if (
            [
              "confirmed",
              "refunded",
              "inactive",
              "account_subscription",
            ].includes(status)
          ) {
            router.refresh();
            return;
          }
        }
      } catch {
        // A delayed or interrupted check leaves the receipt unconfirmed.
      }
      if (controller.signal.aborted) return;
      if (cycle || attempt >= delays.length) setPaused(true);
      else timer = setTimeout(check, delays[attempt++]);
    }
    timer = setTimeout(check, cycle ? 0 : delays[attempt++]);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [kind, reference, receipt, router, cycle]);

  const subscription = kind === "subscription";
  const title =
    receipt === "pending"
      ? "Waiting for checkout confirmation"
      : receipt === "refunded"
        ? points != null
          ? "Point pack refunded"
          : "Credit pack refunded"
        : receipt === "inactive"
          ? "This subscription is inactive"
          : subscription
            ? "Pro subscription confirmed"
            : points != null
              ? "Points added"
              : "Credit pack added";
  return (
    <Alert
      className="w-full"
      role="status"
      status={receipt === "confirmed" ? "success" : "default"}
    >
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {points != null &&
          (receipt === "confirmed" || receipt === "refunded") && (
            <Alert.Description>
              {receipt === "confirmed"
                ? `${points.toLocaleString("en")} points added to your balance.`
                : "The pack’s points were removed from your balance, as far as they were still available."}
            </Alert.Description>
          )}
        {points == null &&
          credits != null &&
          (receipt === "confirmed" || receipt === "refunded") && (
            <Alert.Description>
              {credits.toLocaleString("en")}{" "}
              {credits === 1 ? "API credit" : "API credits"}{" "}
              {receipt === "confirmed" ? "added to" : "removed from"} your
              wallet.
            </Alert.Description>
          )}
        {receipt === "pending" && (
          <Alert.Description>
            {subscription ? "Pro access" : "Your purchase"} will appear once
            DataDeal receives confirmation from Creem. You can leave this page.
            Please keep your receipt and avoid a second purchase.
            {paused ? (
              <Button
                className="mt-2 flex"
                size="sm"
                variant="secondary"
                onPress={() => {
                  setPaused(false);
                  setCycle(cycle + 1);
                }}
              >
                Check again
              </Button>
            ) : (
              " Checking automatically…"
            )}
          </Alert.Description>
        )}
      </Alert.Content>
    </Alert>
  );
}
