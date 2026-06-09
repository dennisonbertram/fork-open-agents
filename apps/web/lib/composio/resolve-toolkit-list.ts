import "server-only";

import type { ToolSet } from "ai";
import type { ResolvedComposioTools } from "./session";

export type ResolvedToolkitListTools = Extract<
  ResolvedComposioTools,
  { status: "ready" | "off" }
>;

export type ToolkitListCacheRow = {
  id: string;
  composioSessionId: string;
};

// Stub — implementation follows in GREEN phase
export async function resolveComposioToolsForToolkitList(_params: {
  userId: string;
  slugs: string[];
  composio: {
    create: (userId: string, config: unknown) => Promise<{ sessionId: string; tools: () => Promise<ToolSet> }>;
    use: (sessionId: string) => Promise<{ tools: () => Promise<ToolSet> }>;
  };
  connectedAccountIdsByToolkit: Record<string, string[]>;
  getCachedSession: (configHash: string) => Promise<ToolkitListCacheRow | null>;
  upsertSession: (data: { composioSessionId: string; configHash: string }) => Promise<{ id: string }>;
  touchSession: (id: string) => Promise<void>;
}): Promise<ResolvedComposioTools> {
  // Stub: always returns off so tests can fail meaningfully
  return { status: "off" };
}
