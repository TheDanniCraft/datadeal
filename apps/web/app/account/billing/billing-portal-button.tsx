"use client";

import { Button } from "@heroui/react";
import { useState } from "react";

export function BillingPortalButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <Button
        variant="outline"
        isDisabled={busy}
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await fetch("/api/v1/billing/portal", {
              method: "POST",
            });
            if (result.status === 401) {
              window.location.assign("/account?returnTo=%2Faccount%2Fbilling");
              return;
            }
            if (!result.ok) throw new Error("Portal unavailable");
            const { url } = (await result.json()) as { url: string };
            window.location.assign(url);
          } catch {
            setError("The billing portal is unavailable. Try again later.");
            setBusy(false);
          }
        }}
      >
        Manage subscription
      </Button>
      {error && <p role="status">{error}</p>}
    </>
  );
}
