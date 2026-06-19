"use client";

import { cn } from "@/lib/utils";
import { toneToClass } from "@/components/mobile/lib/status";
import type { MobileStatusDescriptor } from "@/components/mobile/lib/types";

export interface MobileStatusPillProps {
  /** Status descriptor produced by deriveMobileStatus */
  descriptor: MobileStatusDescriptor;
  /** Visual size — defaults to "sm" */
  size?: "sm" | "md";
}

/**
 * Compact inline pill that surfaces a MobileStatusDescriptor.
 * Tone maps to design-system tokens via toneToClass (status.ts).
 * Renders no output when tone is idle to keep idle rows uncluttered.
 */
export function MobileStatusPill({
  descriptor,
  size = "sm",
}: MobileStatusPillProps) {
  const { label, tone } = descriptor;

  // Idle sessions show no pill — avoids visual noise
  if (tone === "idle") {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium leading-none",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        toneToClass(tone),
      )}
    >
      {label}
    </span>
  );
}
