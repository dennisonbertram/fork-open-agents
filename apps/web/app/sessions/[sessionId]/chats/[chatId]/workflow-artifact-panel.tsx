"use client";

import type { WorkflowArtifactJson } from "./hooks/use-session-observability";

// ---------------------------------------------------------------------------
// Redaction gate placeholders
// ---------------------------------------------------------------------------

const REDACTION_PLACEHOLDERS: Record<string, string> = {
  pending: "Redacted — pending review",
  failed: "Redacted — PII detected",
  blocked: "Blocked — pending review",
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatIsoDate(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function kindLabel(kind: string): string {
  return kind.replaceAll("_", " ");
}

function RedactionChip({ status }: { status: string }) {
  const colorClass =
    status === "passed"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "failed"
        ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
        : status === "blocked"
          ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
          : "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";

  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize ${colorClass}`}
    >
      {status}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const colorClass =
    status === "available"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "generating"
        ? "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-300"
        : status === "failed"
          ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
          : "border-muted bg-muted/50 text-muted-foreground";

  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize ${colorClass}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ArtifactRow — renders a single artifact with redaction-aware gating
// ---------------------------------------------------------------------------

function ArtifactRow({ artifact }: { artifact: WorkflowArtifactJson }) {
  const isPassed = artifact.redactionStatus === "passed";
  const placeholder = REDACTION_PLACEHOLDERS[artifact.redactionStatus];

  return (
    <div className="border-b border-border/60 px-3 py-2 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium capitalize">
            {kindLabel(artifact.kind)}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {artifact.createdByActor ?? "unknown actor"} ·{" "}
            {formatIsoDate(artifact.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusChip status={artifact.status} />
          <RedactionChip status={artifact.redactionStatus} />
        </div>
      </div>

      {isPassed ? (
        <>
          {artifact.summary && (
            <p className="mt-1.5 line-clamp-3 text-[11px] text-foreground/80">
              {artifact.summary}
            </p>
          )}
          {artifact.sourceLocation && (
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
              {artifact.sourceLocation}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1.5 text-[11px] italic text-muted-foreground">
          {placeholder ?? "Redacted"}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkflowArtifactsSection — exported pure presenter
// Tested === shipped: the panel renders via this exact export.
// ---------------------------------------------------------------------------

export function WorkflowArtifactsSection({
  artifacts,
}: {
  artifacts: WorkflowArtifactJson[];
}) {
  return (
    <section className="border-b border-border">
      <div className="border-b border-border/70 bg-muted/20 px-3 py-2">
        <h3 className="text-xs font-medium text-foreground">
          Workflow Artifacts
        </h3>
      </div>
      {artifacts.length === 0 ? (
        <div className="px-3 py-4 text-xs text-muted-foreground">
          No workflow artifacts recorded for this session.
        </div>
      ) : (
        <div>
          {artifacts.map((artifact) => (
            <ArtifactRow artifact={artifact} key={artifact.id} />
          ))}
        </div>
      )}
    </section>
  );
}

export default WorkflowArtifactsSection;
