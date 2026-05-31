# Proof of Concepts

Self-contained POCs that meaningfully test (not smoke-test) proposed agent-platform capabilities, to eliminate implementation blind spots before committing to production work.

## Conventions
- Each POC lives in its own `POC/<id>/` folder, fully self-contained (its own deps; never modify the root lockfile or app source).
- Each POC includes: working code, a **meaningful eval** with captured evidence (logs/screenshots/output), and a `README.md`.
- Each POC README documents: Goal, What was built, How it was tested (evidence), Integration plan into the real codebase (with real file paths), Feasibility verdict, Blind spots eliminated, Remaining risks.

## Status

| ID | Title | Wave | Status |
|----|-------|------|--------|
| 1a | Headless browser tool (Playwright/CDP) | 1 | done ✅ |
| 1b | Structured tool-approval gate | 1 | done ✅ |
| 1c | First-class MCP client | 1 | done ✅ |
| 2a | Cron-triggered agent runs | 2 | done ✅ |
| 2b | Durable workflow / job queue | 2 | done ✅ |
| 2c | Event-driven agents (beyond GitHub) | 2 | done ✅ |
| 3a | Local bridge daemon / CLI | 3 | done ✅ |
| 3b | Sandbox→local state handoff | 3 | done ✅ |
| 4a | Virtual desktop (Xvfb + noVNC) | 4 | done ✅ |
| 4b | New managed-runtime profiles | 4 | done ✅ |
| 4c | Persistent / snapshottable VMs | 4 | done ✅ |
| 5a | Cross-session / project memory | 5 | done ✅ |
| 5b | Multi-repo / monorepo sessions | 5 | done ✅ |
| 5c | Cost/quota + budgets | 5 | done ✅ |

## Integration point reference (from codebase briefing)
- Agent tools: `packages/agent/tools/` (registered in `index.ts`); `bash.ts` has `commandNeedsApproval` + `ToolOptions.needsApproval`; `ask-user-question.ts` is the client-side tool pattern.
- Streaming/UI: UIMessage/UIMessageChunk from `ai` lib; `apps/web/app/types.ts` (`WebAgentUIMessage`); `packages/shared/lib/tool-state.ts` (approval-requested/output-denied states).
- Sandbox: `packages/sandbox/interface.ts` (`exec`, `execDetached`, `domain(port)`); `packages/sandbox/vercel/sandbox.ts`; `packages/sandbox/managed-runtime-profiles.ts` (profile shape).
- Workflow: `apps/web/app/workflows/chat.ts` (`runAgentWorkflow` → `openAgent`); `workflowRuns` table.
- Webhooks: `apps/web/app/api/github/webhook/route.ts`.
- DB schema: `apps/web/lib/db/schema.ts` (sessions, chats, sandboxServices, sandboxBrowserRuns, workflowRuns, githubInstallations; usage tracking in `usage.ts`).
- No existing: cron config, scheduled_jobs, MCP client, durable persistence, memory tables, budget enforcement.

## Wave 1 results (Tool Use) — DONE
- **1a Browser tool**: Playwright toolset (navigate/click/type/extract/screenshot), 18 assertions pass against real Chromium; AI SDK image-part path proven (byte-verified PNG). Cold Chromium install measured at 211s. Verdict: layer on top of agent-browser, do not replace.
- **1b Approval gate**: `withApproval(tool, policy)` wrapper, 22 assertions across park/approve/deny/safe paths; side-effect marker proves no execution while parked/denied. Durability across serverless restart depends on POC 2b.
- **1c MCP client**: real stdio round-trip to official MCP servers, namespaced tools merge into existing ToolSet with no glue. Finding: AI SDK adapts MCP tools without client-side arg validation — server is the validation boundary. Run stdio servers inside the sandbox, not the web process (RCE risk).

## Wave 2 results (Scheduled Cloud Processes) — DONE
- **2a Cron agents**: scheduled_jobs + scheduled_job_runs schema, /api/cron/run handler (timing-safe CRON_SECRET), 23 assertions on live sqlite at controlled clock; correct due-matching, idempotency, 401 unauth. DISCOVERY: repo already has backgroundAgentTriggers (schedule.cron kind) + /api/background-agents/cron route — POCs validate/extend existing direction.
- **2b Durable workflow**: durable engine proving crash-resume-without-re-execution across two real OS processes (SIGKILL + fresh process sharing only a SQLite file); non-idempotent side effect fired exactly once. VERDICT: adopt Vercel Workflow DevKit backed by world-postgres on Neon (lower lock-in than external queue). Unblocks 1b/2a/2c durability.
- **2c Event-driven**: source-agnostic pipeline (GitHub/AgentMail/Vercel-deploy/Sentry/generic), 53 assertions, 4 real HMAC schemes verified, dedup + multi-rule fan-out + PR-close no-regression proven. Production already has dispatchBackgroundTriggerEvent → runBackgroundAgentWorkflow.

## Wave 3 results (Local Hand-offs) — DONE
- **3a Local bridge**: `bridge` daemon over real websocket, 22 assertions. 5-layer default-deny security model (shape → allow/deny → working-dir jail → path-arg jail → env allowlist), re-checked at spawn time (TOCTOU defense), shell:false argv-only. Proved approval-is-not-sufficient (out-of-scope blocked even when approved), diff apply + clean rollback, auth rejected at websocket upgrade. Highest-risk POC — needs OS-level sandbox (seatbelt/bwrap/landlock) + short-lived tokens for production.
- **3b Sandbox↔local handoff**: byte-exact fidelity BOTH directions via single git bundle carrying three trees (head/index/worktree) reconstructing staged/unstaged/untracked/deleted/exec-bit/binary split. Disproved git stash (drops untracked) and git diff (loses untracked, mangles binaries). Every op is an exec-able git command → drops into sandbox seam. Risk: secrets in uncommitted files transit the bundle (treat as sensitive); LFS blobs need separate fetch.

## Wave 4 results (Desktops / Browsers / VMs) — DONE
- **4a Virtual desktop**: full Xvfb + metacity + TigerVNC + noVNC stack built and run in Docker. Proved live desktop end-to-end: valid 1280x800 screenshot of rendered xterm + VNC RFB 003.008 handshake over websocket bridge. Blind spot caught: AL2023 lacks x11vnc/fluxbox/novnc packages → use tigervnc-server (x0vncserver) + metacity + pip websockify. Risk: secure the exposed VNC port (POC used SecurityTypes None).
- **4b Runtime profiles**: Python/Go/Rust/Docker-in-sandbox profiles each actually compiled+ran a program in clean containers. Blind spots caught only because programs ran: Rust needs cc linker; Docker-in-sandbox needs --storage-driver vfs + privileged tier. Verdict: cheap, purely declarative, zero code change to register.
- **4c Snapshottable VMs**: MAJOR FINDING — Vercel Sandbox snapshot/hibernation is GA and sub-second (p75 40s→sub-second; filesystem-only; onResume hook relaunches services; 5h/session cap, iad1-only). 'Hard' flag was overcautious. State machine + byte-restore + service-relaunch proven; multi-day task survives two hibernate/resume cycles. Use Vercel auto-persistence, not a custom provider.

## Wave 5 results (Cross-cutting Enablers) — DONE
- **5a Memory**: agent_memories with pgvector (prod) / local-embedder seam (offline eval), 21 assertions. Proved retrieval relevance RANKING (auth query→Better Auth #1; rate-limit→429 memory #1), strict per-user/per-repo scoping (zero cross-tenant leak), dedup-by-merge. AI Gateway embeddings (provider/model string) drop into the seam for prod. Risks: prompt-injection via stored memories (label as untrusted), staleness/contradiction, context-budget for injected memories.
- **5b Multi-repo**: session_repos model + coordinator + PathRouter, 20 assertions on real git repos. Coordinated api+consumer change with per-repo branch isolation (no cross-contamination), outside-path rejection, linked-PR plan with shared changeSetId. VERDICT: Medium not Hard — git working trees are per-directory; hard parts are organizational (no atomic cross-repo merge on GitHub, CI coupling, cross-installation perms). Single-root lock-in today is resolveWorkspacePath/path-security.ts.
- **5c Budgets**: budget model + UsageMeter + checkBudget (ALLOW/WARN/BLOCK) + loop gate, 57 assertions. Proved over-budget step NEVER runs (workDone=2 of 3), most-restrictive-scope wins (user vs session), duration budgets, period resets, estimate-vs-actual reconciliation. Seam: before runAgentStep in chat.ts (~L1226) + after usage accumulation (~L1263). Risk: concurrent runs racing the shared meter need atomic RMW/row-lock.

## Cross-POC dependency map (load-bearing findings)
- **2b durability is the keystone**: 1b (approval park), 2a (cron run survival), 2c (triggered run survival) all depend on durable suspend/resume surviving function teardown. 2b proved it (crash-resume across 2 OS processes) and the verdict is: adopt Vercel Workflow DevKit + world-postgres on Neon.
- **3b git-bundle three-tree insight** (head/index/worktree) is reused by **4c** snapshot fallback (reconstruct-from-archive on a fresh sandbox) and underpins **5b** per-repo state capture.
- **1b approval gate** is the shared primitive for **3a** local-exec sign-off (same park/approve/deny contract; tool-state.ts states).
- **4c finding** (Vercel snapshot/hibernation is GA + sub-second) de-risks long-running/standing agents (2a) and the desktop use case (4a) — no custom snapshot provider needed; use auto-persistence + onResume.
- **Repo already moving this way**: backgroundAgentTriggers (schedule.cron + conditions), /api/background-agents/cron, dispatchBackgroundTriggerEvent → runBackgroundAgentWorkflow, interface.ts snapshot(), sandboxServices.relaunchOnResume. Several POCs validate/extend existing direction rather than greenfield.

## Overall feasibility verdict
| POC | Original flag | Verdict after POC |
|-----|---------------|-------------------|
| 1a Browser tool | Medium | Confirmed Medium — works; layer on agent-browser; Chromium install ~211s is the cost |
| 1b Approval gate | Medium | Confirmed Medium — contract proven; durability rides on 2b |
| 1c MCP client | Medium | Easier — merges into ToolSet with no glue; run stdio servers in sandbox (RCE) |
| 2a Cron agents | Medium | Confirmed — schema+wiring done; durability rides on 2b; cron freq limits noted |
| 2b Durable workflow | Hard | Tractable — DevKit + world-postgres; crash-resume proven |
| 2c Event-driven | Medium | Confirmed — source-agnostic pipeline; per-source HMAC handled |
| 3a Local bridge | Medium-Hard | Confirmed Medium-Hard — security model is the work; needs OS-level sandbox |
| 3b Sandbox↔local | Easy-Medium | Easy — byte-exact via git bundle both directions |
| 4a Virtual desktop | Medium-Hard | Confirmed Medium-Hard — stack proven; package substitutions on AL2023; secure the VNC port |
| 4b Runtime profiles | Easy-Medium | Easy — purely declarative, zero code change |
| 4c Snapshot VMs | Hard | Easier — Vercel snapshot/hibernation GA + sub-second |
| 5a Memory | Medium | Confirmed Medium — pgvector + AI Gateway; relevance+scoping proven |
| 5b Multi-repo | Hard | Medium — git trees per-directory; org constraints are the hard part |
| 5c Budgets | Medium | Confirmed Medium — enforcement seam proven; meter concurrency is the risk |
