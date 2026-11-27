"use client";

import { Button, Form, Input } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (response?.ok) return "";
  const error = await response?.json().catch(() => null);
  if (error?.code === "insufficient") return "Not enough points.";
  return typeof error?.error === "string"
    ? error.error
    : "Could not save that. Try again.";
}

/** Save a site to the library by its domain. */
export function SaveForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <Form
      className="grid w-full gap-1 sm:w-auto"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        setBusy(true);
        const error = await send("/api/v1/account/watchlist", "POST", {
          domain: new FormData(form).get("domain"),
        });
        setBusy(false);
        setNotice(error);
        if (!error) {
          form.reset();
          router.refresh();
        }
      }}
    >
      <div className="flex gap-2">
        <Input
          name="domain"
          aria-label="Website to save"
          placeholder="example.com"
          required
          maxLength={253}
          autoCapitalize="none"
          spellCheck={false}
          className="min-w-0 flex-1 sm:w-56"
          aria-invalid={notice ? true : undefined}
          onChange={() => setNotice("")}
        />
        <Button type="submit" isDisabled={busy}>
          Save
        </Button>
      </div>
      {notice && (
        <p role="status" className="m-0 text-xs text-danger">
          {notice}
        </p>
      )}
    </Form>
  );
}

/** Remove a site from the library. */
export function RemoveSaved({ domain }: { domain: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      isDisabled={busy}
      aria-label={"Remove " + domain}
      onPress={async () => {
        setBusy(true);
        const error = await send("/api/v1/account/watchlist", "DELETE", {
          domain,
        });
        setBusy(false);
        if (!error) router.refresh();
      }}
    >
      Remove
    </Button>
  );
}

/** Save or unsave the report's site, from the report page. */
export function SaveSite({
  domain,
  saved,
}: {
  domain: string;
  saved: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className={"gap-1.5 [&_svg]:size-4" + (saved ? " text-accent" : "")}
      isDisabled={busy}
      aria-pressed={saved}
      onPress={async () => {
        setBusy(true);
        const error = await send(
          "/api/v1/account/watchlist",
          saved ? "DELETE" : "POST",
          { domain },
        );
        setBusy(false);
        if (!error) router.refresh();
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={
          saved ? "fill-current stroke-current" : "fill-none stroke-current"
        }
        strokeWidth="1.8"
        strokeLinejoin="round"
      >
        <path d="M6 3h12v18l-6-4-6 4z" />
      </svg>
      {saved ? "Saved" : "Save"}
    </Button>
  );
}
