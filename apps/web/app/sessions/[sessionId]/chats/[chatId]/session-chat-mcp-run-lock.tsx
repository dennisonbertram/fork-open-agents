"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Whether a live run of this chat was started by an MCP client ("mcp"), by a
 * browser session ("browser"), or is unset (no live run, or a run started
 * before this feature existed). Null behaves exactly as it did before.
 */
export type ActiveRunSource = "browser" | "mcp" | null;

/**
 * Coerce a raw `activeRunSource` field value into the union type. The field is
 * optional in this component's own view of the chat payload so the UI half can
 * typecheck standalone before the backend slice lands; any missing or unknown
 * value collapses to null, which matches pre-existing composer behaviour.
 */
export function resolveActiveRunSource(value: unknown): ActiveRunSource {
  return value === "browser" || value === "mcp" ? value : null;
}

export function shouldLockComposer({
  activeRunSource,
  isStreaming,
  takenOver = false,
}: {
  activeRunSource: ActiveRunSource;
  isStreaming: boolean;
  takenOver?: boolean;
}): boolean {
  return activeRunSource === "mcp" && isStreaming && !takenOver;
}

/**
 * Composer lock for a headless MCP-driven run. The message input is disabled
 * while an MCP client owns the live run, until the human explicitly takes it
 * over. The lock re-arms automatically once the run is no longer live so a
 * subsequent headless run starts disabled again.
 */
export function useMcpComposerLock({
  activeRunSource,
  isStreaming,
}: {
  activeRunSource: ActiveRunSource;
  isStreaming: boolean;
}): { locked: boolean; takeOver: () => void } {
  const runIsLiveMcp = activeRunSource === "mcp" && isStreaming;
  const [takenOver, setTakenOver] = useState(false);

  useEffect(() => {
    if (!runIsLiveMcp) {
      setTakenOver(false);
    }
  }, [runIsLiveMcp]);

  const locked = shouldLockComposer({
    activeRunSource,
    isStreaming,
    takenOver,
  });

  const takeOver = useCallback(() => setTakenOver(true), []);

  return { locked, takeOver };
}

export function McpRunLockNotice({
  locked,
  onTakeOver,
  onCancel,
  confirming,
  onRequestTakeOver,
}: {
  locked: boolean;
  onTakeOver: () => void;
  onCancel: () => void;
  confirming: boolean;
  onRequestTakeOver: () => void;
}) {
  if (!locked) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2"
    >
      {confirming ? (
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      ) : (
        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      )}
      <div className="min-w-0 flex-1 text-sm">
        {confirming ? (
          <>
            <p className="font-medium text-amber-700 dark:text-amber-300">
              This is a remote agent&apos;s run.
            </p>
            <p className="mt-1 text-muted-foreground">
              Taking over will steer or interrupt the run another client started
              and is waiting on. Are you sure?
            </p>
          </>
        ) : (
          <>
            <p className="font-medium text-amber-700 dark:text-amber-300">
              This session is being driven by an MCP client
            </p>
            <p className="mt-1 text-muted-foreground">
              A remote agent is waiting on this run. The composer is disabled
              until you take over.
            </p>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {confirming ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          type="button"
          variant={confirming ? "destructive" : "outline"}
          size="sm"
          onClick={confirming ? onTakeOver : onRequestTakeOver}
        >
          Take over
        </Button>
      </div>
    </div>
  );
}
