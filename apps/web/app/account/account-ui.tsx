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
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            {title}
          </h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted">
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

/** A titled group of settings: heading and description, optional action. */
export function AccountSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="grid min-w-0 gap-0.5">
          <h2 className="m-0 text-base font-semibold">{title}</h2>
          {description && (
            <p className="m-0 max-w-prose text-sm text-muted">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A bordered card; its direct children are separated rows. */
export function AccountCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "divide-y divide-separator overflow-hidden rounded-2xl border border-separator " +
        className
      }
    >
      {children}
    </div>
  );
}

/** One setting or item: what it is on the left, its control on the right. */
export function AccountRow({
  title,
  description,
  media,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  media?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      {media && <div className="shrink-0">{media}</div>}
      <div className="grid min-w-0 flex-1 basis-40 gap-0.5">
        <div className="text-sm font-medium">{title}</div>
        {description && <div className="text-sm text-muted">{description}</div>}
      </div>
      {children && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {children}
        </div>
      )}
    </div>
  );
}

/** A labelled number for usage and price blocks. */
export function AccountStat({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="grid content-start gap-1 p-4">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xl leading-tight font-semibold tabular-nums">
        {value}
      </span>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
}
