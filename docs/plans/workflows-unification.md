# Unifying agents + loops into one concept ("Workflows")

A product-architecture assessment prompted by the loops design review. The
question: are **background agents** and **loops** actually the same thing, and
should they be one concept?

**Conclusion: yes — they are two UIs over one underlying model, and the runtime +
data model already half-encode the unification.** This doc captures the model,
the evidence, options, and a phased path. It is a direction to decide on, not a
single PR.

## The proposed model
- An **agent** is a unit of work over a repo: instructions, tools, permissions,
  a check command, an output contract. It is a **node**.
- A **workflow** is a graph of agent-nodes wired with control flow (branch /
  loop / end).
- A **single background agent is just a workflow with one node** that fires on a
  trigger.
- **Triggers fire a workflow** (1-node or many). On-demand "Run now" also runs a
  workflow.

So there are two nouns, not four: **Agents** (reusable node definitions) and
**Workflows** (agents strung together). "Loops" is not a separate thing — a loop
is a workflow with a cycle; a background agent is a workflow with one node.

## Evidence it's already half-built
- **Same runtime.** `apps/web/app/workflows/` (the Vercel Workflow DevKit
  `"use workflow"` substrate — NOT a user-facing route) contains BOTH
  `background-agent.ts` and `agent-loop-step.ts`. Background agents and loops
  already execute as durable workflows on the same engine.
- **Triggers already fire either.** `backgroundAgentTriggers` (schema.ts) has
  **both** `agentId` and `loopId` nullable FKs — a trigger was explicitly
  designed to fire a single agent OR a loop run.
- **The data models overlap almost entirely:**
  | background_agents | agent_loop agent_step node |
  |---|---|
  | instructions | instructions |
  | permissions (GitHub scopes) | permissions (added P1) |
  | composioToolkitSlugs | composioToolkitSlugs (added P2) |
  | checkCommand | checkCommand |
  | outputMode | (outputSchema / declared outputs, P3) |
  | repoOwner/repoName, status, triggers | loop has repo/status; triggers via loopId |

  A `background_agent` ≈ a single `agent_step` node + repo + triggers. The recent
  P1/P2/P3 work made the loop step carry exactly the fields a background agent
  has — they've converged in practice.

## Naming note
`/workflows` is internal runtime, not a product page, so "Workflows" is largely
free as a **product** name (a dev-facing dir-shadow is the only cost). The
earlier rename of the repo-dashboard window to "Loops" was to avoid that
dir-shadow; if we adopt "Workflows" as the product concept this should be
revisited. Recommended product vocabulary:
- **Agents** — reusable node definitions (today: background agents + loop steps).
- **Workflows** — graphs of agent-nodes (today: loops). A 1-node workflow that
  fires on a trigger is what we call a "background agent" today.

## Consolidation options
1. **Unifying view, two tables (fastest).** Keep `background_agents` and
   `agent_loops` as storage, but present ONE "Workflows" surface: a background
   agent renders as a 1-node workflow; the builder is the single editor; the node
   config IS the agent config. Lowest risk; no migration. The seams stay but are
   hidden.
2. **One model, one table (cleanest).** Collapse to a single `workflows` table
   whose `definition` is always a node graph (a background agent = a 1-node
   graph). Migrate `background_agents` rows → 1-node workflows; repoint triggers.
   Biggest change; removes the duplication permanently.
3. **Shared core, thin adapters (middle).** Extract a shared agent-node config +
   runner; both surfaces consume it; defer the table merge. (This is what the
   P1/P2/P3 + #408 work already trends toward.)

**Recommendation:** commit to the **model/vocabulary** now (Agents + Workflows),
execute via **Option 3 then 1** (shared config/runner + unifying view), and treat
the **Option 2 table merge** as a later, optional cleanup once the view proves
the model. This avoids a risky big-bang migration while delivering the single
coherent concept.

## Risks / open questions
- Two shipped feature areas (settings/background-agents + loops builder) and
  their tests/runtime — large surface; sequence carefully.
- Migration safety if we collapse tables (Option 2) — Neon preview branches help;
  triggers must repoint atomically.
- "Run now" / trigger dispatch must treat 1-node and multi-node uniformly
  (dispatcher already branches on agentId vs loopId — unify it).
- Product naming change ("Loops" → "Workflows") ripples through nav/IA we just
  built; do it deliberately.

## Suggested first slices (if we proceed)
1. Adopt the vocabulary in docs + an epic; freeze "loops" as an internal alias.
2. Land #408 (node config = background-agent config components) — the shared
   config core (Option 3).
3. Surface a single background agent as a 1-node workflow in the builder
   (read-only first), proving the unifying view (Option 1).
4. Decide on the table merge (Option 2) with migration design.
