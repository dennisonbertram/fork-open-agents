/**
 * status-pill.tsx — small rounded status badge shared by loop-detail.tsx
 * (loop status, run status) and loop-triggers-card.tsx (trigger status,
 * #762). Extracted to its own module to avoid an import cycle between
 * those two files.
 */
import { cn } from "@/lib/utils";

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize",
        status === "active" || status === "succeeded" || status === "completed"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : status === "failed" || status === "cancelled"
            ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
            : status === "running" ||
                status === "queued" ||
                // stalled needs attention — amber like running/queued, never
                // the neutral gray fallback (it isn't an intentional pause).
                status === "stalled"
              ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
