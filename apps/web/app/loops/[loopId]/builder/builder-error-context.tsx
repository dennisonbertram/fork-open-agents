"use client";

/**
 * builder-error-context.tsx — React context providing the nodeErrorsById map
 * to loop-nodes.tsx so error badges can render without threading props through
 * React Flow's nodeTypes.
 */

import { createContext, useContext } from "react";
import type { LoopValidationError } from "@/lib/agent-loops/types";

export type NodeErrorsMap = Record<string, LoopValidationError[]>;

export const BuilderErrorContext = createContext<NodeErrorsMap>({});

export function useNodeErrors(nodeId: string): LoopValidationError[] {
  const map = useContext(BuilderErrorContext);
  return map[nodeId] ?? [];
}
