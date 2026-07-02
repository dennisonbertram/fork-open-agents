/**
 * output-refs.ts — make loop data flow explicit (B-P3).
 *
 * Each agent_step writes JSON to /tmp/loop-step-output.json, stored as
 * context[nodeId]. A step's `outputSchema` declares the fields it produces;
 * downstream nodes reference them as `context.<nodeId>.<field>` (conditions use
 * the bare `<nodeId>.<field>` path).
 *
 * These pure helpers surface that contract: the declared field names of a step,
 * and the `<nodeId>.<field>` references available to a given node (from its
 * upstream/ancestor steps).
 */

import { isFlatOutputSchema } from "./output-schema-shape";
import type { JsonSchemaLite, LoopDefinition } from "./types";

/**
 * Declared output field names of a step, for both supported outputSchema
 * shapes (see isFlatOutputSchema for the shape-detection rule):
 *   - flat map: top-level keys, skipping $-meta (e.g. { passed: "boolean" }).
 *   - JSON-Schema-Lite: keys of the `properties` object, if present
 *     (e.g. { type: "object", properties: { passed: { type: "boolean" } } }).
 */
export function outputFieldNames(schema: JsonSchemaLite | undefined): string[] {
  if (!schema || typeof schema !== "object") return [];

  if (isFlatOutputSchema(schema)) {
    return Object.keys(schema).filter((k) => !k.startsWith("$"));
  }

  const properties = schema["properties"];
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    return Object.keys(properties as Record<string, unknown>);
  }
  return [];
}

/**
 * `<nodeId>.<field>` references available to `forNodeId`: the declared outputs
 * of every agent_step that is an ancestor (backward-reachable) of this node, so
 * the data could exist in context by the time this node runs.
 */
export function availableOutputRefs(
  def: LoopDefinition,
  forNodeId: string,
): string[] {
  // Reverse adjacency: target → sources.
  const back = new Map<string, string[]>();
  for (const edge of def.edges) {
    const list = back.get(edge.target) ?? [];
    list.push(edge.source);
    back.set(edge.target, list);
  }

  // BFS upstream (ancestors) from forNodeId.
  const ancestors = new Set<string>();
  const queue = [...(back.get(forNodeId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    for (const src of back.get(id) ?? []) queue.push(src);
  }

  const refs: string[] = [];
  for (const node of def.nodes) {
    if (node.id === forNodeId) continue;
    if (!ancestors.has(node.id)) continue;
    if (node.kind !== "agent_step") continue;
    for (const field of outputFieldNames(node.outputSchema)) {
      refs.push(`${node.id}.${field}`);
    }
  }
  return refs;
}
