# Loop Builder — Usability Verdict (re-walked on `develop`)

**Date:** 2026-06-13
**Target:** http://localhost:3007 (worktree on `origin/develop`, HEAD `fca20bca`)
**Why this exists:** The first audit ran against `fix/stall-sweep-date-bind`, a branch **141 commits behind `develop`** that predates the visual builder. That audit's "raw-JSON-only, no builder" framing was **wrong**. This re-walk uses the real, shipped builder (`@xyflow/react`) at `/loops/[loopId]/builder`.

## Question: is the node workflow builder intuitive?

**Verdict: The builder is well-built but not intuitive for first-time loop authoring. The individual pieces are good; the *assembly gestures* — add a node, then connect it — are where it breaks down.**

It looks professional (color-coded node cards, icons, live `Valid` badge, minimap, zoom/fit). But the moment a new user tries to *build*, three things go wrong in sequence — all reproduced live.

### The failure sequence (reproduced live)

1. **Add a node → you get a disconnected orphan.** Clicking "Agent step" took the canvas from **4 nodes / 4 edges → 5 nodes / 4 edges**. The new node is floating, unconnected, with a generic "Agent step" label and no config panel. (`F-BUILD-01`)
2. **…which instantly throws an error you can't read.** The header flipped from green **"Valid"** to red **"1 error" + "Unsaved changes"** the instant the node appeared. The "1 error" badge isn't expandable — it never says *what's* wrong or *which* node; only a tiny red "1" sits on the orphan. One click → unexplained error state. (`F-BUILD-02`)
3. **…and the only way to fix it is a gesture nobody told you about.** Connecting is **drag-from-handle only** (`onConnect`). There's no click-to-connect, no auto-connect, and no hint to drag the 16px handle dots. This is the classic React Flow discoverability cliff and is almost certainly the core of "it's not intuitive." (`F-BUILD-03`)

### Compounding issues
- **New nodes land at viewport center**, so they can sit *under the minimap* or overlap the chain (observed). (`F-BUILD-04`)
- **The one onboarding hint is dead code.** "Add steps from the palette, connect them, then Save" only renders when `nodes.length === 0`, but loops are seeded with start+end / created with a start→end stub — so the canvas is never empty and the hint never shows. (`F-BUILD-05`)
- **Create and build are split.** You create a loop in the **JSON form** at `/loops/new`, then must find an **"Open builder"** button on the *detail* page. A first-timer creating a loop lands in raw JSON and may never discover the builder. (`F-BUILD-06`)
- **A magic data contract hides in fine print:** the agent-step Instructions note "write JSON to `/tmp/loop-step-output.json` to pass output to downstream nodes." Undiscoverable except by reading that line. (`F-BUILD-07`)

### What's genuinely good (keep it)
- **Loop settings panel: all four guardrails are editable** (max steps / max iterations / max run duration / step timeout) with excellent inline copy ("Default: 10. Server enforces a ceiling of 50."), plus a **Watchdog** feature (agent diagnoses a failed step, can retry/skip/pause, with instructions + retry budget). *(This overturns the earlier "guardrails are API-only" finding.)*
- **Node config panel** is clean and well-described (Node ID read-only + copy, Label, Instructions, Check command with `e.g. bun test`).
- **WhenPicker** on edge creation filters legal `when` values by source kind (condition → true/false; others → success/failure/always) — a good pattern, *once you manage to draw the edge*.
- **Live validation** (`Valid` / `N error`) and standard canvas controls.

## Highest-impact fixes (in priority order)
1. **Make "add" produce a connected node.** Auto-connect a new node to the currently-selected node (or to the nearest upstream node), or drop it into the selected edge ("insert step here"). Kills the orphan + instant-error problem in one move. (`F-BUILD-01`, `F-BUILD-02`)
2. **Teach the connect gesture.** Show a persistent hint and make handles obvious on hover (pulse/enlarge), and/or add a click-source→click-target fallback. (`F-BUILD-03`)
3. **Make the error actionable.** The header badge should name the node and the fix ("Agent step is not connected"); clicking it should focus/zoom that node. (`F-BUILD-02`)
4. **Unify create → build.** Let "New loop" create a blank loop and drop the user straight into the builder; keep JSON as an "advanced/import" tab. (`F-BUILD-06`)
5. **Place new nodes in clear space** (offset from the last node, never under the minimap). (`F-BUILD-04`)

## Evidence
- `stories/builder/screenshots/builder-initial.png` — clean first impression
- `stories/builder/screenshots/after-add-agent-node.png` — orphan node + "1 error" after one click
- `stories/builder/screenshots/node-config-panel.png` — the (good) node config panel
- `stories/builder/screenshots/loop-settings-panel.png` — guardrails + watchdog, all editable
- `stories/builder/findings.json` — 7 findings + 1 positive
