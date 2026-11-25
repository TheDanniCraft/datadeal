"use client";

import { Button, Label, ListBox, Select } from "@heroui/react";
import { privacyPreference, type PrivacyPreference } from "@datadeal/contracts";
import { useState } from "react";

export function PrivacyProfile({ saved }: { saved: PrivacyPreference }) {
  const [selection, setSelection] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  return (
    <form
      className="grid max-w-sm gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          const response = await fetch("/api/v1/account/privacy-profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(selection),
          });
          setMessage(
            response.ok
              ? "Privacy profile saved."
              : "Could not save the privacy profile.",
          );
        } catch {
          setMessage("Could not save the privacy profile.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Select
        value={selection}
        isDisabled={busy}
        onChange={(key) => {
          const parsed = privacyPreference.safeParse(key);
          if (parsed.success) setSelection(parsed.data);
          setMessage("");
        }}
      >
        <Label>Registration advice</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="standard" textValue="Standard advice">
              Standard advice
              <ListBox.ItemIndicator />
            </ListBox.Item>
            <ListBox.Item
              id="data_minimization"
              textValue="Share as little as possible"
            >
              Share as little as possible
              <ListBox.ItemIndicator />
            </ListBox.Item>
          </ListBox>
        </Select.Popover>
      </Select>
      <Button type="submit" isDisabled={busy} className="justify-self-start">
        Save privacy profile
      </Button>
      <p role="status">{message}</p>
    </form>
  );
}
