"use client";

import type { ReactNode } from "react";
import { Button, Label, Disclosure, SearchField } from "@heroui/react";

export function ProviderLookup({
  value,
  invalid,
}: {
  value: string;
  invalid: boolean;
}) {
  return (
    <>
      <form
        action="/data-flow"
        method="get"
        className="flex items-end gap-2 md:grid md:gap-3"
      >
        <SearchField
          className="min-w-0 flex-1"
          isRequired
          isInvalid={invalid}
          name="provider"
          defaultValue={value}
        >
          <Label>Provider domain</Label>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input
              placeholder="example.com"
              maxLength={253}
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={invalid ? "provider-lookup-error" : undefined}
            />
          </SearchField.Group>
        </SearchField>
        <Button type="submit" variant="secondary" className="shrink-0">
          Find provider
        </Button>
      </form>
      {invalid && (
        <p id="provider-lookup-error" role="alert">
          Enter a provider domain, such as example.com.
        </p>
      )}
    </>
  );
}

export function ProviderDisclosure({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <Disclosure>
      <Disclosure.Heading>
        <Disclosure.Trigger className="inline-flex min-h-11 items-center gap-2">
          {label}
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body>{children}</Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}
