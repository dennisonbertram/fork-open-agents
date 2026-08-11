# Resident Agent Service — Spike Plan

Time-boxed validation of the riskiest assumptions from the
[research package](README.md). The spike is not a product skeleton — it is a
set of experiments with pass/fail criteria, thin enough to throw away. Every
milestone records the numbers the build-vs-fork decision needs.

**Timebox: ~2 weeks.** If M1–M3 aren't done by end of week one, stop and
reassess — the platform is fighting us and the fork path gets stronger.

## What the spike must answer

| # | Question | Milestone |
| --- | --- | --- |
| 1 | End-to-end cold-start latency: hibernated worker + sleeping sandbox → answer | M1, M3 |
| 2 | Persistence choreography: backup/restore with a real git repo | M3 |
| 3 | A third-party brain (Claude Code or Pi) runs headless in a container and does real repo work | M2 |
| 4 | A real external MCP client (Claude Code, ChatGPT) self-registers via OAuth and tasks a worker | M4 |
| 5 | Cost per task, measured not modeled | M5 |

## Ground rules

- **Raw primitives only**: Agents SDK `Agent` class, Cloudflare Workflows,
  Sandbox SDK (`@next` 1.0-preview track — the API Cloudflare recommends for
  new projects). No `@cloudflare/computer` (preview, churning; revisit after).
- **Pin every version** in `package.json` and record them in the spike README;
  the platform ships breaking changes weekly.
- **No persistent DO→sandbox connections.** Per-operation RPC only — outbound
  connections block hibernation and bill up to 15 min each.
- **Numbers go in the spike README as we get them**, not at the end.
- One repo fixture (a small real repo with a test suite), one brain, one
  external client. Breadth is the enemy.
- **Start from the inventoried examples, not from scratch.**
  [research/examples-and-boilerplates.md](research/examples-and-boilerplates.md)
  (2026-08-11) maps each milestone to a verified starting repo and names the
  traps: the obvious-looking templates on the deprecated `McpAgent` pattern,
  stale version pins, and the gaps no example covers.
- **Every MCP tool returns fast.** Client tool-call budgets differ wildly —
  Codex CLI defaults to 60 s per tool call; Claude Code auto-backgrounds calls
  at 2 min ([research/mcp-client-landscape.md](research/mcp-client-landscape.md)).
  `task` starts a turn and returns ids immediately; progress is read or
  polled, never awaited inside the tool call.

## Milestones

### M1 — Hello worker (target: day 1–2)

An `Agent` (DO) named by task slug, with a SQLite memory schema, one `echo`
MCP tool behind stateless `createMcpHandler`, and tool→named-DO routing.

- Memory schema: the two-truth-tables shape from
  [research/memory-architectures.md](research/memory-architectures.md) — a
  typed task graph (`issues` + typed `issue_deps`, beads-style) and an
  append-only event/decision log (FTS5-indexed, OpenHands-style), plus a
  narrative plan file that is explicitly interpretation, never truth.
- Start from `cloudflare/agents/examples/mcp-worker` and
  `examples/mcp-rpc-transport`. Do **not** build on `examples/mcp` — its own
  README marks the `McpAgent` pattern deprecated and feature-frozen.
- Routing: try the SDK's RPC-transport primitive
  (`addMcpServer(name, env.Worker, ...)`) before hand-rolling the router —
  the brief assumed custom code; the SDK has a first-class version.
- Verify: DO wake from hibernation — **measure and record wake latency**
  (no published numbers exist; re-confirmed 2026-08-11; this is risk #1's
  first half).
- Verify: alarm wake works (schedule a self-ping, hibernate, observe).
- Pass criteria: worker answers an MCP call after 24 h idle; wake latency
  recorded.

### M2 — Brain in a box (target: day 3–5)

Worker gets `task` tool: start a Workflow instance (`workerId-turn-N`), which
provisions a Sandbox SDK container, clones the fixture repo, and runs a
coding-agent CLI headless against a small task ("add a failing test for X").

- Use the pre-baked image variant (OpenCode image or a custom image with the
  brain CLI installed) — cold `npm install` of the brain per task is a known
  ~30 s path; measure both once, then use the pre-baked path.
- GitHub access via `outboundByHost` credential injection — **prove the
  container never sees the token** (attempt `git push` with a token-less
  remote from inside; expect refusal; check env for leaks).
- Workflow steps: memoized `step.do` per model/sandbox op; verify a kill
  mid-turn resumes from the last completed step.
- Start from `cloudflare/agents/examples/sandbox-coding-agent` (a
  near-complete prebuild: per-task facet DO + sandbox + `outboundByHost`
  interception routed through AI Gateway) and
  `sandbox-sdk/examples/authentication` (Anthropic + GitHub + R2 injection
  organized in one place).
- Two gaps no example covers (budget design time, not just wiring time):
  no official example wires raw Workflows around sandbox provisioning; and
  **kill-mid-turn resume is unsolved upstream** — `sandbox-coding-agent`'s
  own README says mid-turn eviction orphans the `claude -p` process and
  resume is between turns only (open issue cloudflare/agents#1829). Our
  memoized-step design is ahead of the references here, not copying one.
- Pass criteria: brain completes the repo task; diff lands in the workspace;
  worker verifies by running tests itself (not trusting the brain's report);
  turn survives an intentional mid-run kill.

### M3 — Persistence (target: day 6–8)

Sleep wipes the container filesystem, so: implement backup/restore (squashfs
image → R2) around the workspace.

- Start from `sandbox-sdk/examples/time-machine` (runnable backup/restore
  demo with a `localBucket` mode for local dev).
- Measure: restore latency (**~2 s claimed**) vs. cold boot+clone (**~30 s
  claimed**). Record both. Both numbers are Cloudflare's own one-scenario
  benchmark (clone axios + `npm install`, GA blog) — treat as marketing
  until re-measured on the spike fixture.
- Backup TTL (default 3 days) is enforced only at restore time; expired
  backups linger in R2 until deleted. Note the GC design this implies.
- Exercise: task the worker, let everything sleep, come back next day,
  `ask` a follow-up that requires workspace context. Measure end-to-end
  cold-answer latency — **this is the product-feel number**.
- Separately, probe git-on-s3fs directly (mount workspace, run `git status` /
  `commit` / `gc` under repo-scale I/O) to know whether the live-mount path is
  ever viable — 30 minutes, informational only.
- Pass criteria: next-day follow-up answered correctly from restored state;
  cold-answer latency recorded.

### M4 — Front door with a real client (target: day 9–11)

Wire `@cloudflare/workers-oauth-provider` (OAuth 2.1, PKCE, RFC 7591 DCR) in
front of the MCP handler; register Claude Code as a client and task the
worker from a desktop session.

Client research ([research/mcp-client-landscape.md](research/mcp-client-landscape.md),
2026-08-11) settled most of this milestone's unknowns in advance:

- **First client: Claude Code** — the lowest-risk pairing. Native remote MCP
  with PKCE always sent, DCR and CIMD out of the box, and ~28 h default tool
  timeout with auto-backgrounding. No `mcp-remote` proxy needed.
- **Second client: a ChatGPT Developer Mode connector.** Register it on
  ChatGPT web (mobile cannot enable Developer Mode or register connectors),
  then run the phone test: read-only status tools from the ChatGPT mobile
  app. Mobile write-gating is community-reported only — this test settles
  the "status from my phone" story with evidence.
- Start from `cloudflare/agents/examples/mcp-worker-authenticated`. Do
  **not** start from `cloudflare/ai/demos/remote-mcp-github-oauth` — it is
  still on the deprecated `McpAgent` pattern and pins
  `workers-oauth-provider` 0.8.1 against a current 0.10.x.
- **The headless gap is settled, not open**: no surveyed client or server
  ships a pure machine-to-machine `client_credentials` path, and Anthropic's
  connector docs explicitly forbid one — every connection includes a
  one-time human consent. Record the design decision this forces: whether
  the front door also offers a static-bearer-token mode for headless
  clients (Codex CLI's `--bearer-token-env-var` is the cleanest client-side
  counterpart), alongside OAuth.
- Codex Cloud does not read the CLI's MCP config and its custom-MCP support
  is unconfirmed — Codex CLI is the Codex-side client; Codex Cloud is out
  of scope.
- Also record: whether the Nth worker requires a fresh OAuth consent or one
  client registration covers all workers (RFC 8707 resource-indicator
  scoping) — this decides whether the backlog fan-out story (stories.md #19)
  can complete unattended.
- Pass criteria: two different external clients task and question the same
  worker; second client asks "what has happened so far?" and gets the worker's
  account — not a raw transcript.

### M5 — The model swap + cost capture (target: day 12–14)

- Swap the worker's owner model (e.g. Workers AI GLM-5.2 → Anthropic via AI
  Gateway BYOK). The 2026-08-07 Workers AI / AI Gateway unification routes
  both legs through one `env.AI` binding (model string + optional gateway
  param), so the swap may be a model-string change — re-verify at
  implementation time; the change is days old.
- **BYOK trap**: `env.AI.run()` consults only the `default` key alias. If it
  is missing, the call silently succeeds on Cloudflare Unified Billing —
  which would invalidate the cost comparison. Confirm the default-alias key
  exists before capturing numbers.
- The anti-lobotomy test, upgraded per
  [research/memory-architectures.md](research/memory-architectures.md) so a
  capable model cannot pass it by re-reading the repo instead of using
  memory: run two variants — *memory-only* (the swapped model may read the
  worker's structured state but not the workspace until it produces its
  first narrative and next action) and *memory+workspace* (the realistic
  condition). Score against named failure modes: repeated or contradicted
  work vs. the task graph (the "50 First Dates" check), respect for a
  seeded non-obvious recorded decision (trace-sufficiency check), and
  time-to-first-productive-action. Swap at two different points in the
  task, not once at the end.
- Assemble cost per task from measured usage: DO duration/rows, Workflow
  steps, sandbox memory/CPU/egress, model tokens. Compare against the
  2026-08-10 Workflows step pricing. Record cost/task.
- Write the spike retrospective: numbers table, what broke, what surprised us.

## Decision gates

After M5, review against the fork path:

- **Go (Cloudflare)** if: cold-answer latency is acceptable (< ~15 s for a
  sleeping worker, or a mitigation like warm pools doesn't destroy the cost
  story), persistence choreography works, real clients connected, and
  cost/task is sane.
- **Back to fork** if: any of cold-start, persistence, or MCP-client auth is
  a platform-level blocker rather than an engineering problem.
- **Hybrid** (fork for production now, Cloudflare as the v2 substrate) is a
  legitimate outcome, not a failure.

## Explicit non-goals

- No UI. No multi-worker registry beyond a name lookup. No worker-to-worker
  delegation (the SDK supports it; the spike doesn't need it). No production
  hardening, rate limiting, or billing. No second brain (fast-follow).
