"use client";

import { Workflow } from "lucide-react";
import useSWR from "swr";
import type { WorkflowCatalogEntry } from "@/app/api/workflows/catalog/route";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkflowPickerItemsProps {
  workflows: WorkflowCatalogEntry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export interface WorkflowPickerCompactProps {
  disabled?: boolean;
  selectedWorkflowId?: string | null;
  onSelectWorkflow?: (id: string | null) => void;
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchWorkflowCatalog(
  url: string,
): Promise<{ workflows: WorkflowCatalogEntry[] }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load workflow catalog");
  }
  return (await response.json()) as { workflows: WorkflowCatalogEntry[] };
}

// ── Pure presenter (exported for testability) ─────────────────────────────────

/**
 * Renders the list of workflow items as plain HTML list elements.
 * Exported as a pure presenter so tests can assert item names, disabled
 * reasons, and disabled markers via renderToStaticMarkup without needing
 * the Radix DropdownMenu portal context.
 *
 * When used inside WorkflowPickerCompact, the onSelect callback is wired
 * into the DropdownMenuRadioGroup instead (to get native Radix selection).
 */
export function WorkflowPickerItems({
  workflows,
  onSelect,
}: WorkflowPickerItemsProps) {
  return (
    <ul role="group" aria-label="Workflow options">
      {workflows.map((workflow) => (
        <li
          data-disabled={!workflow.available}
          data-workflow-id={workflow.id}
          key={workflow.id}
        >
          <button
            disabled={!workflow.available}
            onClick={() => {
              if (workflow.available) {
                onSelect(workflow.id);
              }
            }}
            type="button"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{workflow.name}</span>
                <span className="text-muted-foreground shrink-0 text-[11px]">
                  {workflow.proofLevel}
                </span>
              </span>
              {!workflow.available && workflow.disabledReason ? (
                <span className="text-muted-foreground max-w-[16rem] truncate text-[11px]">
                  {workflow.disabledReason}
                </span>
              ) : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Compact chip component ────────────────────────────────────────────────────

/**
 * Compact workflow picker chip for the chat composer toolbar.
 * Fetches the workflow catalog via SWR and exposes a controlled selection
 * interface. Does NOT start a run — selection is local state only.
 */
export function WorkflowPickerCompact({
  disabled = false,
  selectedWorkflowId = null,
  onSelectWorkflow,
}: WorkflowPickerCompactProps) {
  const { data, error, isLoading } = useSWR(
    "/api/workflows/catalog",
    fetchWorkflowCatalog,
  );

  const workflows = data?.workflows ?? [];
  const hasWorkflows = workflows.length > 0;
  const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId);
  const triggerLabel = selectedWorkflow?.name ?? "Workflow";

  // Trigger is disabled when: parent disabled, loading, error, or no workflows
  const isTriggerDisabled = disabled || isLoading || !!error || !hasWorkflows;

  const tooltipText = error
    ? "Workflow catalog unavailable"
    : isLoading
      ? "Loading workflows…"
      : !hasWorkflows
        ? "No workflows available"
        : "Select workflow";

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Select workflow"
              className={cn(
                "h-8 shrink-0 gap-1.5 rounded-full px-2 text-xs",
                selectedWorkflow
                  ? "border-violet-500/25 bg-violet-500/10 text-violet-700 hover:bg-violet-500/15 dark:text-violet-300"
                  : "text-muted-foreground",
              )}
              disabled={isTriggerDisabled}
              size="sm"
              type="button"
              variant={selectedWorkflow ? "outline" : "ghost"}
            >
              <Workflow className="h-3.5 w-3.5" />
              <span>{triggerLabel}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-pretty" side="top">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Workflow</DropdownMenuLabel>
        {!hasWorkflows && !isLoading ? (
          <div className="text-muted-foreground px-2 py-1.5 text-xs">
            {error ? "Failed to load workflows." : "No workflows available."}
          </div>
        ) : null}
        <DropdownMenuRadioGroup
          value={selectedWorkflowId ?? ""}
          onValueChange={(value) => {
            onSelectWorkflow?.(value === "" ? null : value);
          }}
        >
          {workflows.map((workflow) => (
            <DropdownMenuRadioItem
              className="items-start"
              disabled={!workflow.available}
              key={workflow.id}
              value={workflow.id}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{workflow.name}</span>
                  <span className="text-muted-foreground shrink-0 text-[11px]">
                    {workflow.proofLevel}
                  </span>
                </span>
                {!workflow.available && workflow.disabledReason ? (
                  <span className="text-muted-foreground max-w-[16rem] truncate text-[11px]">
                    {workflow.disabledReason}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
