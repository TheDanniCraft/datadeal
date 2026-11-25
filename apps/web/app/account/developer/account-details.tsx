"use client";

import { Disclosure } from "@heroui/react";
import type { ReactNode } from "react";

export function AccountDetails({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Disclosure>
      <Disclosure.Heading>
        <Disclosure.Trigger className="inline-flex items-center gap-2 py-1 text-sm">
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
