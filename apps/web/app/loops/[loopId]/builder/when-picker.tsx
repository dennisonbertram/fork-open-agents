"use client";

/**
 * when-picker.tsx — Small popover/dropdown for picking a `when` value
 * before committing an edge. Filters options by source node kind:
 * condition → true/false; others → success/failure/always.
 */

import type { LoopValidationError } from "@/lib/agent-loops/types";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type WhenValue = "true" | "false" | "success" | "failure" | "always";

const WHEN_OPTION_LABELS: Record<WhenValue, string> = {
  success: "success",
  failure: "failure",
  always: "always",
  true: "true",
  false: "false",
};

const WHEN_OPTION_COLORS: Record<WhenValue, string> = {
  success: "text-emerald-700 dark:text-emerald-300",
  failure: "text-red-700 dark:text-red-300",
  always: "text-muted-foreground",
  true: "text-sky-700 dark:text-sky-300",
  false: "text-slate-600 dark:text-slate-300",
};

type WhenPickerProps = {
  open: boolean;
  onClose: () => void;
  options: WhenValue[];
  onPick: (when: WhenValue) => void;
  anchorPosition?: { x: number; y: number };
};

export type { WhenValue };

export function WhenPicker({
  open,
  onClose,
  options,
  onPick,
  anchorPosition,
}: WhenPickerProps) {
  if (!open) return null;

  return (
    <Popover open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <PopoverContent
        className="w-44 p-1"
        style={
          anchorPosition
            ? {
                position: "absolute",
                left: anchorPosition.x,
                top: anchorPosition.y,
              }
            : undefined
        }
      >
        <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Choose when
        </p>
        <div className="space-y-0.5">
          {options.map((option) => (
            <Button
              key={option}
              variant="ghost"
              size="sm"
              className={cn(
                "nodrag w-full justify-start text-xs font-mono",
                WHEN_OPTION_COLORS[option],
              )}
              onClick={() => {
                onPick(option);
                onClose();
              }}
            >
              {WHEN_OPTION_LABELS[option]}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type { LoopValidationError };
