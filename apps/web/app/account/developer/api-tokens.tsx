"use client";

import { Button, Chip, Form, Input, Label } from "@heroui/react";
import type { ApiTokenRecord } from "@datadeal/database";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocalDate } from "../../../lib/local-date";
import { AccountCard, AccountRow, AccountSection } from "../account-ui";

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
    <AccountSection
      title="API tokens"
      description="Give each integration its own token so you can rotate or revoke access individually."
    >
      <AccountCard>
        <Form
          className="flex flex-wrap items-end gap-3 p-4"
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
          <div className="grid min-w-0 flex-1 basis-56 gap-1.5">
            <Label htmlFor="developer-token-label">Token name</Label>
            <Input
              id="developer-token-label"
              name="label"
              className="w-full"
              placeholder="My integration"
              maxLength={64}
              required
            />
          </div>
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
        <p role="status" className="m-0 px-4 py-3 text-sm empty:hidden">
          {notice}
        </p>
        {token && (
          <section
            className="grid gap-2 bg-surface p-4"
            aria-label="New API token"
          >
            <h3 className="m-0 text-sm font-semibold">Copy your token now</h3>
            <p className="m-0 text-sm text-muted">
              DataDeal only shows the full token once.
            </p>
            <Input
              aria-label="New API token"
              className="w-full font-mono"
              value={token}
              readOnly
            />
          </section>
        )}
        {records.length ? (
          records.map((item) => (
            <AccountRow
              key={item.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {item.label}
                  <Chip size="sm" variant="soft">
                    {item.scope}
                  </Chip>
                </span>
              }
              description={
                <>
                  Created <LocalDate value={item.createdAt} />
                  {item.lastUsedAt && (
                    <>
                      {" "}
                      · Last used <LocalDate value={item.lastUsedAt} />
                    </>
                  )}
                </>
              }
            >
              {item.revokedAt ? (
                <Chip size="sm" variant="soft" color="danger">
                  Revoked
                </Chip>
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
                  </Button>
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
            </AccountRow>
          ))
        ) : (
          <AccountRow
            title="No API tokens yet"
            description="Create a token above to start using the API."
          />
        )}
      </AccountCard>
    </AccountSection>
  );
}
