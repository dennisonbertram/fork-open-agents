# Loop builder — UX follow-ups (from live review, 2026-06-13)

Triage of the live page-review (Agentation) feedback on the loop builder. Splits
**shipped quick wins** from **architectural decisions that need alignment before
building** — several are interrelated and one (agent-nodes = background agents)
the reviewer explicitly flagged as "think deeper / worried about complexity."

## Shipped this round (PR #406)
- Sidebar: repo **Agents/Loops sub-groups render above** the branch/session list.
- `/loops/new`: repo is **fixed** when opened from a repo (picker only for a
  general new loop); back-link goes to the **repo's** loops; reset button
  relabelled "Choose a different starting point".
- Loop settings: durations entered in **minutes**, not milliseconds.

---

## Decisions needed (not yet built)

### A. Make it read as a loop  *(reviewer: "still looks like start→do→do→end")*
The violet dashed "↺ repeat" back-edge wasn't enough. Two ways forward:
- **A1 — Visual loop construct (recommended, no engine change).** Detect the
  cycle (a condition node with a back-edge) and render it as an explicit "Loop"
  affordance: a labelled boundary/bracket around the looping nodes, the gate shown
  as "🔁 Repeats while `review.passed` is false", and the back-edge routed as one
  clear loop arc. The engine already loops via the graph cycle (bounded by
  `maxIterations`), so this only makes the existing behavior legible.
- **A2 — First-class `loop` node kind (engine change).** A node with a body +
  exit condition + iteration count. Large: executor semantics, validation, types,
  builder, migration — and largely sugar over the cycle we already support.

**Recommendation: A1.** Pick A2 only if you want loops to be authored as a single
node rather than a cycle of nodes.

### B. Agent nodes ARE background agents  *(the big one)*
Reviewer: each agent_step is effectively a background agent, but the node config
is far thinner than the real background-agent builder — **no tools, no GitHub
connection** ("if I can't connect to GitHub, what's the point?"). Also: **how data
moves between nodes should be explicit** (today it's an implicit
`/tmp/loop-step-output.json` convention).

This is an architectural convergence, two parts:
- **B1 — Reuse background-agent configuration** for agent_step nodes: tool grants,
  GitHub/connector access, model — instead of a bespoke thin panel. Goal: one way
  to define "an agent that does X", used by both background agents and loop steps.
- **B2 — Explicit inter-node data flow:** a first-class "outputs → inputs" model
  (named outputs a step declares; downstream steps reference them) replacing the
  magic file path, and/or a shared run "source of truth" store the reviewer
  described ("review issues → make issues → pull issues from it").

**Recommendation: a short design spike first** (no code) — map how
`background_agents` config + tool grants relate to `agent_loop` step config, and
propose the data-flow contract. Then implement behind that design. This is the
highest-leverage and highest-complexity item; building it blind risks the
complexity the reviewer is worried about.

### C. Builder + app shell ergonomics
- **C1 — "Open panel" button overlaps the builder top bar** (a regression from
  putting the builder inside the app shell). Quick fix available: pad the builder
  top bar / reposition the floating toggle when the sidebar is collapsed.
- **C2 — Collapse should be a narrow icon rail**, not fully disappear (reviewer
  has hit this before). This is a **shared-shell change** (`SidebarProvider`
  `collapsible="offcanvas"` → `"icon"`) affecting sessions/repos/loops alike —
  coordinate, since the sidebar is under active rework.
- Open question: should the **builder be full-screen** (outside the shell) instead?
  That removes the overlap but reintroduces the "orphan page" feeling for it. C2
  (icon rail) is the better resolution if we keep it shelled.

### D. Node Instructions editor  *(reviewer: "more beautiful, larger")*
The "Expand" modal is functional but minimal. **Folded into B** — if agent_step
config becomes the background-agent builder, the instructions editor is part of
that surface, so polishing the current modal first may be throwaway.

---

## Suggested order
1. **C1** (overlap) — quick, unblocks the builder visually.
2. **A1** (visual loop construct) — directly answers the recurring "doesn't look
   like a loop", contained.
3. **B design spike** — the architectural core; align before building.
4. **C2 / D** — fold into the shell rework and the B surface respectively.
