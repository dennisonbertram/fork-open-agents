# Resident Agent Service — Cloudflare Research Package

Research compiled 2026-08-11 from live Cloudflare docs, GitHub repos, and npm
registry data. Companion to [../resident-agent-service.md](../resident-agent-service.md)
(concept) and [../resident-agent-architecture.html](../resident-agent-architecture.html)
(diagram). All four research docs flag unverifiable claims as UNVERIFIED and date
time-sensitive facts — this platform is moving fast, so re-verify before
implementation.

## The concept in three sentences

Durable, addressable worker agents — one per task — exposed over MCP. Any
external agent (Claude Code, Codex, Devin, ChatGPT) connects as an OAuth client
to task a worker, ask it questions, and inspect its work. The worker owns its
sandbox and its structured memory; the coding brain inside the sandbox is
pluggable.

## Documents

| Doc | Contents |
| --- | --- |
| [original-vision.md](original-vision.md) | The founding conversation, near-verbatim — what we're building and why |
| [stories.md](stories.md) | Scope lock: the stories this product commits to, and its non-stories |
| [research/agents-sdk-and-mcp.md](research/agents-sdk-and-mcp.md) | Agents SDK `Agent` class, MCP hosting (`createMcpHandler`), MCP client support, OAuth 2.1 / dynamic client registration, Project Think |
| [research/durable-objects-and-workflows.md](research/durable-objects-and-workflows.md) | DO SQLite storage, hibernation, alarms, limits/pricing; Workflows step semantics; the DO↔Workflow composition pattern |
| [research/sandbox-sdk.md](research/sandbox-sdk.md) | Sandbox SDK current API (post-July-2026 deprecations), container specs, network egress, persistence options, pricing, coding-agent-in-container precedents |
| [research/brains-computer-and-precedents.md](research/brains-computer-and-precedents.md) | `@cloudflare/computer` (preview), model access (AI SDK on Workers, AI Gateway, Workers AI), real-world precedents |
| [spike-plan.md](spike-plan.md) | Time-boxed validation plan for the riskiest assumptions |
| [portable-lessons.md](portable-lessons.md) | Stack-agnostic lessons distilled from the open-agents fork's production history |

## Synthesis

### What the research confirmed

- **The `Agent` class is the resident-worker pattern almost verbatim.** One
  Agent = one name-addressable Durable Object with embedded SQLite, hibernation
  at ~$0 idle, cron/alarm scheduling. Worker identity is a platform primitive,
  not something we build.
- **"Any agent, anywhere" is solved.** `@cloudflare/workers-oauth-provider`
  implements OAuth 2.1 with PKCE and RFC 7591 dynamic client registration —
  external agents self-register. MCP client support (`this.addMcpServer()`)
  makes worker-to-worker delegation first-class: the recursion pattern works
  natively.
- **The credential boundary is better than we designed it.** Sandbox
  `outboundByHost` handlers run in the Worker and inject GitHub App tokens /
  model keys *at the network layer* — credentials never enter the container.
  "Only the worker holds repo keys" is enforceable structurally, not by
  convention.
- **Third-party brains are proven, not speculative.** Official Sandbox SDK
  tutorial runs Claude Code in a container; there's an OpenCode image variant;
  Devin Outposts and OpenAI Agents SDK tutorials target the platform. Coding
  agents in sandboxes are Cloudflare's reference use case.
- **Model neutrality is easy.** AI SDK (`ToolLoopAgent`) runs on Workers; AI
  Gateway does BYOK at passthrough pricing; Workers AI has credible cheap
  coding models (GLM-5.2, Kimi K2.7-code) for default brains.
- **Cloudflare's own roadmap points this direction.** Project Think pitches
  "one agent per task" on DO + SQLite + hibernation; `@cloudflare/computer`
  productizes the worker's-memory-plus-pluggable-execution shape (and shipped
  v0.2.0 the day of this research — preview-only, churning).

### What the research changed

1. **Workspace persistence: not a live R2 mount.** Bucket mounts are s3fs-FUSE;
   Cloudflare's own docs warn about latency and recommend copy-local/copy-back,
   and git-repo-on-s3fs fidelity is undocumented. The shipped primitive is
   **backup/restore** (squashfs images to R2, copy-on-write restore): ~2 s
   restore vs ~30 s cold boot + clone + install. The diagram's "R2 mount =
   workspace" becomes "R2 holds restore images; containers are still cattle."
   True VM disk snapshots (`snapshot()`) were announced at GA but have no
   shipped docs — do not design around them.
2. **Hibernation vs. sandbox connections.** Outbound connections block DO
   hibernation and bill up to 15 min each. The worker must not hold persistent
   connections to its sandbox — per-operation RPC only. This is a design rule,
   not an optimization.
3. **`McpAgent` is deprecated** (2026-07-27/28 docs) in favor of stateless
   `createMcpHandler` with durable state composed behind DOs. That's our
   architecture anyway, but the MCP-tool→named-DO routing is ours to
   hand-roll.
4. **Turn ownership: Workflows, not fibers (for now).** Project Think's fibers
   (SQLite-checkpointed durable execution in the DO) overlap with Workflows.
   Fibers are preview; Workflows are GA with memoized `step.do` retries,
   unlimited per-step wall time, and `waitForEvent` for approvals. Use
   Workflows; revisit fibers when Think ships.

### Top risks, ranked

| # | Risk | Why it matters | Validation |
| --- | --- | --- | --- |
| 1 | Cold-start latency end-to-end | "Ask the owner" must feel conversational; DO wake latency is unpublished, sandbox cold path is ~30 s | Spike M1/M3 benchmarks |
| 2 | Persistence choreography | Sleep wipes the container filesystem; backup/restore cycle with a real git repo is unproven by us | Spike M3 |
| 3 | Workflows billing started 2026-08-10 | Cost per task at scale is unmodeled | Spike M5 cost capture |
| 4 | MCP front door with real clients | Claude Code / ChatGPT as OAuth-registered MCP clients is unproven; no documented M2M grant for headless agents | Spike M4 |
| 5 | Platform churn | Agents SDK pre-1.0, Computer preview, Sandbox 1.0 preview changing the exec contract | Pin versions; design behind our own interfaces |
| 6 | Multi-brain interchangeability | The core product claim; unproven that Pi/Claude Code/etc. can sit behind one worker contract | Spike M2 (one brain), fast-follow (second brain) |

### Spike recommendation

Build the spike on **raw primitives** (Agents SDK `Agent` + Workflows +
Sandbox SDK 1.0-preview track), not on `@cloudflare/computer`: the risky
assumptions all live at the primitive level, and Computer's own FUSE
filesystem under repo-scale git I/O is itself unproven. Track Computer as a
fast-follow abstraction once the spike validates the shape. See
[spike-plan.md](spike-plan.md).

## Status

Research complete. Next: spike (M1–M5), then the build-vs-fork decision
review with real numbers. The fork path (build on dennisonbertram/fork-open-agents)
remains the default if the spike surfaces platform-level blockers.
