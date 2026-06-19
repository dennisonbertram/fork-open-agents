"use client";

import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MobileScreenHeaderProps {
  /** Primary heading text */
  title: string;
  /** Optional secondary line below the title */
  subtitle?: string;
  /** Optional element rendered in the trailing (right) slot */
  trailing?: React.ReactNode;
  /** When provided, renders a back chevron that calls this handler */
  onBack?: () => void;
  /**
   * When true, the header sticks to the top of the viewport and gains a
   * blurred backdrop so content can scroll beneath it.
   * Defaults to true.
   */
  sticky?: boolean;
}

/**
 * Shared top-of-screen header for all mobile /m/* routes.
 *
 * - Sticks to the top and uses safe-area-inset-top padding so it clears the
 *   notch/status bar on iOS.
 * - Back chevron (onBack), title, optional subtitle, and a trailing slot.
 * - All interactive elements meet the >=44px touch-target requirement.
 */
export function MobileScreenHeader({
  title,
  subtitle,
  trailing,
  onBack,
  sticky = true,
}: MobileScreenHeaderProps) {
  return (
    <header
      className={cn(
        "z-40 flex w-full items-center gap-2 border-b border-border bg-background/90 px-4 pb-3 pt-[max(env(safe-area-inset-top,0px),12px)] backdrop-blur-sm",
        sticky && "sticky top-0",
      )}
    >
      {/* Back button */}
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent active:bg-accent/70"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}

      {/* Title block */}
      <div className="flex min-w-0 flex-1 flex-col">
        <h1
          className={cn(
            "truncate font-semibold leading-tight text-foreground",
            subtitle ? "text-base" : "text-lg",
          )}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>

      {/* Trailing slot */}
      {trailing ? (
        <div className="flex shrink-0 items-center">{trailing}</div>
      ) : null}
    </header>
  );
}
