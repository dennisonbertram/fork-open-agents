"use client";

/**
 * loop-nodes.tsx — React Flow custom node components for each LoopNodeKind.
 *
 * Five pure node types using simple-ai ported primitives:
 *   start     — Play icon, emerald accent, source handle only (right)
 *   agent_step — Bot icon, violet accent, target left + source right
 *   github_check — Github icon, slate accent, target left + source right
 *   condition — GitBranch icon, amber accent, target left + source right
 *   end        — Flag icon, neutral, target handle only (left)
 *
 * Config summaries (first 60 chars of instructions, check kind, condition path op value).
 * Handles are rendered with BaseHandle; interactive elements use nodrag class.
 *
 * Two orthogonal overlay systems compose here:
 *
 * 1. Error badges (builder only) — from BuilderErrorContext + NodeErrorBadge:
 *    - useNodeErrors reads from context; context defaults to {} so run-graph
 *      usage (no provider) safely returns [] with no badge rendered.
 *
 * 2. Run-state overlays (run graph) — from node.data optional props:
 *    data.runStatus?    — "unvisited"|"running"|"succeeded"|"failed"|"skipped"
 *    data.visitCount?   — number of times this node has been visited in the run
 *    data.isCurrent?    — true when this is the active execution node
 *
 * When runStatus is absent, all run overlays are invisible and structure is
 * identical to the original builder rendering.
 */

import { Position, type NodeProps } from "@xyflow/react";
import { Bot, Flag, GitBranch, Github, Play } from "lucide-react";
import { BaseNode } from "@/components/ui/flow/base-node";
import { BaseHandle } from "@/components/ui/flow/base-handle";
import {
  NodeHeader,
  NodeHeaderIcon,
  NodeHeaderTitle,
} from "@/components/ui/flow/node-header";
import { NodeHeaderStatus } from "@/components/ui/flow/node-header-status";
import { cn } from "@/lib/utils";
import type {
  AgentStepNode,
  ConditionNode,
  EndNode,
  GithubCheckNode,
  StartNode,
} from "@/lib/agent-loops/types";
import type { LoopFlowNode } from "./definition-mapping";
import {
  mapRunStatusToHeaderStatus,
  isNodeDimmed,
  isNodePulsing,
  hasFailedRing,
  shouldShowVisitPill,
  type NodeRunStatus,
} from "./run-overlays";
import { useNodeErrors } from "./builder-error-context";
import { NodeErrorBadge } from "./node-error-badge";

// ── Accent border helper ───────────────────────────────────────────────────────

const kindAccent: Record<string, string> = {
  start: "border-l-4 border-l-emerald-500",
  agent_step: "border-l-4 border-l-violet-500",
  github_check: "border-l-4 border-l-slate-500",
  condition: "border-l-4 border-l-amber-500",
  end: "border-l-4 border-l-neutral-400",
};

const kindIconClass: Record<string, string> = {
  start: "text-emerald-600 dark:text-emerald-400",
  agent_step: "text-violet-600 dark:text-violet-400",
  github_check: "text-slate-600 dark:text-slate-400",
  condition: "text-amber-600 dark:text-amber-400",
  end: "text-neutral-500",
};

// ── Run-state overlay types (add-only — builder nodes never pass these) ────────

/**
 * Optional run-state fields that can be mixed into node.data for the run view.
 * When all are absent, node renders identically to the builder.
 */
export type RunStateOverlay = {
  runStatus?: NodeRunStatus;
  visitCount?: number;
  isCurrent?: boolean;
};

// ── Run-state overlay helpers ─────────────────────────────────────────────────

/**
 * Computes the wrapper className additions for run-state overlays.
 * Returns an empty string when no run-state is present.
 */
function runStateWrapperClass(overlay: RunStateOverlay): string {
  const { runStatus, isCurrent } = overlay;
  if (!runStatus) return "";

  const parts: string[] = [];

  if (isNodeDimmed(runStatus)) {
    parts.push("opacity-50");
  }

  if (isNodePulsing(isCurrent)) {
    parts.push("ring-2 ring-orange-400 animate-pulse rounded-md");
  } else if (hasFailedRing(runStatus)) {
    parts.push("ring-2 ring-red-500 rounded-md");
  } else if (runStatus === "succeeded") {
    parts.push("ring-2 ring-emerald-500 rounded-md");
  }

  return parts.join(" ");
}

/**
 * VisitCountPill — rendered inside the header when visitCount > 1.
 */
function VisitCountPill({ visitCount }: { visitCount: number }) {
  if (!shouldShowVisitPill(visitCount)) return null;
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-muted-foreground">
      ×{visitCount}
    </span>
  );
}

// ── Shared target / source handles ────────────────────────────────────────────

function TargetHandle() {
  return (
    <BaseHandle
      type="target"
      position={Position.Left}
      className="!size-3 !border-2 !border-border !bg-background transition-colors hover:!border-foreground"
    />
  );
}

function SourceHandle() {
  return (
    <BaseHandle
      type="source"
      position={Position.Right}
      className="!size-3 !border-2 !border-border !bg-background transition-colors hover:!border-foreground"
    />
  );
}

// ── Start node ─────────────────────────────────────────────────────────────────

type StartNodeProps = NodeProps & { data: StartNode & RunStateOverlay };

export function StartNodeComponent({ data, selected }: StartNodeProps) {
  // Error badges: from context (builder only; degrades to [] when no provider)
  const errors = useNodeErrors(data.id);
  const errorCount = errors.length;

  // Run overlays: from node.data props (run graph only; absent in builder)
  const overlay: RunStateOverlay = {
    runStatus: data.runStatus,
    visitCount: data.visitCount,
    isCurrent: data.isCurrent,
  };
  const headerStatus = mapRunStatusToHeaderStatus(overlay.runStatus);
  const wrapperClass = runStateWrapperClass(overlay);

  return (
    <BaseNode
      selected={selected}
      className={cn(
        "relative min-w-[140px] max-w-[200px]",
        kindAccent.start,
        errorCount > 0 && "ring-2 ring-red-500/60",
        wrapperClass,
      )}
    >
      <NodeHeader className="bg-emerald-500/5">
        <NodeHeaderIcon className={kindIconClass.start}>
          <Play />
        </NodeHeaderIcon>
        <NodeHeaderTitle className="text-sm">
          {data.label || "Start"}
          {overlay.visitCount !== undefined && (
            <VisitCountPill visitCount={overlay.visitCount} />
          )}
        </NodeHeaderTitle>
        {headerStatus && <NodeHeaderStatus status={headerStatus} />}
      </NodeHeader>
      <p className="text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        start
      </p>
      <SourceHandle />
      <NodeErrorBadge count={errorCount} />
    </BaseNode>
  );
}

// ── AgentStep node ─────────────────────────────────────────────────────────────

type AgentStepNodeProps = NodeProps & { data: AgentStepNode & RunStateOverlay };

export function AgentStepNodeComponent({ data, selected }: AgentStepNodeProps) {
  // Error badges: from context (builder only; degrades to [] when no provider)
  const errors = useNodeErrors(data.id);
  const errorCount = errors.length;

  const summary = data.instructions
    ? data.instructions.slice(0, 60) +
      (data.instructions.length > 60 ? "…" : "")
    : undefined;

  // Run overlays: from node.data props (run graph only; absent in builder)
  const overlay: RunStateOverlay = {
    runStatus: data.runStatus,
    visitCount: data.visitCount,
    isCurrent: data.isCurrent,
  };
  const headerStatus = mapRunStatusToHeaderStatus(overlay.runStatus);
  const wrapperClass = runStateWrapperClass(overlay);

  return (
    <BaseNode
      selected={selected}
      className={cn(
        "relative min-w-[200px] max-w-[280px]",
        kindAccent.agent_step,
        errorCount > 0 && "ring-2 ring-red-500/60",
        wrapperClass,
      )}
    >
      <NodeHeader className="bg-violet-500/5">
        <NodeHeaderIcon className={kindIconClass.agent_step}>
          <Bot />
        </NodeHeaderIcon>
        <NodeHeaderTitle className="text-sm">
          {data.label || "Agent step"}
          {overlay.visitCount !== undefined && (
            <VisitCountPill visitCount={overlay.visitCount} />
          )}
        </NodeHeaderTitle>
        {headerStatus && <NodeHeaderStatus status={headerStatus} />}
      </NodeHeader>
      {summary && (
        <p className="line-clamp-2 text-[11px] text-muted-foreground">
          {summary}
        </p>
      )}
      <TargetHandle />
      <SourceHandle />
      <NodeErrorBadge count={errorCount} />
    </BaseNode>
  );
}

// ── GithubCheck node ──────────────────────────────────────────────────────────

type GithubCheckNodeProps = NodeProps & {
  data: GithubCheckNode & RunStateOverlay;
};

export function GithubCheckNodeComponent({
  data,
  selected,
}: GithubCheckNodeProps) {
  // Error badges: from context (builder only; degrades to [] when no provider)
  const errors = useNodeErrors(data.id);
  const errorCount = errors.length;

  let checkSummary: string | undefined;
  if (data.check) {
    const kindLabel = data.check.kind.replaceAll("_", " ");
    if (data.check.kind === "list_issues" && data.check.state) {
      checkSummary = `${kindLabel} · ${data.check.state}`;
    } else {
      checkSummary = kindLabel;
    }
  }

  // Run overlays: from node.data props (run graph only; absent in builder)
  const overlay: RunStateOverlay = {
    runStatus: data.runStatus,
    visitCount: data.visitCount,
    isCurrent: data.isCurrent,
  };
  const headerStatus = mapRunStatusToHeaderStatus(overlay.runStatus);
  const wrapperClass = runStateWrapperClass(overlay);

  return (
    <BaseNode
      selected={selected}
      className={cn(
        "relative min-w-[200px] max-w-[280px]",
        kindAccent.github_check,
        errorCount > 0 && "ring-2 ring-red-500/60",
        wrapperClass,
      )}
    >
      <NodeHeader className="bg-slate-500/5">
        <NodeHeaderIcon className={kindIconClass.github_check}>
          <Github />
        </NodeHeaderIcon>
        <NodeHeaderTitle className="text-sm">
          {data.label || "GitHub check"}
          {overlay.visitCount !== undefined && (
            <VisitCountPill visitCount={overlay.visitCount} />
          )}
        </NodeHeaderTitle>
        {headerStatus && <NodeHeaderStatus status={headerStatus} />}
      </NodeHeader>
      {checkSummary && (
        <p className="text-[11px] text-muted-foreground">{checkSummary}</p>
      )}
      <TargetHandle />
      <SourceHandle />
      <NodeErrorBadge count={errorCount} />
    </BaseNode>
  );
}

// ── Condition node ─────────────────────────────────────────────────────────────

type ConditionNodeProps = NodeProps & {
  data: ConditionNode & RunStateOverlay;
};

export function ConditionNodeComponent({ data, selected }: ConditionNodeProps) {
  // Error badges: from context (builder only; degrades to [] when no provider)
  const errors = useNodeErrors(data.id);
  const errorCount = errors.length;

  const cond = data.condition;
  const condSummary = cond
    ? `${cond.path || "…"} ${cond.op}${cond.value !== undefined ? ` ${String(cond.value)}` : ""}`
    : undefined;

  // Run overlays: from node.data props (run graph only; absent in builder)
  const overlay: RunStateOverlay = {
    runStatus: data.runStatus,
    visitCount: data.visitCount,
    isCurrent: data.isCurrent,
  };
  const headerStatus = mapRunStatusToHeaderStatus(overlay.runStatus);
  const wrapperClass = runStateWrapperClass(overlay);

  return (
    <BaseNode
      selected={selected}
      className={cn(
        "relative min-w-[200px] max-w-[280px]",
        kindAccent.condition,
        errorCount > 0 && "ring-2 ring-red-500/60",
        wrapperClass,
      )}
    >
      <NodeHeader className="bg-amber-500/5">
        <NodeHeaderIcon className={kindIconClass.condition}>
          <GitBranch />
        </NodeHeaderIcon>
        <NodeHeaderTitle className="text-sm">
          {data.label || "Condition"}
          {overlay.visitCount !== undefined && (
            <VisitCountPill visitCount={overlay.visitCount} />
          )}
        </NodeHeaderTitle>
        {headerStatus && <NodeHeaderStatus status={headerStatus} />}
      </NodeHeader>
      {condSummary && (
        <p className="truncate text-[11px] font-mono text-muted-foreground">
          {condSummary}
        </p>
      )}
      <TargetHandle />
      <SourceHandle />
      <NodeErrorBadge count={errorCount} />
    </BaseNode>
  );
}

// ── End node ──────────────────────────────────────────────────────────────────

type EndNodeProps = NodeProps & { data: EndNode & RunStateOverlay };

export function EndNodeComponent({ data, selected }: EndNodeProps) {
  // Error badges: from context (builder only; degrades to [] when no provider)
  const errors = useNodeErrors(data.id);
  const errorCount = errors.length;

  // Run overlays: from node.data props (run graph only; absent in builder)
  const overlay: RunStateOverlay = {
    runStatus: data.runStatus,
    visitCount: data.visitCount,
    isCurrent: data.isCurrent,
  };
  const headerStatus = mapRunStatusToHeaderStatus(overlay.runStatus);
  const wrapperClass = runStateWrapperClass(overlay);

  return (
    <BaseNode
      selected={selected}
      className={cn(
        "relative min-w-[140px] max-w-[200px]",
        kindAccent.end,
        errorCount > 0 && "ring-2 ring-red-500/60",
        wrapperClass,
      )}
    >
      <NodeHeader className="bg-neutral-500/5">
        <NodeHeaderIcon className={kindIconClass.end}>
          <Flag />
        </NodeHeaderIcon>
        <NodeHeaderTitle className="text-sm">
          {data.label || "End"}
          {overlay.visitCount !== undefined && (
            <VisitCountPill visitCount={overlay.visitCount} />
          )}
        </NodeHeaderTitle>
        {headerStatus && <NodeHeaderStatus status={headerStatus} />}
      </NodeHeader>
      <p className="text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        end
      </p>
      <TargetHandle />
      <NodeErrorBadge count={errorCount} />
    </BaseNode>
  );
}

// ── nodeTypes registry ────────────────────────────────────────────────────────

/**
 * Maps each loop node to its component.
 * React Flow requires a single type key. We use "loopNode" and dispatch
 * on data.kind inside a wrapper.
 */
function LoopNodeDispatcher(props: NodeProps<LoopFlowNode>) {
  const kind = props.data?.kind;
  switch (kind) {
    case "start":
      return <StartNodeComponent {...(props as StartNodeProps)} />;
    case "agent_step":
      return <AgentStepNodeComponent {...(props as AgentStepNodeProps)} />;
    case "github_check":
      return <GithubCheckNodeComponent {...(props as GithubCheckNodeProps)} />;
    case "condition":
      return <ConditionNodeComponent {...(props as ConditionNodeProps)} />;
    case "end":
      return <EndNodeComponent {...(props as EndNodeProps)} />;
    default:
      return null;
  }
}

export const nodeTypes = {
  loopNode: LoopNodeDispatcher,
};
