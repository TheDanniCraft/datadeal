import Link from "next/link";
import { buttonVariants } from "@heroui/styles";
import { AccountDetails } from "./developer/account-details";
import { AccountIcon, type AccountSymbol } from "./account-icon";

const sections = [
  ["Overview", "/account", "account"],
  ["Billing and Pro", "/account/billing", "billing"],
  ["Developer API", "/account/developer", "developer"],
  ["Library", "/account/library", "watchlist"],
] as const satisfies readonly (readonly [string, string, AccountSymbol])[];
export function AccountNavigation({ current }: { current: string }) {
  const available =
    current === "/account/rewards"
      ? [...sections, ["Report points", "/account/rewards", "points"] as const]
      : sections;
  const links = (
    <nav
      className="grid grid-cols-2 gap-1 md:grid-cols-1"
      aria-label="Account sections"
    >
      {available.map(([label, href, icon]) => (
        <Link
          href={href}
          key={href}
          className={buttonVariants({
            variant: current === href ? "secondary" : "ghost",
            className: "min-h-11 justify-start gap-3",
          })}
          aria-current={current === href ? "page" : undefined}
        >
          <AccountIcon name={icon} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
  return (
    <>
      <div className="hidden md:block">{links}</div>
      <div className="md:hidden">
        <AccountDetails label="Account menu">{links}</AccountDetails>
      </div>
    </>
  );
}
