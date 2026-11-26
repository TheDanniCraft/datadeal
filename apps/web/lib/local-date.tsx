"use client";

import { useSyncExternalStore } from "react";

const noChange = () => () => {};

/**
 * The visitor's time zone. The server cannot know it, so the server render
 * and hydration use UTC and the browser switches to its own zone right after.
 */
export function useTimeZone() {
  return useSyncExternalStore(
    noChange,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "UTC",
  );
}

export const dayFormat: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

/** A date as text in the visitor's time zone. */
export function LocalDate({
  value,
  options = dayFormat,
}: {
  value: string | number | Date;
  options?: Intl.DateTimeFormatOptions;
}) {
  const timeZone = useTimeZone();
  return new Intl.DateTimeFormat("en", { ...options, timeZone }).format(
    new Date(value),
  );
}
