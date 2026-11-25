"use client";

import { Button, Form, Input, Label } from "@heroui/react";
import Link from "next/link";
import { AccountEmpty } from "../account-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function Watchlist({
  domains,
  canSave,
}: {
  domains: string[];
  canSave: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [invalid, setInvalid] = useState(false);
  async function change(
    method: "POST" | "DELETE",
    domain: FormDataEntryValue | null,
  ) {
    if (busy) return false;
    setBusy(true);
    try {
      const response = await fetch("/api/v1/account/watchlist", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      if (!response.ok) {
        setInvalid(method === "POST" && response.status === 400);
        const error = await response.json().catch(() => null);
        setNotice(
          typeof error?.error === "string"
            ? error.error
            : "Could not update your watchlist.",
        );
        return false;
      }
      setInvalid(false);
      setNotice(method === "POST" ? "Website saved." : "Website removed.");
      router.refresh();
      return true;
    } catch {
      setNotice("Could not reach DataDeal. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {canSave && (
        <Form
          className="grid max-w-lg gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            if (await change("POST", new FormData(form).get("domain")))
              form.reset();
          }}
        >
          <Label htmlFor="watchlist-domain">Website domain</Label>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              id="watchlist-domain"
              name="domain"
              placeholder="example.com"
              required
              maxLength={253}
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? "watchlist-status" : undefined}
              onChange={() => {
                if (!invalid) return;
                setInvalid(false);
                setNotice("");
              }}
            />
            <Button type="submit" variant="primary" isDisabled={busy}>
              Save website
            </Button>
          </div>
        </Form>
      )}
      <p id="watchlist-status" role="status">
        {notice}
      </p>
      {domains.length ? (
        <ul className="divide-y divide-separator [&>li]:space-y-2 [&>li]:py-4">
          {domains.map((domain) => (
            <li key={domain}>
              <Link
                className="text-accent underline underline-offset-2"
                href={"/report/" + domain}
              >
                {domain}
              </Link>{" "}
              <Button
                size="sm"
                variant="ghost"
                isDisabled={busy}
                aria-label={"Remove " + domain}
                onPress={() => void change("DELETE", domain)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <AccountEmpty symbol="watchlist" title="No saved websites yet.">
          Your saved domains and their latest reports will appear here.
        </AccountEmpty>
      )}
    </>
  );
}
