"use client";

import { cn } from "@/lib/utils";
import type { ActivityFilter } from "@/components/mobile/lib/types";

interface FilterCounts {
  all: number;
  working: number;
  waiting: number;
  done: number;
}

interface MobileActivityFilterChipsProps {
  value: ActivityFilter;
  counts: FilterCounts;
  onChange: (next: ActivityFilter) => void;
}

const FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "working", label: "Working" },
  { key: "waiting", label: "Waiting" },
  { key: "done", label: "Done" },
];

/**
 * Horizontal scrollable filter chips for the Activity screen.
 * Active chip uses --primary to signal the current selection.
 * Counts are shown in a muted badge next to the label.
 */
export function MobileActivityFilterChips({
  value,
  counts,
  onChange,
}: MobileActivityFilterChipsProps) {
  return (
    <div
      className="flex gap-2 overflow-x-auto px-4 pb-2 pt-1 scrollbar-none"
      role="group"
      aria-label="Filter sessions"
    >
      {FILTERS.map(({ key, label }) => {
        const active = value === key;
        const count = counts[key];

        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={active}
            aria-label={`${label}${count > 0 ? `, ${count} sessions` : ""}`}
            className={cn(
              "inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label}
            {count > 0 ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0 text-[10px] leading-5 font-semibold",
                  active
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
