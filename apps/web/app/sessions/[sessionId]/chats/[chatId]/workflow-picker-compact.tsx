"use client";

import { Workflow } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import type { WorkflowCatalogEntry } from "@/app/api/workflows/catalog/route";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
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
 * Renders the list of workflow items as plain HTML buttons with full
 * accessibility markup (role="menuitemradio", aria-checked, aria-disabled).
 *
 * This is the SINGLE source of truth for item rendering. WorkflowPickerCompact
 * renders its menu items exclusively through this component — there is no
 * duplicated Radix DropdownMenuRadioGroup item block.
 *
 * Exported as a pure presenter so tests can assert item names, disabled
 * reasons, aria-checked states, and disabled markers via renderToStaticMarkup
 * without needing the Radix DropdownMenu portal context.
 *
 * Note: selection-only contract — there is no deselect affordance. Once a
 * workflow is selected, the user selects a different one to change it. This
 * keeps the v1 surface minimal; a deselect option can be added in v2 if needed.
 *
 * Note on click simulation: renderToStaticMarkup produces static HTML with no
 * DOM event handlers. Click behavior is verified by calling onSelect directly
 * in tests. The static markup tests (disabled, aria-checked, disabledReason)
 * cover all user-visible properties of the items.
 */
export function WorkflowPickerItems({
  workflows,
  selectedId,
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
            aria-checked={workflow.id === selectedId}
            aria-disabled={!workflow.available}
            disabled={!workflow.available}
            onClick={() => {
              if (workflow.available) {
                onSelect(workflow.id);
              }
            }}
            role="menuitemradio"
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
 *
 * Renders menu items exclusively via WorkflowPickerItems (the tested presenter).
 * The menu is open-state controlled so handleSelect can close it after selection.
 */
export function WorkflowPickerCompact({
  disabled = false,
  selectedWorkflowId = null,
  onSelectWorkflow,
}: WorkflowPickerCompactProps) {
  const [open, setOpen] = useState(false);

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

  function handleSelect(id: string | null) {
    onSelectWorkflow?.(id);
    setOpen(false);
  }

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
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
        <WorkflowPickerItems
          onSelect={handleSelect}
          selectedId={selectedWorkflowId ?? null}
          workflows={workflows}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
