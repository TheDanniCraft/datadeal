"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AlertPreference({
  domain,
  enabled,
}: {
  domain: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        aria-label={"Watchlist alerts for " + domain}
        aria-pressed={enabled}
        isDisabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const response = await fetch("/api/v1/account/alerts", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ domain, enabled: !enabled }),
            });
            if (!response.ok) throw new Error("Update failed");
            setNotice(!enabled ? "Alerts enabled." : "Alerts muted.");
            router.refresh();
          } catch {
            setNotice("Could not update alerts.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {enabled ? "Alerts on" : "Alerts off"}
      </Button>
      {notice && <span role="status"> {notice}</span>}
    </>
  );
}
