"use client";

import Link from "next/link";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { findActiveNavItem, visibleNavGroups } from "./nav-items";

export function SettingsNav({
  pathname,
  isAdmin,
  onNavigate,
}: {
  pathname: string;
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const groups = visibleNavGroups(isAdmin);
  const activeId = findActiveNavItem(pathname, groups)?.id;
  const instanceId = useId();

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.id}>
          <h2
            id={`${instanceId}-${group.id}`}
            className="mb-1 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            {group.label}
          </h2>
          <ul
            aria-labelledby={`${instanceId}-${group.id}`}
            className="space-y-1"
          >
            {group.items.map((item) => {
              const isActive = item.id === activeId;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-4 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon aria-hidden="true" className="h-4 w-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
