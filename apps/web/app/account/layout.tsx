import type { ReactNode } from "react";

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <div className="min-w-0 wrap-anywhere">{children}</div>;
}
