"use client";

import { Button, Popover } from "@heroui/react";
import Link from "next/link";
import { useState } from "react";
import { DomainSearch } from "./search";

const destinations = [
  ["/methodology", "Methodology"],
  ["/pricing", "Pricing"],
  ["/account/developer", "Developers"],
  ["/account", "Account"],
] as const;

export function SiteNavigation() {
  const [search, setSearch] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    <div className="flex items-center gap-1 sm:gap-3">
      <nav
        className="hidden items-center gap-6 md:flex"
        aria-label="Main navigation"
      >
        {destinations.map(([href, label]) => (
          <Link key={href} href={href} className="py-2 hover:underline">
            {label}
          </Link>
        ))}
      </nav>
      <Popover isOpen={search} onOpenChange={setSearch}>
        <Button isIconOnly variant="ghost" aria-label="Search websites">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5 fill-none stroke-current"
            strokeWidth="2"
          >
            <circle cx="10" cy="10" r="6.5" />
            <path d="m15 15 6 6" />
          </svg>
        </Button>
        <Popover.Content
          placement="bottom end"
          className="w-[min(28rem,calc(100vw-2rem))]"
        >
          <Popover.Dialog aria-label="Search websites" className="p-4">
            <DomainSearch autoFocus onNavigate={() => setSearch(false)} />
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
      <Popover isOpen={menu} onOpenChange={setMenu}>
        <Button
          isIconOnly
          variant="ghost"
          className="md:hidden"
          aria-label="Menu"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5 fill-none stroke-current"
            strokeWidth="2"
          >
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </Button>
        <Popover.Content placement="bottom end">
          <Popover.Dialog aria-label="Site menu">
            <nav
              className="grid min-w-44 gap-1 p-2"
              aria-label="Mobile navigation"
            >
              {destinations.map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenu(false)}
                  className="rounded-lg px-3 py-2 hover:bg-default"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
