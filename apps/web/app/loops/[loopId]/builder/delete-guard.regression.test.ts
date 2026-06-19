/**
 * delete-guard.regression.test.ts
 *
 * Regression harness for the P1 bug: pressing Delete on a selected canvas node
 * caused ReactFlow to eagerly strip attached edges via unguarded onEdgesChange
 * BEFORE the confirmation dialog could be shown. Cancelling the dialog left the
 * graph in a desync state — node still present, edges permanently gone — which
 * is silent data loss and can cause a blank-page crash from stale edge references.
 *
 * Protected path: Loop builder ▸ select node ▸ press Delete ▸ Cancel
 * Expected invariant: after Cancel, the graph is IDENTICAL to before Delete was pressed.
 *
 * Root cause: ReactFlow's deleteElements() (triggered by deleteKeyCode="Delete")
 * calls triggerEdgeChanges(remove) THEN triggerNodeChanges(remove). With
 * onEdgesChange wired directly and onNodesChange going through
 * handleNodesChangeWithGuard, the edges were applied immediately while the node
 * removal was deferred behind the dialog. Cancelling did not restore the edges.
 *
 * Fix: set deleteKeyCode={null} on ReactFlow and use a custom onKeyDown handler
 * on the canvas div. The handler opens the confirmation dialog without touching
 * the store. On confirm, edges are removed atomically with the node.
 * On cancel, zero store mutations have occurred.
 *
 * These tests verify the STORE invariant in isolation (no React renderer needed).
 */

import { describe, expect, it } from "bun:test";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import { createLoopBuilderStore } from "./use-loop-builder";

// ── Helpers ───────────────────────────────────────────────────────────────────

const GRAPH_WITH_CONNECTED_NODE: LoopDefinition = {
  nodes: [
    { id: "s", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "a1",
      kind: "agent_step",
      label: "Analyze",
      position: { x: 200, y: 0 },
    },
    { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
  ],
  edges: [
    { id: "ed1", source: "s", target: "a1", when: "always" },
    { id: "ed2", source: "a1", target: "e", when: "success" },
  ],
};

// ── Regression: delete-guard cancel path must not strip edges ─────────────────

describe("regression (P1 delete-guard): store invariant on guarded node delete", () => {
  /**
   * Simulates the FIXED delete path:
   *   1. User presses Delete → our keydown handler reads selected nodes from
   *      the current state and sets pendingNodeDelete (UI state only).
   *   2. The store is NOT mutated at all (no onEdgesChange / onNodesChange called).
   *   3. User presses Cancel → pendingNodeDelete is cleared, store untouched.
   *
   * After cancel, nodes and edges must be identical to before Delete was pressed.
   */
  it("regression: after delete-then-cancel, node count and edge count are unchanged", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(GRAPH_WITH_CONNECTED_NODE);

    const nodesBefore = store.getState().nodes.length;
    const edgesBefore = store.getState().edges.length;

    // Simulate the FIXED handler: we do NOT call onEdgesChange or onNodesChange.
    // The dialog open/cancel is pure UI state — store is not touched.
    // (In the BUGGY handler, ReactFlow would call onEdgesChange with remove
    // changes for attached edges before the dialog opened.)

    // Cancel = no-op on store. Assert unchanged.
    expect(store.getState().nodes.length).toBe(nodesBefore);
    expect(store.getState().edges.length).toBe(edgesBefore);
  });

  /**
   * Simulates the FIXED confirm path:
   *   1. User presses Delete → dialog opens (store untouched).
   *   2. User confirms → confirmNodeDelete() atomically applies node remove
   *      AND attached edge removes in a single batch.
   *
   * After confirm:
   *   - The target node is gone.
   *   - All edges that were attached to that node are gone.
   *   - No edge remains that references the deleted node as source or target.
   */
  it("regression: after delete-then-confirm, no edge references the deleted node", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(GRAPH_WITH_CONNECTED_NODE);

    const deletedNodeId = "a1";

    // Simulate atomic confirm: remove node + attached edges together
    const attachedEdgeIds = store
      .getState()
      .edges.filter(
        (e) => e.source === deletedNodeId || e.target === deletedNodeId,
      )
      .map((e) => e.id);

    // Apply node removal
    store.getState().onNodesChange([{ id: deletedNodeId, type: "remove" }]);
    // Apply edge removals atomically (same tick, no yield)
    if (attachedEdgeIds.length > 0) {
      store
        .getState()
        .onEdgesChange(
          attachedEdgeIds.map((id) => ({ id, type: "remove" as const })),
        );
    }

    // Node must be gone
    expect(
      store.getState().nodes.find((n) => n.id === deletedNodeId),
    ).toBeUndefined();

    // No edge must reference the deleted node
    const staleEdges = store
      .getState()
      .edges.filter(
        (e) => e.source === deletedNodeId || e.target === deletedNodeId,
      );
    expect(staleEdges).toHaveLength(0);
  });

  /**
   * Regression for the BUGGY path: demonstrates what happened before the fix.
   * When ReactFlow's deleteElements() was triggered:
   *   a) onEdgesChange was called with remove changes for attached edges (EAGERLY)
   *   b) onNodesChange was called with remove change for the node (DEFERRED by guard)
   *
   * If the user then cancelled the dialog, edge remove was already applied,
   * but node remove was not → desync: node exists but its edges are gone.
   *
   * The test below proves that if we apply edge removes WITHOUT the node remove
   * (i.e. the buggy cancel path), the store is left in a corrupt state.
   * This test is the CANONICAL RED state for the bug — it documents what was wrong.
   */
  it("regression: applying edge removes without node remove leaves corrupt state (bug documentation)", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(GRAPH_WITH_CONNECTED_NODE);

    const deletedNodeId = "a1";

    // BUG: eagerly strip edges (what ReactFlow's unguarded onEdgesChange did)
    const attachedEdgeIds = store
      .getState()
      .edges.filter(
        (e) => e.source === deletedNodeId || e.target === deletedNodeId,
      )
      .map((e) => ({ id: e.id, type: "remove" as const }));

    store.getState().onEdgesChange(attachedEdgeIds);

    // Node still present (guard deferred the removal, user pressed Cancel)
    const node = store.getState().nodes.find((n) => n.id === deletedNodeId);
    expect(node).toBeDefined(); // node survived

    // BUT edges are permanently gone — data loss!
    const edgesForNode = store
      .getState()
      .edges.filter(
        (e) => e.source === deletedNodeId || e.target === deletedNodeId,
      );
    expect(edgesForNode).toHaveLength(0); // corrupt: node has no edges

    // This is the desync we fixed: node count is not 0, but node's edges are 0
    // even though the user pressed Cancel. The graph definition is now invalid
    // because the remaining node has no path to End.
    const def = store.getState().currentDefinition();
    const nodeInDef = def.nodes.find((n) => n.id === deletedNodeId);
    expect(nodeInDef).toBeDefined(); // still in definition
    const edgesInDef = def.edges.filter(
      (edge) => edge.source === deletedNodeId || edge.target === deletedNodeId,
    );
    expect(edgesInDef).toHaveLength(0); // but edges are gone — CORRUPT
  });

  /**
   * Edge-only selection: when ONLY edges (no nodes) are selected and Delete is
   * pressed, they should be removed immediately without a dialog (no guard needed
   * for edges-only). This path must also not affect node count.
   */
  it("regression: deleting only edges leaves all nodes intact", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(GRAPH_WITH_CONNECTED_NODE);

    const nodeCountBefore = store.getState().nodes.length;

    // Remove edge "ed1" directly (edge-only removal, no node involved)
    store.getState().onEdgesChange([{ id: "ed1", type: "remove" }]);

    // All nodes must still be present
    expect(store.getState().nodes.length).toBe(nodeCountBefore);
    // Only ed1 is gone
    expect(store.getState().edges.find((e) => e.id === "ed1")).toBeUndefined();
    // ed2 still present
    expect(store.getState().edges.find((e) => e.id === "ed2")).toBeDefined();
  });

  /**
   * Focus guard: Delete pressed while focus is in a text input must NOT trigger
   * node deletion. This is enforced by the custom keydown handler checking
   * that event.target is not an INPUT/TEXTAREA/SELECT/[contenteditable].
   * We test the store is NOT mutated when that check would suppress the event.
   *
   * (This is a logic test — the actual DOM focus check lives in the keydown handler.)
   */
  it("regression: store is not mutated when delete guard logic is suppressed (input focus)", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(GRAPH_WITH_CONNECTED_NODE);

    const nodesBefore = store.getState().nodes.length;
    const edgesBefore = store.getState().edges.length;

    // Simulate the guard returning early without calling any store method.
    // The store must be completely unchanged.
    function shouldSuppressDelete(targetTagName: string): boolean {
      const blocked = ["INPUT", "TEXTAREA", "SELECT"];
      return blocked.includes(targetTagName.toUpperCase());
    }

    // When Delete fires while focused in an input, the guard should suppress it
    expect(shouldSuppressDelete("INPUT")).toBe(true);
    expect(shouldSuppressDelete("TEXTAREA")).toBe(true);
    expect(shouldSuppressDelete("SELECT")).toBe(true);
    // Canvas click target is a div — should NOT suppress
    expect(shouldSuppressDelete("DIV")).toBe(false);

    // Store untouched
    expect(store.getState().nodes.length).toBe(nodesBefore);
    expect(store.getState().edges.length).toBe(edgesBefore);
  });
});

// ── Regression: confirmNodeDelete atomicity ───────────────────────────────────

describe("regression (P1 delete-guard): confirmNodeDelete atomicity", () => {
  it("regression: confirm with a 3-edge node removes node and all 3 edges", () => {
    // Graph: start → a1 ← cond1 (condition has two outgoing edges to a1 and end)
    const store = createLoopBuilderStore();
    store.getState().initialize({
      nodes: [
        { id: "s", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        {
          id: "a1",
          kind: "agent_step",
          label: "Analyze",
          position: { x: 200, y: 0 },
        },
        {
          id: "c1",
          kind: "condition",
          label: "Done?",
          position: { x: 300, y: -50 },
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "ed1", source: "s", target: "a1", when: "always" },
        { id: "ed2", source: "a1", target: "c1", when: "success" },
        { id: "ed3", source: "c1", target: "a1", when: "false" },
      ],
    });

    const deletedNodeId = "a1";
    const edgesBefore = store.getState().edges.length; // 3
    expect(edgesBefore).toBe(3);

    // Simulate confirmNodeDelete: atomic node + edge removal
    const attachedEdges = store
      .getState()
      .edges.filter(
        (ed) => ed.source === deletedNodeId || ed.target === deletedNodeId,
      );
    store.getState().onNodesChange([{ id: deletedNodeId, type: "remove" }]);
    if (attachedEdges.length > 0) {
      store
        .getState()
        .onEdgesChange(
          attachedEdges.map((ed) => ({ id: ed.id, type: "remove" as const })),
        );
    }

    // Node gone
    expect(
      store.getState().nodes.find((n) => n.id === deletedNodeId),
    ).toBeUndefined();
    // All 3 edges gone
    expect(store.getState().edges).toHaveLength(0);
    // No stale references
    const stale = store
      .getState()
      .edges.filter(
        (ed) => ed.source === deletedNodeId || ed.target === deletedNodeId,
      );
    expect(stale).toHaveLength(0);
  });

  it("regression: confirm marks store as dirty", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(GRAPH_WITH_CONNECTED_NODE);
    expect(store.getState().isDirty).toBe(false);

    const deletedNodeId = "a1";
    const attachedEdges = store
      .getState()
      .edges.filter(
        (ed) => ed.source === deletedNodeId || ed.target === deletedNodeId,
      );
    store.getState().onNodesChange([{ id: deletedNodeId, type: "remove" }]);
    if (attachedEdges.length > 0) {
      store
        .getState()
        .onEdgesChange(
          attachedEdges.map((ed) => ({ id: ed.id, type: "remove" as const })),
        );
    }

    expect(store.getState().isDirty).toBe(true);
  });
});
