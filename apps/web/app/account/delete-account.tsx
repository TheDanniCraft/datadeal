"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteAccount({
  token,
  localOutbox,
}: {
  token?: string;
  localOutbox?: string;
}) {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button
        variant={token ? "danger" : "outline"}
        isDisabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const response = await fetch("/api/auth/delete-user", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(token ? { token } : {}),
            });
            if (!response.ok) {
              const error = await response.json().catch(() => null);
              setNotice(
                error?.code === "BILLING_CLOSURE_PENDING"
                  ? "Your account is still open. We couldn’t confirm that all subscriptions have ended. Return to your account and request a new deletion link to try again."
                  : "Could not complete the request. Sign in again or request a new link.",
              );
            } else if (token) {
              router.replace("/account");
              router.refresh();
            } else {
              setNotice(
                localOutbox
                  ? "Open the local outbox file " +
                      localOutbox +
                      " for your deletion confirmation link."
                  : "Check your inbox for a link to confirm deletion.",
              );
            }
          } catch {
            setNotice("Could not reach DataDeal. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {token ? "Permanently delete my account" : "Request account deletion"}
      </Button>
      <p role="status">{notice}</p>
    </>
  );
}
