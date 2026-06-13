/**
 * draft.ts — natural-language → LoopDefinition support.
 *
 * The "Describe your loop" feature sends a plain-English prompt to an LLM and
 * asks for a positionless graph (draftLoopSchema). We then:
 *   1. parse the model's JSON with draftLoopSchema,
 *   2. assign canvas positions with layoutDraftDefinition (BFS left-to-right),
 *   3. validate the laid-out graph with validateLoopDefinition (authoritative).
 *
 * Keeping the schema/layout/prompt here (not in the route) makes the
 * post-processing unit-testable without calling the model.
 */

import { z } from "zod";
import type { LoopDefinition, LoopNode } from "./types";

// ── Draft schema (positionless — the model never picks coordinates) ─────────────

const draftConditionSchema = z.object({
  path: z.string(),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "exists", "contains"]),
  value: z.unknown().optional(),
});

const draftNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["start", "agent_step", "github_check", "condition", "end"]),
  label: z.string().min(1),
  instructions: z.string().optional(),
  condition: draftConditionSchema.optional(),
  check: z.record(z.string(), z.unknown()).optional(),
});

const draftEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  when: z.enum(["success", "failure", "true", "false", "always"]),
});

export const draftLoopSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  nodes: z.array(draftNodeSchema).min(2),
  edges: z.array(draftEdgeSchema),
});

export type DraftLoop = z.infer<typeof draftLoopSchema>;

// ── Layout: assign positions by BFS depth from the start node ───────────────────

const COL_GAP = 340;
const ROW_GAP = 220;

/**
 * Assigns {x,y} to every node: x by graph depth from `start`, y by order within
 * a depth column. Unreachable nodes are appended in their own trailing column so
 * they still render. Pure — no validation, no I/O.
 */
export function layoutDraftDefinition(draft: DraftLoop): LoopDefinition {
  const adjacency = new Map<string, string[]>();
  for (const edge of draft.edges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }

  const startNode =
    draft.nodes.find((n) => n.kind === "start") ?? draft.nodes[0];
  const depthById = new Map<string, number>();
  if (startNode) {
    const queue: Array<{ id: string; depth: number }> = [
      { id: startNode.id, depth: 0 },
    ];
    while (queue.length > 0) {
      const { id, depth } = queue.shift() as { id: string; depth: number };
      const existing = depthById.get(id);
      if (existing !== undefined && existing <= depth) {
        continue;
      }
      depthById.set(id, depth);
      for (const next of adjacency.get(id) ?? []) {
        queue.push({ id: next, depth: depth + 1 });
      }
    }
  }

  // Unreachable nodes get parked after the deepest reachable column.
  let maxDepth = 0;
  for (const depth of depthById.values()) {
    maxDepth = Math.max(maxDepth, depth);
  }
  const rowCursor = new Map<number, number>();

  const nodes: LoopNode[] = draft.nodes.map((node) => {
    const depth = depthById.get(node.id) ?? maxDepth + 1;
    const row = rowCursor.get(depth) ?? 0;
    rowCursor.set(depth, row + 1);
    const position = { x: depth * COL_GAP, y: row * ROW_GAP };

    switch (node.kind) {
      case "start":
        return { id: node.id, kind: "start", label: node.label, position };
      case "end":
        return { id: node.id, kind: "end", label: node.label, position };
      case "condition":
        return {
          id: node.id,
          kind: "condition",
          label: node.label,
          position,
          ...(node.condition ? { condition: node.condition } : {}),
        } as LoopNode;
      case "github_check":
        return {
          id: node.id,
          kind: "github_check",
          label: node.label,
          position,
          ...(node.check ? { check: node.check } : {}),
        } as LoopNode;
      default:
        return {
          id: node.id,
          kind: "agent_step",
          label: node.label,
          position,
          ...(node.instructions ? { instructions: node.instructions } : {}),
        } as LoopNode;
    }
  });

  return { nodes, edges: draft.edges };
}

// ── Prompt ──────────────────────────────────────────────────────────────────────

export const DRAFT_SYSTEM_PROMPT = `You design "agent loops": directed graphs an autonomous coding agent walks over a GitHub repository.

Return ONLY a JSON object (no prose, no markdown fences) with this shape:
{
  "name": "<short title>",
  "description": "<one sentence>",
  "nodes": [ { "id": "...", "kind": "...", "label": "...", ...kind-specific } ],
  "edges": [ { "id": "...", "source": "...", "target": "...", "when": "..." } ]
}

Node kinds:
- "start": exactly one. The entry point.
- "agent_step": the agent runs your "instructions" in a sandbox. To pass data to later nodes it writes JSON to /tmp/loop-step-output.json; that JSON is then available as context.<thisNodeId> in downstream nodes. Reference upstream output in instructions as context.<nodeId>.<field>.
- "condition": branches on a "condition": { "path": "<nodeId>.<field>", "op": "eq|neq|gt|gte|lt|lte|exists|contains", "value": <optional> }. A condition node MUST have exactly one outgoing edge with when:"true" and one with when:"false".
- "github_check": reads GitHub state. "check" is one of {kind:"list_issues"}, {kind:"pr_status",prNumberFrom:"..."}, {kind:"ci_status",refFrom:"..."}, {kind:"deployment_status"}. Prefer agent_step unless the user clearly wants a structured GitHub read.
- "end": at least one; must be reachable from start.

Edge "when": from a normal node use "success", "failure", or "always"; from a "start" node use "always"; from a "condition" node use "true" or "false".

Rules: every non-end node needs at least one outgoing edge. Loops are allowed (e.g. a fix→review cycle): just point an edge back to an earlier node. Keep it as simple as the request allows — 2 to 6 nodes is typical. Give nodes short, human ids (review, implement, gate). Do not include "position".`;

export function buildDraftUserPrompt(description: string): string {
  return `Design a loop for this request:\n\n"${description.trim()}"\n\nReturn only the JSON object.`;
}

/** Extracts the first balanced JSON object from model text. */
export function extractJsonObject(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}
