# Spike: loop agent-steps as background agents + explicit data flow

Design investigation (no product code) for two pieces of live-review feedback:
1. "Each agent node IS a background agent — reuse the background-agent builder
   (tools, GitHub connection). Right now a node has no tools, so it can't even
   reach GitHub — what's the point?"
2. "Make explicit how data moves between nodes" (today it's an implicit magic
   file path).

The reviewer also said: *"obviously I'm worried about complexity."* This spike
proposes the smallest convergence that fixes the capability gap, plus a phased
path — not a big-bang rewrite.

## Current state (grounded in code)

### Two agent config models that have drifted apart
**Background agent** (`backgroundAgents`, `apps/web/lib/db/schema.ts:865`; form in
`apps/web/lib/background-agents/agent-spec.ts`):
- `instructions`, `checkCommand`
- `permissions: BackgroundAgentPermissions` — fine-grained GitHub scopes
  (contents / pullRequests / issues / deployments / statuses / checks · read|write)
- `composioToolkitSlugs: string[]` — external tools, gated at run time by
  `backgroundAgentToolGrants` + repo policy (`resolveComposioToolsForBgRun`)
- `outputMode`: comment | ready_pr | issue | notification | none

**Loop agent-step** (`agentStepNodeSchema` in `lib/agent-loops/types.ts`; UI in
`builder/node-config-panel-component.tsx`):
- `instructions`, `checkCommand`, `outputSchema?`
- **No** per-step `permissions`, **no** `composioToolkitSlugs`, **no** `outputMode`.
- The *loop* row has a `permissions` field (`schema.ts:942`) but it isn't surfaced
  per step, and the step runner (`lib/agent-loops/agent-step.ts`) mints a GitHub
  installation token hardcoded to `{ contents: "write" }` and wires **no Composio
  tools**.

**Consequence (the reviewer's "no tools / can't reach GitHub"):** a loop step is a
*thin* agent. With no Composio tools and a fixed GitHub scope — and a hard
dependency on a GitHub App installation for the repo (the `no_user_token` /
`permission_missing` failure we saw) — many useful loops can't actually run.

### Data flow today
- Background agents emit to GitHub via `outputMode` (comment/issue/PR). They do
  **not** pass data to each other.
- Loop steps pass data via an **implicit convention**: the agent writes JSON to
  `/tmp/loop-step-output.json` → `mergeStepOutput` stores it as `context[nodeId]`
  → downstream `condition` nodes / steps read it by dot-path
  (`lookupContextPath`, e.g. `review.passed`). `agentStepNodeSchema.outputSchema`
  exists but isn't enforced or surfaced.
- Nothing in the builder shows what a step *produces* or what a downstream step
  *consumes* — the reviewer's "review issues → make issues → pull issues from it"
  has no visible wiring.

## Proposal

### Part 1 — Converge the agent config (fix the capability gap)
Goal: one way to define "an agent that does X over a repo", shared by background
agents and loop steps.

- **Extract a shared `AgentConfig`**: `{ instructions, checkCommand, permissions,
  composioToolkitSlugs, outputSchema? }`. Background-agent and loop-step configs
  both compose it. (`agent-spec.ts` is already the shared-spec seam — extend it.)
- **Extend `agentStepNodeSchema`** with optional `permissions` and
  `composioToolkitSlugs` (additive, backward-compatible — existing loops keep
  working with empty defaults).
- **Reuse the background-agent config UI** in the node config panel: lift the
  tools / GitHub-permissions / checkCommand controls into a shared component
  (`AgentConfigFields`) rendered by both the background-agent form and the loop
  node panel. This is where the larger, nicer instructions editor (the modal
  feedback) lives — so we don't polish a throwaway.
- **Reuse the runtime resolution**: `agent-step.ts` should resolve tools +
  GitHub scopes the same way background runs do (`resolveComposioToolsForBgRun`,
  tool grants, scoped installation token from the step's `permissions`) instead
  of the hardcoded `contents:write`.

Two ways to relate the entities — recommend **(b)**:
- (a) An agent_step *references* a `background_agent` row (a step = a saved agent).
  Maximal reuse, but couples loop authoring to creating/managing separate agent
  rows and a cross-entity lifecycle.
- (b) **An agent_step embeds the shared `AgentConfig`** (own copy on the node).
  Shares the *config surface + runtime resolution*, not the row. Simpler mental
  model ("a loop is self-contained"), no cross-entity lifecycle, and still gets
  tools + GitHub. Recommended.

### Part 2 — Make data flow explicit
- **Declared outputs:** keep `context[nodeId]` as the channel, but make each
  step's `outputSchema` a first-class, surfaced thing — the step declares the
  fields it writes (e.g. `review` → `{ passed: boolean, issues: Issue[] }`).
- **Referenced inputs / autocomplete:** when configuring a node, offer the
  available upstream outputs (`context.<upstreamId>.<field>`) as insertable
  references — in instructions and especially in `condition` paths (today the
  user hand-types `review.passed`).
- **Show it on the canvas:** small "outputs: passed, issues" chips on a node and,
  on hover/inspect, which downstream nodes consume them. This directly visualizes
  "review issues → make issues → pull issues from it."
- The magic `/tmp/loop-step-output.json` stays the transport (the agent still
  writes there), but the *contract* (named outputs/inputs) becomes explicit and
  validated against `outputSchema`.

### Migration / compat
- Schema: `agentStepNodeSchema` gains optional `permissions`, `composioToolkitSlugs`.
  Existing definitions validate unchanged (fields optional, default empty).
- No DB migration if the node config lives in the loop `definition` JSONB
  (it does). Tool grants reuse `backgroundAgentToolGrants` (may need a loop-scoped
  grant or a per-user grant — open question).
- Runtime: `agent-step.ts` gains tool/permission resolution; guard behind the
  same readiness/allowlist checks.

## Phasing (smallest valuable first)
1. **P1 — GitHub permissions per step** ✅ **SHIPPED**: agent-step nodes carry
   `permissions`; the config panel exposes Code/Issues/Pull-requests
   (none/read/write); `agent-step.ts` mints the installation token from the
   step's (or loop's) scopes via a pure tested mapper. A "file issues" step can
   now `gh issue create`.
2. **P2 — Composio tools per step** ✅ **SHIPPED**: agent-step nodes carry
   `composioToolkitSlugs`; the config panel reuses `ComposioToolkitPicker` under
   a "Tools" section; `agent-step.ts` resolves them via the shared
   `resolveComposioToolsForBgRun(agentId:null)` (gated by the user's connected
   accounts + repo policy) and injects them into `openAgent.generate`. (The
   nicer instructions editor shipped earlier as the Expand modal.)
3. **P3 — Explicit data flow** (declared outputs, input autocomplete in
   condition/instructions, canvas chips).

## Risks / open questions
- **Complexity** (reviewer's concern): mitigated by (b) embedding config rather
  than coupling to agent rows, and by phasing P1→P3.
- **Tool grants scope:** background tool grants are per-agent; loops need a
  per-loop or per-user grant model — decide before P2.
- **GitHub dependency:** even with per-step scopes, a run needs an installation on
  the repo. The UI should surface "connect this repo" when missing (the current
  failure is opaque) — ties back to the run-page remediation follow-up.
- Should the loop's existing top-level `permissions` be the default that steps
  inherit/override? (Recommend: loop = default, step can narrow.)

## Recommendation
Do **P1** first (per-step GitHub permissions + scoped token) — it's the smallest
change that makes loop steps actually useful, and it validates the shared-config
direction before investing in P2/P3.
