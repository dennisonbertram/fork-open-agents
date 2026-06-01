"use client";

import type { WorkflowCatalogEntry } from "@/app/api/workflows/catalog/route";

// Stub — implementation pending (RED phase)

export interface WorkflowPickerItemsProps {
  workflows: WorkflowCatalogEntry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function WorkflowPickerItems(_props: WorkflowPickerItemsProps): null {
  return null;
}

export interface WorkflowPickerCompactProps {
  disabled?: boolean;
  selectedWorkflowId?: string | null;
  onSelectWorkflow?: (id: string | null) => void;
}

export function WorkflowPickerCompact(
  _props: WorkflowPickerCompactProps,
): null {
  return null;
}
