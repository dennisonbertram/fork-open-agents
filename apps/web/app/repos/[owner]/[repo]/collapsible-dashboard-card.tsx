"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Tailwind `md` breakpoint — cards default to collapsed below this width. */
const MD_BREAKPOINT = 768;

function storageKeyFor(key: string): string {
  return `repo-dashboard-card:${key}`;
}

type CollapsibleDashboardCardProps = {
  /** Stable key for persisting this card's collapsed state. */
  cardKey: string;
  title: string;
  /** One-line summary shown in the header only while collapsed. */
  summary?: string | null;
  /** Right-aligned header control (e.g. a "View on GitHub" link). */
  action?: ReactNode;
  /** Accessible label for the card section. */
  ariaLabel?: string;
  children: ReactNode;
};

/**
 * Collapsible wrapper for the repo dashboard section cards. A chevron sits to
 * the LEFT of the title; collapsing hides the body and surfaces a summary stat
 * in the header. The choice persists in localStorage, and with no saved
 * preference the card starts collapsed on narrow viewports.
 *
 * Renders expanded on the server / first client paint to avoid a hydration
 * mismatch, then reconciles with the stored/viewport state in an effect.
 */
export function CollapsibleDashboardCard({
  cardKey,
  title,
  summary,
  action,
  ariaLabel,
  children,
}: CollapsibleDashboardCardProps) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let nextOpen = true;
    try {
      const stored = window.localStorage.getItem(storageKeyFor(cardKey));
      if (stored === "collapsed") {
        nextOpen = false;
      } else if (stored === "expanded") {
        nextOpen = true;
      } else {
        nextOpen = window.innerWidth >= MD_BREAKPOINT;
      }
    } catch {
      // localStorage unavailable (private mode / SSR) — keep default open.
      nextOpen = true;
    }
    setOpen(nextOpen);
  }, [cardKey]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          storageKeyFor(cardKey),
          next ? "expanded" : "collapsed",
        );
      } catch {
        // Ignore persistence failures; the in-memory toggle still works.
      }
      return next;
    });
  };

  return (
    <section
      aria-label={ariaLabel ?? `${title} window`}
      // self-start so a collapsed card shrinks to its header instead of
      // stretching to match taller siblings in the same grid row.
      className="self-start rounded-md border border-border"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open ? "" : "-rotate-90",
            )}
          />
          <h2 className="shrink-0 text-sm font-medium">{title}</h2>
          {!open && summary ? (
            <span className="truncate text-[11px] text-muted-foreground">
              {summary}
            </span>
          ) : null}
        </button>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {open ? children : null}
    </section>
  );
}
