"use client";

/**
 * error-indicator.tsx — Popover-triggered badge in the canvas top-right Panel
 * listing structured validation errors. Clicking an error selects and centers
 * the offending node via fitView.
 */

import { useReactFlow } from "@xyflow/react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { LoopValidationError } from "@/lib/agent-loops/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type ErrorIndicatorProps = {
  errors: LoopValidationError[];
};

function nodeIdFromError(error: LoopValidationError): string | undefined {
  switch (error.rule) {
    case "no_outgoing_edge":
    case "missing_condition_edge":
    case "missing_node_config":
    case "missing_condition_value":
    case "forbidden_node_id":
    case "duplicate_node_id":
      return error.nodeId;
    case "multiple_start":
      return error.nodeIds[0];
    default:
      return undefined;
  }
}

function edgeIdFromError(error: LoopValidationError): string | undefined {
  switch (error.rule) {
    case "dangling_edge":
    case "invalid_when":
    case "invalid_condition_edge":
      return error.edgeId;
    default:
      return undefined;
  }
}

export function ErrorIndicator({ errors }: ErrorIndicatorProps) {
  const { fitView, setNodes, setEdges } = useReactFlow();

  function handleErrorClick(error: LoopValidationError) {
    const nodeId = nodeIdFromError(error);
    const edgeId = edgeIdFromError(error);

    if (nodeId) {
      setNodes((nodes) =>
        nodes.map((n) => ({ ...n, selected: n.id === nodeId })),
      );
      fitView({ nodes: [{ id: nodeId }], duration: 400, maxZoom: 1.5 });
    } else if (edgeId) {
      setEdges((edges) =>
        edges.map((e) => ({ ...e, selected: e.id === edgeId })),
      );
    }
  }

  if (errors.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-3.5" />
        Valid
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "nodrag flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
            "border-red-500/25 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300",
          )}
        >
          <AlertTriangle className="size-3.5" />
          {errors.length} {errors.length === 1 ? "error" : "errors"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" side="bottom">
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-medium text-foreground">
            Validation errors ({errors.length})
          </p>
        </div>
        <div className="max-h-64 overflow-y-auto divide-y divide-border">
          {errors.map((error, i) => {
            const nodeId = nodeIdFromError(error);
            const edgeId = edgeIdFromError(error);
            const isClickable = Boolean(nodeId ?? edgeId);
            return (
              <button
                key={`${error.rule}-${i}`}
                type="button"
                className={cn(
                  "nodrag w-full px-3 py-2 text-left text-xs transition-colors",
                  isClickable
                    ? "hover:bg-muted/50 cursor-pointer"
                    : "cursor-default",
                )}
                onClick={() => isClickable && handleErrorClick(error)}
              >
                <p className="font-mono text-[10px] text-muted-foreground">
                  {error.rule}
                  {nodeId && ` · ${nodeId}`}
                  {edgeId && ` · ${edgeId}`}
                </p>
                <p className="mt-0.5 text-foreground leading-snug">
                  {error.message}
                </p>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
