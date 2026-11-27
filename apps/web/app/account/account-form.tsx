"use client";

import { Button, Form, Input, Label, TextField, Alert } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AccountForm({
  signedIn,
  returnTo,
  localOutbox,
}: {
  signedIn: boolean;
  returnTo?: string;
  localOutbox?: string;
}) {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <Form
      className={signedIn ? "items-start" : "mt-3 grid gap-4"}
      onSubmit={async (event) => {
        event.preventDefault();
        const email = new FormData(event.currentTarget).get("email");
        setBusy(true);
        try {
          const response = await fetch(
            signedIn ? "/api/auth/sign-out" : "/api/auth/sign-in/magic-link",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(signedIn ? {} : { email, returnTo }),
            },
          );
          if (!response.ok) {
            setNotice(
              response.status === 429
                ? "Too many requests. Try again shortly."
                : "Could not complete the request. Try again.",
            );
          } else if (signedIn) {
            setNotice("");
            router.refresh();
          } else {
            setNotice(
              localOutbox
                ? "Your sign-in link is in the local outbox."
                : "Check your inbox for a sign-in link.",
            );
          }
        } catch {
          setNotice("Could not reach DataDeal. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {!signedIn && (
        <TextField name="email" type="email" isRequired>
          <Label>Email address</Label>
          <Input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            maxLength={254}
            required
          />
        </TextField>
      )}
      <Button
        type="submit"
        variant={signedIn ? "outline" : "primary"}
        fullWidth={!signedIn}
        isDisabled={busy}
      >
        {signedIn ? "Sign out" : "Send sign-in link"}
      </Button>
      {notice && (
        <Alert role="status">
          <Alert.Content>
            <Alert.Title>{notice}</Alert.Title>
            {localOutbox && notice.includes("local outbox") && (
              <Alert.Description className="wrap-anywhere">
                Open <code>{localOutbox}</code> on this computer, then open the
                link inside. Find its path in the web server environment under{" "}
                <code>DATADEAL_LOCAL_MAIL_FILE</code>.
              </Alert.Description>
            )}
          </Alert.Content>
        </Alert>
      )}
    </Form>
  );
}
