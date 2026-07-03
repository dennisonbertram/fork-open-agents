"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ManagedRuntimeProfileRunJson,
  RuntimeMode,
} from "./hooks/use-session-observability";

export type RuntimeStatusBadgeTone =
  | "neutral"
  | "success"
  | "failure"
  | "warning";

export type RuntimeStatusBadgeView = {
  label: string;
  tone: RuntimeStatusBadgeTone;
  mismatch: { requestedProfileId: string; resolvedProfileId: string } | null;
};

const toneClassName: Record<RuntimeStatusBadgeTone, string> = {
  neutral: "border-border bg-muted/40 text-muted-foreground",
  success:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failure: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  warning:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

/**
 * Derives the compact main-surface badge view from the latest ProfileRun
 * record (#815). Pure function so state derivation is unit-testable without
 * rendering.
 *
 * Priority order matters: loading takes priority over evidence-unavailable
 * so the badge never flickers "Evidence unavailable" during a normal load
 * (issue #815 §14 concern).
 */
export function getRuntimeStatusBadgeView(params: {
  runtimeMode: RuntimeMode | null | undefined;
  latestProfileRun: ManagedRuntimeProfileRunJson | null;
  isLoading?: boolean;
}): RuntimeStatusBadgeView | null {
  if (params.runtimeMode !== "managed_runtime") {
    return null;
  }

  const profileName =
    params.latestProfileRun?.profileDisplayName ?? "the selected profile";
  const mismatch =
    params.latestProfileRun?.requestedProfileId &&
    params.latestProfileRun?.resolvedProfileId &&
    params.latestProfileRun.requestedProfileId !==
      params.latestProfileRun.resolvedProfileId
      ? {
          requestedProfileId: params.latestProfileRun.requestedProfileId,
          resolvedProfileId: params.latestProfileRun.resolvedProfileId,
        }
      : null;

  if (params.isLoading) {
    return {
      label: `Managed · ${profileName} · Loading…`,
      tone: "neutral",
      mismatch,
    };
  }

  if (!params.latestProfileRun) {
    return {
      label: `Managed · ${profileName} · Evidence unavailable`,
      tone: "warning",
      mismatch,
    };
  }

  const { status } = params.latestProfileRun;

  if (status === "running") {
    return {
      label: `Managed · ${profileName} · Verifying…`,
      tone: "neutral",
      mismatch,
    };
  }

  if (status === "passed") {
    return {
      label: `Managed · ${profileName} · Verified`,
      tone: "success",
      mismatch,
    };
  }

  if (status === "failed") {
    return {
      label: `Managed · ${profileName} · Setup failed`,
      tone: "failure",
      mismatch,
    };
  }

  // "blocked": a required command never verified — must never be reported
  // as passed (Codex #825 P2 concern, reused for the badge here).
  return {
    label: `Managed · ${profileName} · Evidence unavailable`,
    tone: "warning",
    mismatch,
  };
}

export function RuntimeStatusBadge({
  runtimeMode,
  latestProfileRun,
  isLoading,
  onOpenInspector,
}: {
  runtimeMode: RuntimeMode | null | undefined;
  latestProfileRun: ManagedRuntimeProfileRunJson | null;
  isLoading?: boolean;
  onOpenInspector: () => void;
}) {
  const view = getRuntimeStatusBadgeView({
    runtimeMode,
    latestProfileRun,
    isLoading,
  });

  if (!view) {
    return null;
  }

  return (
    <button
      aria-label={view.label}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        toneClassName[view.tone],
      )}
      onClick={onOpenInspector}
      type="button"
    >
      <span className="truncate">{view.label}</span>
      {view.mismatch ? (
        <span className="inline-flex items-center gap-1 truncate text-[10px] opacity-90">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          requested {view.mismatch.requestedProfileId} · resolved{" "}
          {view.mismatch.resolvedProfileId}
        </span>
      ) : null}
    </button>
  );
}

export default RuntimeStatusBadge;
