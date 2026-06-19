import { describe, expect, it } from "bun:test";
import {
  computeLoopFrames,
  type FrameEdge,
  type FrameNode,
} from "./loop-frames";

// start → implement → review → gate ⇄ fix (gate.false→fix, fix→review back-edge)
const NODES: FrameNode[] = [
  { id: "start", kind: "start", x: 0, y: 0 },
  { id: "implement", kind: "agent_step", x: 300, y: 0 },
  { id: "review", kind: "agent_step", x: 600, y: 0 },
  {
    id: "gate",
    kind: "condition",
    x: 900,
    y: 0,
    condition: { path: "review.passed", op: "eq", value: true },
  },
  { id: "fix", kind: "agent_step", x: 600, y: 220 },
  { id: "end", kind: "end", x: 1200, y: 0 },
];
const EDGES: FrameEdge[] = [
  { source: "start", target: "implement" },
  { source: "implement", target: "review" },
  { source: "review", target: "gate" },
  { source: "gate", target: "end" },
  { source: "gate", target: "fix" },
  { source: "fix", target: "review" }, // back-edge
];

describe("computeLoopFrames", () => {
  it("detects exactly one loop frame for the review↔fix cycle", () => {
    const frames = computeLoopFrames(NODES, EDGES);
    expect(frames).toHaveLength(1);
  });

  it("the frame's label names the gate condition", () => {
    const [frame] = computeLoopFrames(NODES, EDGES);
    expect(frame?.label).toContain("review.passed eq true");
    expect(frame?.label.toLowerCase()).toContain("loop");
  });

  it("the frame's box encloses the cycle nodes (review, gate, fix)", () => {
    const [frame] = computeLoopFrames(NODES, EDGES);
    if (!frame) throw new Error("no frame");
    // review/gate/fix span x:600..900 (+node width), y:0..220 — box must cover it
    expect(frame.x).toBeLessThanOrEqual(600);
    expect(frame.y).toBeLessThanOrEqual(0);
    expect(frame.x + frame.width).toBeGreaterThanOrEqual(900 + 200);
    expect(frame.y + frame.height).toBeGreaterThanOrEqual(220 + 120);
  });

  it("a purely linear graph has no loop frames", () => {
    const linear: FrameEdge[] = [
      { source: "start", target: "implement" },
      { source: "implement", target: "review" },
      { source: "review", target: "end" },
    ];
    expect(computeLoopFrames(NODES, linear)).toHaveLength(0);
  });

  it("returns [] for an empty graph", () => {
    expect(computeLoopFrames([], [])).toHaveLength(0);
  });
});
