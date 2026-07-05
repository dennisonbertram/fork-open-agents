"use client";

import { Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A single label/value row for {@link RunMetadataTable}.
 *
 * `value: null` renders a "—" placeholder in place of the value — this is
 * how a run keeps a STABLE row set across its lifecycle (#895): a
 * not-yet-known value (e.g. `workflowRunId` before dispatch) shows the row
 * with a placeholder rather than the row appearing/disappearing and
 * re-packing the layout as the run progresses.
 */
export type RunMetadataRow = {
  /** Stable React key; does not need to match `label`. */
  key: string;
  label: string;
  value: string | null;
  /** Renders an inline copy-to-clipboard button when `value` is present. */
  copyable?: boolean;
};

const PLACEHOLDER = "—";

function CopyValueButton({ label, value }: { label: string; value: string }) {
  return (
    <button
      aria-label={`Copy ${label}`}
      className="shrink-0 text-muted-foreground hover:text-foreground"
      onClick={() => void navigator.clipboard.writeText(value)}
      type="button"
    >
      <Copy className="h-3 w-3" />
    </button>
  );
}

/**
 * Terminal-style label/value row list (#895).
 *
 * Replaces the old `ProofItem` content-sized card grid: a single bordered
 * container holds every row, the label column is a fixed width independent
 * of value length, and each value lives in its own `overflow-x-auto` cell —
 * a long workflow run id, UUID request id, or idempotency key scrolls
 * WITHIN its own cell instead of widening the row or reflowing siblings.
 *
 * Rows are a real `<dl>` (label/value pairs via `<dt>`/`<dd>`) so the
 * label-value association is programmatic, and values remain selectable
 * text.
 */
export function RunMetadataTable({
  rows,
  heading,
  className,
}: {
  rows: RunMetadataRow[];
  heading?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border",
        className,
      )}
    >
      {heading && (
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">{heading}</h2>
        </div>
      )}
      <dl className="divide-y divide-border text-sm">
        {rows.map((row) => (
          <div
            className="flex items-start gap-3 px-4 py-2"
            data-row-key={row.key}
            key={row.key}
          >
            <dt className="w-28 shrink-0 truncate pt-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:w-40">
              {row.label}
            </dt>
            <dd className="flex min-w-0 flex-1 items-center gap-1">
              <span className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">
                {row.value ?? PLACEHOLDER}
              </span>
              {row.copyable && row.value && (
                <CopyValueButton label={row.label} value={row.value} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
