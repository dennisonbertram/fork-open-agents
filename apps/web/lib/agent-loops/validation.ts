/**
 * Agent Loops — graph validation
 *
 * validateLoopDefinition(definition: unknown) returns a discriminated result:
 *   { ok: true; definition: LoopDefinition }
 * or
 *   { ok: false; errors: LoopValidationError[] }
 *
 * NEVER throws — all errors are returned as typed values.
 *
 * Rules enforced (each produces a named error kind for inline M2 builder errors):
 *   VR-01  Exactly one start node
 *   VR-02  At least one end node
 *   VR-03  All edge endpoints reference existing node ids
 *   VR-04  Every non-end node has ≥1 outgoing edge
 *   VR-05  Condition nodes have both true and false outgoing edges
 *   VR-06  Non-condition nodes may not use true/false when values
 *   VR-07  No duplicate (source, when) pairs
 *   VR-08  end is reachable from start (BFS)
 *   VR-09  Cycles are explicitly legal (no rule — they are positively accepted)
 *   VR-10  Definition size cap (64KB serialized)
 *   VR-11  Forbidden node ids (__proto__, constructor, prototype, trigger)
 *   VR-12  github_check node requires check config
 *   VR-13  condition node requires condition config
 *   VR-14  condition ops other than exists require value
 *   VR-15  Structural zod validation
 *   VR-17  No duplicate node ids within a definition
 *   VR-18  Condition node outgoing edges must only use true/false when values
 *
 * No eval, no RegExp expression parsing, no I/O, no DB.
 */

import type { LoopDefinition, LoopNode, LoopValidationError } from "./types";
import { loopDefinitionSchema } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFINITION_SIZE_CAP_BYTES = 64 * 1024; // 64KB

/**
 * "trigger" is reserved because the dispatcher bridge seeds
 * `run.context.trigger` at run creation (#765) — a node id of "trigger" would
 * collide with that context key and make refFrom/condition path lookups
 * ambiguous. "start" is intentionally NOT reserved: every shipped template
 * uses "start" as its literal start-node id, and there is no run.context key
 * named "start" for it to collide with.
 */
const FORBIDDEN_NODE_IDS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "trigger",
]);

/** Ops that do NOT require a value field. */
const VALUE_EXEMPT_OPS = new Set(["exists"]);

// ── Public API ─────────────────────────────────────────────────────────────────

export type ValidateLoopDefinitionResult =
  | { ok: true; definition: LoopDefinition }
  | { ok: false; errors: LoopValidationError[] };

/**
 * Parses and validates an unknown loop definition.
 *
 * Returns a discriminated union. Never throws.
 */
export function validateLoopDefinition(
  definition: unknown,
): ValidateLoopDefinitionResult {
  // VR-10: size cap check before zod parse (cheap string serialization)
  try {
    const serialized = JSON.stringify(definition);
    if (
      serialized !== undefined &&
      serialized.length > DEFINITION_SIZE_CAP_BYTES
    ) {
      return {
        ok: false,
        errors: [
          {
            kind: "loop_invalid",
            rule: "definition_too_large",
            message: `Loop definition exceeds the 64KB size cap (${serialized.length} bytes). Reduce the number of nodes, edges, or per-node config.`,
            byteSize: serialized.length,
          },
        ],
      };
    }
  } catch {
    // JSON.stringify can throw on circular refs; fall through to zod which will
    // catch other structural issues.
  }

  // VR-15: structural zod validation
  const parseResult = loopDefinitionSchema.safeParse(definition);
  if (!parseResult.success) {
    return {
      ok: false,
      errors: [
        {
          kind: "loop_invalid",
          rule: "schema_error",
          message: `Invalid loop definition structure: ${parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        },
      ],
    };
  }

  const def = parseResult.data;
  const errors: LoopValidationError[] = [];

  // VR-17: no duplicate node ids — checked before building nodeMap so that all
  // downstream rules operate on a structurally valid id set. Two nodes sharing
  // an id would silently collapse in the map (the second overwrites the first),
  // causing VR-01/VR-02 counts, VR-04 outgoing-edge checks, and VR-08 BFS to
  // produce misleading results.
  const seenNodeIds = new Map<string, LoopNode>();
  for (const node of def.nodes) {
    const existing = seenNodeIds.get(node.id);
    if (existing !== undefined) {
      errors.push({
        kind: "loop_invalid",
        rule: "duplicate_node_id",
        message: `Duplicate node id "${node.id}" (kinds: ${existing.kind}, ${node.kind}). Node ids must be unique within a definition.`,
        nodeId: node.id,
      });
    } else {
      seenNodeIds.set(node.id, node);
    }
  }

  // Build node map for fast lookup. We intentionally use Map (not a plain
  // object) to avoid prototype-pollution risks.
  const nodeMap = new Map<string, LoopNode>();
  for (const node of def.nodes) {
    nodeMap.set(node.id, node);
  }

  // VR-11: forbidden node ids
  for (const node of def.nodes) {
    if (FORBIDDEN_NODE_IDS.has(node.id)) {
      errors.push({
        kind: "loop_invalid",
        rule: "forbidden_node_id",
        message: `Node id "${node.id}" is forbidden (prototype-pollution-safe key restriction).`,
        nodeId: node.id,
      });
    }
  }

  // VR-01: exactly one start node
  const startNodes = def.nodes.filter((n) => n.kind === "start");
  if (startNodes.length === 0) {
    errors.push({
      kind: "loop_invalid",
      rule: "no_start",
      message: "Loop definition must have exactly one start node; found none.",
    });
  } else if (startNodes.length > 1) {
    errors.push({
      kind: "loop_invalid",
      rule: "multiple_start",
      message: `Loop definition must have exactly one start node; found ${startNodes.length}: ${startNodes.map((n) => n.id).join(", ")}.`,
      nodeIds: startNodes.map((n) => n.id),
    });
  }

  // VR-02: at least one end node
  const endNodes = def.nodes.filter((n) => n.kind === "end");
  if (endNodes.length === 0) {
    errors.push({
      kind: "loop_invalid",
      rule: "no_end",
      message: "Loop definition must have at least one end node; found none.",
    });
  }

  // VR-03: all edge endpoints reference existing node ids
  for (const edge of def.edges) {
    if (!nodeMap.has(edge.source)) {
      errors.push({
        kind: "loop_invalid",
        rule: "dangling_edge",
        message: `Edge "${edge.id}" references unknown source node "${edge.source}".`,
        edgeId: edge.id,
      });
    }
    if (!nodeMap.has(edge.target)) {
      errors.push({
        kind: "loop_invalid",
        rule: "dangling_edge",
        message: `Edge "${edge.id}" references unknown target node "${edge.target}".`,
        edgeId: edge.id,
      });
    }
  }

  // Build outgoing edges map for subsequent rules
  const outgoingEdges = new Map<string, typeof def.edges>();
  for (const node of def.nodes) {
    outgoingEdges.set(node.id, []);
  }
  for (const edge of def.edges) {
    const existing = outgoingEdges.get(edge.source);
    if (existing !== undefined) {
      existing.push(edge);
    }
  }

  // VR-04: every non-end node has ≥1 outgoing edge
  for (const node of def.nodes) {
    if (node.kind === "end") continue;
    const outs = outgoingEdges.get(node.id) ?? [];
    if (outs.length === 0) {
      errors.push({
        kind: "loop_invalid",
        rule: "no_outgoing_edge",
        message: `Node "${node.id}" (kind: ${node.kind}) has no outgoing edges. Every non-end node must have at least one.`,
        nodeId: node.id,
      });
    }
  }

  // VR-05: condition nodes must have both true and false outgoing edges
  // VR-06: non-condition nodes may not use true/false when values
  // VR-18: condition nodes may only use true/false when values (no success/failure/always)
  for (const node of def.nodes) {
    const outs = outgoingEdges.get(node.id) ?? [];
    if (node.kind === "condition") {
      const trueEdge = outs.find((e) => e.when === "true");
      const falseEdge = outs.find((e) => e.when === "false");
      if (!trueEdge) {
        errors.push({
          kind: "loop_invalid",
          rule: "missing_condition_edge",
          message: `Condition node "${node.id}" is missing a "true" outgoing edge.`,
          nodeId: node.id,
          branch: "true",
        });
      }
      if (!falseEdge) {
        errors.push({
          kind: "loop_invalid",
          rule: "missing_condition_edge",
          message: `Condition node "${node.id}" is missing a "false" outgoing edge.`,
          nodeId: node.id,
          branch: "false",
        });
      }
      // VR-18: every outgoing edge from a condition node must use true or false;
      // success/failure/always edges are dead routing because the runtime edge
      // evaluator (M1-03) only dispatches condition outcomes via true/false.
      for (const edge of outs) {
        if (edge.when !== "true" && edge.when !== "false") {
          errors.push({
            kind: "loop_invalid",
            rule: "invalid_condition_edge",
            message: `Edge "${edge.id}" uses when="${edge.when}" on condition node "${node.id}". Condition nodes may only have true/false outgoing edges; the runtime evaluator never traverses other when values.`,
            edgeId: edge.id,
          });
        }
      }
    } else {
      // Non-condition nodes may not use true/false
      for (const edge of outs) {
        if (edge.when === "true" || edge.when === "false") {
          errors.push({
            kind: "loop_invalid",
            rule: "invalid_when",
            message: `Edge "${edge.id}" uses when="${edge.when}" but its source node "${node.id}" (kind: ${node.kind}) is not a condition node. Use success/failure/always instead.`,
            edgeId: edge.id,
          });
        }
      }
    }
  }

  // VR-07: no duplicate (source, when) pairs
  for (const node of def.nodes) {
    const outs = outgoingEdges.get(node.id) ?? [];
    const seenWhen = new Map<string, string[]>(); // when → edge ids
    for (const edge of outs) {
      const ids = seenWhen.get(edge.when);
      if (ids === undefined) {
        seenWhen.set(edge.when, [edge.id]);
      } else {
        ids.push(edge.id);
      }
    }
    for (const [when, edgeIds] of seenWhen) {
      if (edgeIds.length > 1) {
        errors.push({
          kind: "loop_invalid",
          rule: "duplicate_when",
          message: `Node "${node.id}" has ${edgeIds.length} outgoing edges with when="${when}": ${edgeIds.join(", ")}. Each (source, when) pair must be unique.`,
          sourceNodeId: node.id,
          when,
          edgeIds,
        });
      }
    }
  }

  // VR-12: github_check node requires check config
  for (const node of def.nodes) {
    if (node.kind === "github_check") {
      if (!node.check) {
        errors.push({
          kind: "loop_invalid",
          rule: "missing_node_config",
          message: `Node "${node.id}" (kind: github_check) is missing required "check" config.`,
          nodeId: node.id,
          nodeKind: "github_check",
        });
      }
    }
    // VR-13: condition node requires condition config
    if (node.kind === "condition") {
      if (!node.condition) {
        errors.push({
          kind: "loop_invalid",
          rule: "missing_node_config",
          message: `Node "${node.id}" (kind: condition) is missing required "condition" config.`,
          nodeId: node.id,
          nodeKind: "condition",
        });
      } else {
        // VR-14: condition ops other than exists require value
        if (
          !VALUE_EXEMPT_OPS.has(node.condition.op) &&
          node.condition.value === undefined
        ) {
          errors.push({
            kind: "loop_invalid",
            rule: "missing_condition_value",
            message: `Node "${node.id}" has condition op="${node.condition.op}" which requires a "value" field (only "exists" is exempt).`,
            nodeId: node.id,
          });
        }
      }
    }
  }

  // VR-08: end is reachable from start (BFS)
  // Only run if we have exactly one start and at least one end (otherwise the
  // earlier rules already flagged those; avoid misleading second errors).
  if (startNodes.length === 1 && endNodes.length >= 1) {
    const startNodeId = startNodes[0]!.id;
    const endNodeIds = new Set(endNodes.map((n) => n.id));
    const visited = new Set<string>();
    const queue: string[] = [startNodeId];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const outs = outgoingEdges.get(nodeId) ?? [];
      for (const edge of outs) {
        if (!visited.has(edge.target)) {
          queue.push(edge.target);
        }
      }
    }

    const anyEndReachable = [...endNodeIds].some((id) => visited.has(id));
    if (!anyEndReachable) {
      errors.push({
        kind: "loop_invalid",
        rule: "end_unreachable",
        message:
          "No end node is reachable from the start node. Check the graph for disconnected branches or infinite cycles with no exit.",
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, definition: def };
}
