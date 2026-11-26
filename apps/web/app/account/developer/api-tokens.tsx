"use client";

import { Button, Form, Input, Label } from "@heroui/react";
import type { ApiTokenRecord } from "@datadeal/database";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocalDate } from "../../../lib/local-date";

export function ApiTokens({
  records,
  scansEnabled,
}: {
  records: ApiTokenRecord[];
  scansEnabled: boolean;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function update(
    method: "POST" | "PATCH" | "DELETE",
    body: { label: string; scope: ApiTokenRecord["scope"] } | { id: string },
  ) {
    setBusy(true);
    setToken("");
    setNotice("");
    try {
      const result = await fetch("/api/v1/account/api-tokens", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (result.status === 409 && method === "POST") {
        setNotice("Revoke an active token before creating another.");
        return;
      }
      if (!result.ok) throw new Error("Token change failed");
      if (method === "DELETE") setNotice("Token revoked.");
      else {
        const data: { token: string } = await result.json();
        setToken(data.token);
        setNotice(
          method === "POST"
            ? "Token created."
            : "Token rotated. The previous token no longer works.",
        );
      }
      router.refresh();
    } catch {
      setNotice("The token change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">
          Create an API token
        </h2>
        <p>
          Give each integration its own token so you can rotate or revoke access
          individually.
        </p>
        <Form
          className="grid max-w-md gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const submitter = (event.nativeEvent as SubmitEvent).submitter;
            const scope =
              submitter?.getAttribute("value") === "scans:request"
                ? "scans:request"
                : "reports:read";
            void update("POST", {
              label: String(form.get("label") ?? ""),
              scope,
            });
          }}
        >
          <Label htmlFor="developer-token-label">Token name</Label>
          <Input
            id="developer-token-label"
            name="label"
            maxLength={64}
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" isDisabled={busy}>
              Create token
            </Button>
            {scansEnabled && (
              <Button
                type="submit"
                value="scans:request"
                variant="secondary"
                isDisabled={busy}
              >
                Create scan token
              </Button>
            )}
          </div>
        </Form>
      </section>
      <p role="status">{notice}</p>
      {token && (
        <section className="space-y-3" aria-label="New API token">
          <h2 className="text-xl font-semibold tracking-tight">
            Copy your token now
          </h2>
          <p>DataDeal only shows the full token once.</p>
          <Input aria-label="New API token" value={token} readOnly />
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">API tokens</h2>
        {records.length ? (
          <ul className="divide-y divide-separator [&>li]:space-y-2 [&>li]:py-4">
            {records.map((item) => (
              <li key={item.id}>
                <strong>{item.label}</strong> · {item.scope}
                <p className="text-sm text-muted">
                  Created <LocalDate value={item.createdAt} />
                  {item.lastUsedAt && (
                    <>
                      {" "}
                      · Last used <LocalDate value={item.lastUsedAt} />
                    </>
                  )}
                </p>
                {item.revokedAt ? (
                  <p>Revoked</p>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      isDisabled={busy}
                      aria-label={"Rotate " + item.label}
                      onPress={() => void update("PATCH", { id: item.id })}
                    >
                      Rotate
                    </Button>{" "}
                    <Button
                      size="sm"
                      variant="ghost"
                      isDisabled={busy}
                      aria-label={"Revoke " + item.label}
                      onPress={() => void update("DELETE", { id: item.id })}
                    >
                      Revoke
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>No API tokens yet.</p>
        )}
      </section>
    </>
  );
}
