import { useEffect, useState } from "react";
import { Switch, Label, Description } from "@heroui/react";
import { browser } from "wxt/browser";
import type { reminderSite } from "../../lib/reminder-site";

export function FormReminderPreference() {
  const [site, setSite] = useState<ReturnType<typeof reminderSite>>();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let current = true;
    async function load() {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      const { reminderSite } = await import("../../lib/reminder-site");
      const target = tab && !tab.incognito && reminderSite(tab.url);
      if (!target) return;
      const [{ origins }, preferences] = await Promise.all([
        browser.permissions.getAll(),
        browser.storage.local.get(target.preference),
      ]);
      if (current) {
        const granted =
          origins?.includes(target.pattern) === true &&
          preferences[target.preference] === true;
        setEnabled(granted);
        setSite(target);
        if (granted) {
          const synced = await browser.runtime.sendMessage({
            type: "sync-form-reminders",
          });
          if (current && !synced)
            setNotice("Your browser couldn't start reminders on this site.");
        }
      }
    }
    void load().catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  async function change() {
    if (!site || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const permission = { origins: [site.pattern] };
      // Persist this explicitly disclosed choice even if the native prompt
      // closes the popup. Registration still requires the exact host grant.
      const preferenceChange = enabled
        ? browser.storage.local.remove(site.preference)
        : browser.storage.local.set({ [site.preference]: true });
      const permissionChange = enabled
        ? browser.permissions.remove(permission)
        : browser.permissions.request(permission);
      const [, changed] = await Promise.all([
        preferenceChange,
        permissionChange,
      ]);
      if (changed) {
        const synced = await browser.runtime.sendMessage({
          type: "sync-form-reminders",
        });
        const { origins } = await browser.permissions.getAll();
        setEnabled(!enabled && origins?.includes(site.pattern) === true);
        if (!synced)
          setNotice(
            "Site access changed. Reopen the popup to retry the reminder.",
          );
      } else {
        await browser.storage.local.remove(site.preference);
        setEnabled(false);
        setNotice(
          enabled
            ? "The browser kept this permission."
            : "Site access was declined.",
        );
      }
    } catch {
      setNotice(
        "Couldn't change the reminder. Check this extension’s site access in your browser.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!site) return null;
  return (
    <section aria-label="Site reminders">
      <Switch
        className="w-full"
        size="sm"
        isSelected={enabled}
        isDisabled={busy}
        onChange={() => void change()}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Label className="wrap-anywhere">Show scores on {site.host}</Label>
        </Switch.Content>
        <Description className="text-xs leading-relaxed text-(--popup-muted)">
          On visits here, send only {site.domain} to DataDeal. See its score on
          the icon and beside sign-in, sign-up and checkout buttons.
        </Description>
      </Switch>
      {notice && (
        <p role="status" className="mt-1 text-xs text-(--popup-muted)">
          {notice}
        </p>
      )}
    </section>
  );
}
