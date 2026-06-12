"use client";

// STUB — implementation will be added in the green commit

export function buildSwrKey(_loopId: string, _expanded: boolean): string | null {
  // TODO: implement
  return null;
}

export function LoopRunPreviewCollapsed(_props: { loopId: string }) {
  return null;
}

export function LoopRunPreviewExpanded(_props: { loopId: string }) {
  return null;
}

export function LoopRunPreviewBody(_props: {
  loopId: string;
  isLoading: boolean;
  runs: Array<{ id: string; status: string; startedAt: string | null; finishedAt: string | null; createdAt: string }> | undefined;
  error: Error | undefined;
}) {
  return null;
}

export function LoopRunPreview(_props: { loopId: string }) {
  return null;
}
