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

## Milestones

### M1 — Hello worker (target: day 1–2)

An `Agent` (DO) named by task slug, with a SQLite memory schema
(`plans`, `decisions`, `task_graph` tables), one `echo` MCP tool behind
stateless `createMcpHandler`, and the hand-rolled tool→named-DO router.

- Verify: DO wake from hibernation — **measure and record wake latency**
  (no published numbers exist; this is risk #1's first half).
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
- Pass criteria: brain completes the repo task; diff lands in the workspace;
  worker verifies by running tests itself (not trusting the brain's report);
  turn survives an intentional mid-run kill.

### M3 — Persistence (target: day 6–8)

Sleep wipes the container filesystem, so: implement backup/restore (squashfs
image → R2) around the workspace.

- Measure: restore latency (**~2 s claimed**) vs. cold boot+clone (**~30 s
  claimed**). Record both.
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

- Then ChatGPT (or a second client) — same account, same worker.
- Investigate the headless gap: no documented client-credentials/M2M grant.
  If a fully headless agent can't connect, record the exact workaround
  (browser-consent bootstrap? token exchange?) — this shapes onboarding UX.
- Pass criteria: two different external clients task and question the same
  worker; second client asks "what has happened so far?" and gets the worker's
  account — not a raw transcript.

### M5 — The model swap + cost capture (target: day 12–14)

- Swap the worker's owner model (e.g. Workers AI GLM-5.2 → Anthropic via AI
  Gateway BYOK) and ask "what were we doing?" — the anti-lobotomy test.
  Passes only if the answer comes from SQLite artifacts, correctly.
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
