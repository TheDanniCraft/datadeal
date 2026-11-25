import type { ReactNode } from "react";
import Link from "next/link";
import { buttonVariants } from "@heroui/styles";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { AccountNavigation } from "./account-navigation";

import { AccountIcon, type AccountSymbol } from "./account-icon";
export { AccountIcon } from "./account-icon";
export function AccountLink({
  href,
  children,
  secondary = false,
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <Link
      className={buttonVariants({ variant: secondary ? "outline" : "primary" })}
      href={href}
    >
      {children}
    </Link>
  );
}

export function AccountScreen({
  title,
  description,
  current,
  children,
}: {
  title: string;
  description: string;
  current?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={
        current
          ? "mx-auto grid max-w-5xl items-start gap-6 py-8 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-16 md:py-16"
          : "mx-auto max-w-3xl py-8 md:py-16"
      }
    >
      {current && <AccountNavigation current={current} />}
      <section className="min-w-0 space-y-7 wrap-anywhere">
        <header className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            {title}
          </h1>
          <p className="max-w-prose leading-relaxed text-muted">
            {description}
          </p>
        </header>
        {children}
      </section>
    </div>
  );
}

export function AccountEmpty({
  symbol,
  title,
  children,
  action,
}: {
  symbol: AccountSymbol;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <EmptyState className="my-4 rounded-2xl bg-surface px-5 py-10">
      <EmptyState.Header>
        <EmptyState.Media variant="icon">
          <AccountIcon name={symbol} />
        </EmptyState.Media>
        <EmptyState.Title>{title}</EmptyState.Title>
        <EmptyState.Description>{children}</EmptyState.Description>
      </EmptyState.Header>
      {action && <EmptyState.Content>{action}</EmptyState.Content>}
    </EmptyState>
  );
}
