"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Plus, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface TabItem {
  href: string;
  label: string;
  Icon: typeof Activity;
  /** When true, render as a prominent FAB-style center button */
  isCta?: boolean;
}

const TABS: TabItem[] = [
  { href: "/m", label: "Activity", Icon: Activity },
  { href: "/m/new", label: "New", Icon: Plus, isCta: true },
  { href: "/m/me", label: "Me", Icon: User },
];

function isTabActive(href: string, pathname: string): boolean {
  if (href === "/m") {
    return pathname === "/m";
  }
  return pathname.startsWith(href);
}

/**
 * Fixed bottom tab bar for all mobile /m/* routes.
 * The center "New" button uses --primary to stand out as the primary action.
 */
export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex items-end border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)]"
      aria-label="Mobile navigation"
    >
      {TABS.map(({ href, label, Icon, isCta }) => {
        const active = isTabActive(href, pathname);

        if (isCta) {
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-1 flex-col items-center justify-center py-2"
              aria-label={label}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={cn(
                  "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-primary/90 text-primary-foreground",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
            </Link>
          );
        }

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-label={label}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
