/**
 * loop-frames.ts — pure detection of "loop regions" in a builder graph.
 *
 * A cycle (a back-edge that returns to an earlier node) is hard to read as a
 * loop on a left-to-right canvas. computeLoopFrames finds each cycle's member
 * nodes and returns a bounding box + a human label (from the cycle's condition
 * node) so the builder can draw an explicit "🔁 Loop" frame around it.
 *
 * Pure: no React, no React Flow types — unit-testable with plain objects.
 */

export type FrameNode = {
  id: string;
  kind: string;
  x: number;
  y: number;
  condition?: { path: string; op: string; value?: unknown };
};

export type FrameEdge = { source: string; target: string };

export type LoopFrame = {
  /** Stable id (sorted member ids) so React keys are stable across renders. */
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

// Approximate node footprint (loop-nodes.tsx: min-w-140 / max-w-200) + padding.
const NODE_W = 210;
const NODE_H = 130;
const PAD = 30;
const LABEL_GAP = 22;

function bfsReachable(
  start: string,
  adjacency: Map<string, string[]>,
): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const next of adjacency.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

function describeCondition(node: FrameNode | undefined): string {
  if (!node?.condition) return "the exit condition is met";
  const { path, op, value } = node.condition;
  if (op === "exists") return `${path} exists`;
  return `${path} ${op} ${value === undefined ? "…" : String(value)}`;
}

/**
 * Find loop regions. For each back-edge (target sits at an earlier BFS depth than
 * source), the cycle members are the nodes both forward-reachable from the
 * back-edge target AND able to reach the back-edge source. Returns one frame per
 * distinct cycle.
 */
export function computeLoopFrames(
  nodes: FrameNode[],
  edges: FrameEdge[],
): LoopFrame[] {
  if (nodes.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const e of edges) {
    (forward.get(e.source) ?? forward.set(e.source, []).get(e.source))?.push(
      e.target,
    );
    (backward.get(e.target) ?? backward.set(e.target, []).get(e.target))?.push(
      e.source,
    );
  }

  // BFS depth from start.
  const start = nodes.find((n) => n.kind === "start") ?? nodes[0]!;
  const depth = new Map<string, number>([[start.id, 0]]);
  const dq = [start.id];
  while (dq.length > 0) {
    const id = dq.shift() as string;
    const d = depth.get(id) ?? 0;
    for (const nxt of forward.get(id) ?? []) {
      if (!depth.has(nxt)) {
        depth.set(nxt, d + 1);
        dq.push(nxt);
      }
    }
  }

  const seenCycles = new Set<string>();
  const frames: LoopFrame[] = [];

  for (const e of edges) {
    const ds = depth.get(e.source);
    const dt = depth.get(e.target);
    if (ds === undefined || dt === undefined || dt >= ds) continue; // not a back-edge

    const fromTarget = bfsReachable(e.target, forward);
    const canReachSource = bfsReachable(e.source, backward);
    const members = new Set<string>([e.source, e.target]);
    for (const id of fromTarget) {
      if (canReachSource.has(id)) members.add(id);
    }

    const key = Array.from(members).sort().join("|");
    if (seenCycles.has(key)) continue;
    seenCycles.add(key);

    const memberNodes = Array.from(members)
      .map((id) => byId.get(id))
      .filter((n): n is FrameNode => n !== undefined);
    if (memberNodes.length === 0) continue;

    const minX = Math.min(...memberNodes.map((n) => n.x));
    const minY = Math.min(...memberNodes.map((n) => n.y));
    const maxX = Math.max(...memberNodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(...memberNodes.map((n) => n.y + NODE_H));

    const gate = memberNodes.find((n) => n.kind === "condition");
    frames.push({
      id: key,
      x: minX - PAD,
      y: minY - PAD - LABEL_GAP,
      width: maxX - minX + PAD * 2,
      height: maxY - minY + PAD * 2 + LABEL_GAP,
      label: `Loop · repeats until ${describeCondition(gate)}`,
    });
  }

  return frames;
}
