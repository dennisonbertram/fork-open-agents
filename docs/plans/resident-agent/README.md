# Resident Agent Service — Cloudflare Research Package

Research compiled 2026-08-11 from live Cloudflare docs, GitHub repos, and npm
registry data, deepened the same day by a second wave (client landscape,
competition, memory architectures, example inventory, fork design study).
Companion to [../resident-agent-service.md](../resident-agent-service.md)
(concept) and [../resident-agent-architecture.html](../resident-agent-architecture.html)
(diagram). All research docs flag unverifiable claims as UNVERIFIED and date
time-sensitive facts — this platform is moving fast, so re-verify before
implementation.

## The concept in three sentences

Durable, addressable worker agents — one per task — exposed over MCP. Any
external agent (Claude Code, Codex, Devin, ChatGPT) connects as an OAuth client
to task a worker, ask it questions, and inspect its work. The worker owns its
sandbox and its structured memory; the coding brain inside the sandbox is
pluggable.

The founder's framing: **a coding harness for your coding harness.** The
client of the product is the owner's agent, not the owner — the human talks
to whichever agent is at hand, and that agent works the service on their
behalf ([original-vision.md](original-vision.md), framing stories).

## Documents

| Doc | Contents |
| --- | --- |
| [original-vision.md](original-vision.md) | The founding conversation, near-verbatim — what we're building and why |
| [stories.md](stories.md) | Scope lock: the stories this product commits to, and its non-stories |
| [research/agents-sdk-and-mcp.md](research/agents-sdk-and-mcp.md) | Agents SDK `Agent` class, MCP hosting (`createMcpHandler`), MCP client support, OAuth 2.1 / dynamic client registration, Project Think |
| [research/durable-objects-and-workflows.md](research/durable-objects-and-workflows.md) | DO SQLite storage, hibernation, alarms, limits/pricing; Workflows step semantics; the DO↔Workflow composition pattern |
| [research/sandbox-sdk.md](research/sandbox-sdk.md) | Sandbox SDK current API (post-July-2026 deprecations), container specs, network egress, persistence options, pricing, coding-agent-in-container precedents |
| [research/brains-computer-and-precedents.md](research/brains-computer-and-precedents.md) | `@cloudflare/computer` (preview), model access (AI SDK on Workers, AI Gateway, Workers AI), real-world precedents |
| [research/mcp-client-landscape.md](research/mcp-client-landscape.md) | What each real client (Claude Code, ChatGPT, Codex, Cursor, Devin, Gemini CLI, VS Code) can actually do as a remote MCP client today — transports, OAuth/DCR/CIMD, headless paths, timeouts, mobile |
| [research/prior-art-and-competition.md](research/prior-art-and-competition.md) | Taskable cloud coding agents (Devin, Jules, Cursor, OpenHands, Managed Agents…), OSS control planes, interop protocols; the moat and the remote-brain variant |
| [research/memory-architectures.md](research/memory-architectures.md) | Memory prior art (Letta, Anthropic memory tool, OpenHands, beads, Cognition) and PROPOSED schema/who-writes/cheap-read/anti-lobotomy-test designs |
| [research/examples-and-boilerplates.md](research/examples-and-boilerplates.md) | Verified inventory of official examples/templates with version pins, mapped to spike milestones M1–M5, traps flagged |
| [spike-plan.md](spike-plan.md) | Time-boxed validation plan for the riskiest assumptions |
| [portable-lessons.md](portable-lessons.md) | Stack-agnostic lessons distilled from the open-agents fork's production history |
| [portable-designs.md](portable-designs.md) | Architectural designs from the fork worth porting — MCP tool registry, grant model, run ledger, brain-profile contract, lifecycle loop, delegation packets |

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

### What the second wave added (2026-08-11, same day)

1. **The product does not exist yet — and the window is narrow.** No vendor
   combines durable worker identity, an MCP front door, and client
   neutrality. Every taskable cloud agent (Devin, Jules, Cursor Cloud
   Agents, Copilot, Amp) *consumes* MCP; none exposes itself over it.
   Closest adjacency: **Anthropic Claude Managed Agents** (`/v1/agents`,
   public beta 2026-04-08, cross-session memory beta) has the primitives and
   could add an MCP front door "with a changelog entry, not a
   re-architecture." The moat is the client neutrality itself — no vendor is
   incentivized to let rival front-ends drive its workers.
   ([research/prior-art-and-competition.md](research/prior-art-and-competition.md))
2. **A remote-brain variant exists.** Devin, Jules, Cursor Cloud Agents,
   OpenHands Cloud, and Managed Agents are API-taskable today — a worker
   could delegate a turn to one instead of running a CLI in its own
   container. OpenHands stands out (identical code OSS and hosted, so
   verification survives). Codex Cloud has no public task API (confirmed via
   openai/codex#24777). Delegated turns fragment cost attribution across
   four incompatible billing units and weaken verification to "read the
   vendor's transcript" — treat them as a less-trusted turn class, not a
   container replacement.
3. **Client-side auth reality is settled.** Claude Code is the best-matched
   first client: PKCE always, DCR and CIMD out of the box, ~28 h tool budget
   with auto-backgrounding at 2 min. **No client or server ships pure
   machine-to-machine `client_credentials`** — one-time human consent is
   universal, and Anthropic's connector docs forbid M2M explicitly. Codex
   CLI's `--bearer-token-env-var` is the cleanest headless mechanism and
   forces a server design decision (offer a static-token mode or not).
   Codex Cloud custom MCP is unconfirmed; ChatGPT connectors register on
   web only and are read-leaning on mobile per community reports — the
   phone-status story is testable, not assumed.
   ([research/mcp-client-landscape.md](research/mcp-client-landscape.md))
4. **The memory question has an answer with a shipping precedent.** Derived
   ground truth + regenerable narrative is OpenHands' condenser design and
   Anthropic's own long-running-agent practice. Recommended (PROPOSED) shape:
   a beads-style typed task graph plus an append-only FTS5 event/decision
   log as the two truth tables; the worker's plan file is labeled
   interpretation, never truth. Cheap reads map to MCP *resources*; the
   story-altitude narrative is the one *tool* that wakes the model. The M5
   anti-lobotomy test was redesigned so a strong model cannot pass it by
   re-reading the repo instead of using memory.
   ([research/memory-architectures.md](research/memory-architectures.md))
5. **The spike starts warm.** A verified example inventory maps every
   milestone to a current starting repo (`mcp-worker` + `mcp-rpc-transport`
   → M1; `sandbox-coding-agent` + `authentication` → M2; `time-machine` →
   M3; `mcp-worker-authenticated` → M4) and flags the traps: the
   obvious-looking GitHub-OAuth template is still on deprecated `McpAgent`;
   **mid-turn kill/resume is unsolved upstream** (cloudflare/agents#1829);
   the 2 s / 30 s persistence numbers are a one-scenario vendor benchmark.
   Workers AI and AI Gateway unified into one `env.AI` binding on
   2026-08-07 — simplifies M5, with a silent-fallback BYOK trap documented
   in the spike plan.
   ([research/examples-and-boilerplates.md](research/examples-and-boilerplates.md))
6. **The fork contributes designs, not just lessons.**
   [portable-designs.md](portable-designs.md) blueprints, with file:line
   grounding: the MCP tool registry (scope-per-tool + typed error
   envelope), the compositional grant model and `force`-gated run-status
   guard (the worker registry + audit ledger), the managed-runtime profile
   contract (the brain-profile shape), the self-rescheduling lifecycle loop
   (the DO alarm-loop template), and typed delegation completion packets.
   One correction it forced: the fork's `agents:*` MCP scopes are reserved
   vocabulary only — no tool uses them yet.

### Top risks, ranked

| # | Risk | Why it matters | Validation |
| --- | --- | --- | --- |
| 1 | Cold-start latency end-to-end | "Ask the owner" must feel conversational; DO wake latency is unpublished, sandbox cold path is ~30 s | Spike M1/M3 benchmarks |
| 2 | Persistence choreography | Sleep wipes the container filesystem; backup/restore with a real git repo is unproven by us; mid-turn kill/resume is unsolved upstream (cloudflare/agents#1829) | Spike M3; M2 resume design |
| 3 | Workflows billing started 2026-08-10 | Cost per task at scale is unmodeled | Spike M5 cost capture |
| 4 | MCP front door with real clients | Client docs now say the wiring should work (Claude Code: DCR + CIMD native); still unproven live: the end-to-end handshake, the ChatGPT-mobile read path, Nth-worker consent. M2M is settled — it does not exist; a static-token mode is a design decision | Spike M4 |
| 5 | Platform churn | Agents SDK pre-1.0, Computer preview, Sandbox 1.0 preview changing the exec contract; oauth-provider shipped 2026-08-10, `env.AI` unification 2026-08-07 | Pin versions; design behind our own interfaces |
| 6 | Multi-brain interchangeability | The core product claim; unproven that Pi/Claude Code/etc. can sit behind one worker contract | Spike M2 (one brain), fast-follow (second brain) |
| 7 | Competitive window | Every major vendor is converging on resident workers; Anthropic Managed Agents has the primitives and could add an MCP front door cheaply | Spike fast; the moat is client neutrality (prior-art doc) |

### Spike recommendation

Build the spike on **raw primitives** (Agents SDK `Agent` + Workflows +
Sandbox SDK 1.0-preview track), not on `@cloudflare/computer`: the risky
assumptions all live at the primitive level, and Computer's own FUSE
filesystem under repo-scale git I/O is itself unproven. Track Computer as a
fast-follow abstraction once the spike validates the shape. See
[spike-plan.md](spike-plan.md).

## Status

Research complete, including the same-day second wave (client landscape,
competition, memory, examples, fork designs) and the framing stories
(stories 19–24: backlog fan-out, account-level status roll-up, blocked
state, cross-brain repair, client packaging). Next: spike (M1–M5), then the
build-vs-fork decision review with real numbers. The fork path (build on
dennisonbertram/fork-open-agents) remains the default if the spike surfaces
platform-level blockers.
