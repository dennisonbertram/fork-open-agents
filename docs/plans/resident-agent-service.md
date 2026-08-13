# Resident Agent Service

Concept note — captured from a design conversation, not yet an implementation
plan. Once this becomes actionable, create the corresponding GitHub issue/epic
per the Feature Ticket Format and link it here.

## The idea

A durable, addressable **agent-per-task service**, exposed over MCP, where the
unit of the product is not a sandbox but a **resident worker agent** that owns
a task and its workspace.

External agents — ChatGPT, Claude Code, Codex, future models — are all just
clients. They don't attach to the sandbox; they attach to the worker. They task
it, ask it what happened, and delegate sub-tasks to it.

## v1 (rejected): sandbox-as-a-service

The naive version: a cloud sandbox service that any agent connects to directly.

The flaw: each visiting agent carries its own private context. The sandbox
holds the *files*, but not the *narrative* of why they look that way. Every new
agent would have to re-ingest the full diff/history to be useful, and context
on the client's side isn't transferable. The product degrades into commodity
infra.

## v2: resident worker + visiting specialists

- One long-lived worker agent per task. It runs as a durable workflow (the
  Open Agents pattern: agent separated from sandbox, hibernate/resume via
  `packages/sandbox`) and controls its own sandbox.
- The service is exposed over MCP. Visiting agents task the worker, ask for
  state and rationale, and delegate sub-tasks.
- The worker is the context holder. A visiting model doesn't need the full
  diff; it *converses* with the worker — the way a new teammate asks the
  project owner instead of reading every commit.

Analogy: a project has an owner; newcomers ask that owner for state rather than
reading the entire history.

## The structured-memory requirement

The worker's memory must not live only in its model context window. It should
continuously materialize state into structured artifacts:

- plans
- decision logs
- task graphs

This makes the project survive swapping the worker's underlying model — without
it, replacing the model lobotomizes the project.

Shape: **resident maintainer + structured memory + visiting specialists.**

## Who writes the memory? (answered 2026-08-11)

This decision drives the architecture:

1. **Worker-written** — the worker self-reports its state. Rich interpretation,
   but can drift from the actual workspace.
2. **Sandbox-derived** — an artifact indexer watches the workspace. Truthful
   but shallow.
3. **Both** — derived state as ground truth, worker narrative as the
   interpretation layer on top.

The memory survey
([resident-agent/research/memory-architectures.md](resident-agent/research/memory-architectures.md))
settled this as a recommendation: **option 3**, and it is not novel — it is
OpenHands' shipping condenser design (append-only event log as truth,
regenerable LLM summary that never overwrites it) and Anthropic's own
long-running-agent practice (git log as truth, progress file as
interpretation, cross-checked each session). No surveyed system trusts
self-report alone as ground truth. Proposed concrete shape: a typed task
graph and an append-only event/decision log as the two truth tables; the
worker's plan file is explicitly interpretation.

## Why this is durable

The abstraction — durable workspaces with a small operation set (attach, run,
inspect, checkpoint, resume) fronted by a context-owning worker — outlives UI
kits and specific models, which will churn. Every future agent is just another
client.

## Fit with this repo

Open Agents already separates the agent from the sandbox (`packages/agent`
runs as a durable workflow and connects to `packages/sandbox` over tools),
which is what enables hibernation and resume. The concept extends that layer:
the resident agent becomes the product surface, exposed over MCP, rather than
the sandbox being the surface.

## Where to build it (as of 2026-08-11)

Three options were evaluated — this fork, upstream `vercel-labs/open-agents`,
and a greenfield rebuild on Cloudflare:

- **This fork** already has much of the surface: an OAuth-secured MCP server
  (`apps/web/app/api/mcp/[transport]/route.ts`, tools in
  `apps/web/lib/mcp-server/tools/`), a reusable session spine
  (`createSessionCore`, `startChatRun`), and reserved `agents:*` scopes —
  note the scopes are declared vocabulary only; no tool uses them yet
  (verified 2026-08-11; see
  [resident-agent/portable-designs.md](resident-agent/portable-designs.md)).
  Default path if the Cloudflare spike surfaces platform blockers.
- **Upstream** is simpler but stalled (no commits since ~2026-06), has no MCP
  support and no machine auth, and its core runtime deps are beta. Reference
  material only.
- **Cloudflare** offers the resident-worker shape as native primitives: the
  Agents SDK `Agent` class (one name-addressable Durable Object per worker,
  SQLite memory, ~$0-idle hibernation), Workflows for turn execution, Sandbox
  SDK containers running pluggable coding-agent brains, OAuth 2.1 + dynamic
  client registration for "any agent, anywhere" clients.

The Cloudflare architecture, platform research, and a time-boxed spike plan
live in [resident-agent/](resident-agent/README.md). The decision is: spike
the Cloudflare shape (~2 weeks, raw primitives), keep the fork as the default
if the spike hits platform-level blockers. Architecture sketch:
[resident-agent-architecture.html](resident-agent-architecture.html) (note:
research revised the workspace-persistence detail — backup/restore to R2, not
a live mount).

Key design principles settled during discussion:

- **Client-neutral and brain-neutral**: the durable product is worker
  identity + memory + workspace; visiting clients and coding brains both
  churn.
- **Judgment vs. mechanics**: the worker's model decides *when* to act;
  externally visible operations (clone, push, PR) are deterministic tools the
  worker owns — the inner agent never holds repo credentials (enforced via
  network-layer token injection, not convention).
- **The recursion**: clients treat the worker the way the worker treats its
  inner agent — owner keeps context, visitors are stateless, artifacts are
  the handoff. Same pattern at every level.
- **Verify, don't trust**: the worker never accepts the inner agent's
  self-report; it runs tests and reads diffs with its own tools.
