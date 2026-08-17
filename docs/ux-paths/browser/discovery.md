# App Discovery: Open Agents (browser UX)

> Scope note. This is the **browser-journey** map, generated 2026-08-17 for a
> `/ux-walker` pass against a running local app. It is deliberately separate from
> `docs/ux-paths/discovery.md`, which is an **API-centric** map from 2026-08-06
> aimed at exercising `/api/**` with curl. Neither supersedes the other; they
> answer different questions. Do not merge them.

## Application Type

Web application — a cloud agent-coding platform. A user connects GitHub, starts a
durable sandboxed **Session** against a repo, watches an agent work in a Vercel
Sandbox VM, reviews the diff, and opens/merges a PR. The same platform runs
unattended **Background Agents** (GitHub-webhook and cron triggered) and **Agent
Loops** (graph-based multi-step orchestration), plus a hosted **MCP server** that
lets external agent clients drive sessions headlessly. There is a separate mobile
route group (`/m/*`) and a small set of public surfaces.

## Tech Stack

- Next.js 16.2.1 App Router, React 19.2.3, TypeScript. **No `middleware.ts`** —
  auth is enforced per-layout/per-page/per-route-handler.
- SWR for client data; React Context per surface; AI SDK `@ai-sdk/react` for the
  chat stream. No Redux/Zustand.
- better-auth 1.6 with **Vercel OAuth** (primary sign-in) and **GitHub OAuth**
  (account linking for repo access). Account linking enabled, tokens encrypted.
  better-auth `mcp` plugin provides OIDC for MCP clients.
- Postgres (Neon) + Drizzle, ~68 tables. Redis for rate limiting + skills cache.
- Vercel Sandbox (Firecracker microVMs) behind `@open-agents/sandbox`; Vercel
  Workflow for durable runs.
- Tailwind + shadcn/Radix primitives, `@xyflow/react` for the loop builder canvas,
  `@pierre/diffs` for diff rendering, `cmdk` comboboxes.

## User Roles

Two roles plus capability tiers — not full RBAC.

- **Authenticated user** — owns sessions, chats, automations, runs, repos,
  settings. Every query scoped by `userId`; cross-user access redirects or 404s.
- **Workspace admin** — `users.isAdmin`; unlocks the Admin settings group and
  `/settings/admin`. Non-admins hitting the URL get an honest gate, not a fake 404.
- **Signed-out visitor** — landing, `/deploy-your-own`, public profiles, shared chats.
- **MCP client** — machine identity authorized via `/mcp/login` → `/mcp/consent`,
  acting under scopes (`sessions:read`, `sessions:write`, `agents:*`, `sandbox:exec`).
- **Cron / webhook caller** — bearer `CRON_SECRET`, GitHub HMAC, or per-trigger public id.

Capability tiers gate UI like roles do: GitHub linked → App installed (per-org) →
repo permission (`read`/`write`) → repository allowlist for unattended agents →
per-agent tool grants.

## Feature Map (condensed)

**Auth & onboarding** — Vercel sign-in; link GitHub; install the GitHub App per
account/org with repo selection; reconnect when scopes go stale; onboarding gate
redirects to `/get-started` until a GitHub account **and** ≥1 installation exist.

**Sessions** — create against a repo or "empty"; pick repo, branch (existing or
new), runtime mode (`classic` vs `managed_runtime`), optional Vercel project link,
git defaults (auto-commit/push, auto-PR, full vs shallow clone); rename, archive,
delete; multiple chats per session with tabs; fork, resend, delete-and-after;
share/unshare publicly; mark read; debug bundle.

**Chat loop** — composer with `@`-file mentions, `/` slash commands, image and text
attachments, voice→`/api/transcribe`; model selector, inference profiles, Composio
tool selector, workflow picker, runtime mode selector; stop and resume a stream;
tool-call rendering with thinking blocks, TODO panel, goal ledger; **tool approval**
(Approve / Deny / Approve all); inline agent questions; context usage indicator;
MCP run lock when a headless client holds the slot.

**Workspace runtime** — sandbox status pill (Creating, Restoring, Hibernating,
Reconnecting, Paused, Active, Connection issue, No sandbox, Archived); resume from
snapshot; reconnect; extend timeout; file tree and viewer; dev server start/stop/logs;
hosted code editor at `/codespace/[sessionId]`; managed-runtime profile manager and
test; browser runs; session skills.

**Git / diff / PR** — right panel with **Files / Changes / PR** tabs (`Cmd+Shift+B`);
diff viewer with per-file focus; discard a file; AI commit message; commit and push;
create branch; create PR with AI title/body; close PR; merge via **Squash / Merge /
Rebase** ("… & Archive"); merge-readiness polling and CI check runs; preview
deployment URL.

**Background agents** — CRUD bound to a repo with instructions, model, tool
allowlist, Composio grants, per-action GitHub toggles, write scope, CI-green
requirement, run budget; seven trigger kinds; readiness check and tool preflight;
manual test run; run list/detail/live SSE; statuses `queued|running|succeeded|failed|skipped|cancelled`.

**Agent loops** — create from template or scratch; visual builder canvas (nodes:
start / agent step / gate / end); lifecycle `draft → active ⇄ paused → archived`;
guardrails (max steps, iterations, duration, step timeout); watchdog with retry
budget; triggers; run control **pause / resume / cancel / retry**; stalled-run sweep.

**Runs & automations** — unified `/runs` feed across `chat_workflow | background_agent
| agent_loop` with state, outcome, health, and attention reasons; `/automations`
list over both automation sources with filters and configuration health.

**Repositories** — `/repos` directory; repo dashboard with collapsible windows;
GitHub Actions (runs, jobs, logs, rerun, cancel, dispatch); Actions secrets
(libsodium-encrypted); per-repo defaults and Composio policy.

**Settings** — grouped nav: Account (Profile, Preferences, Connections, Usage) →
Workspace (Chat roles, Models, Composio, MCP servers, Skills, Repository settings) →
Advanced (Runtime profiles, Learnings, Leaderboard) → Admin (admin only).

**Public surfaces** — landing; `/deploy-your-own`; `/[username]` and `/u/[username]`
usage profiles; `/shared/[shareId]` with env redaction; `/mcp/login` and
`/mcp/consent`; `/.well-known/oauth-*`.

**Mobile `/m/*`** — bottom tab bar (Activity / New / Me) plus a pushed full-screen
chat with its own composer and tool-approval bar.

**Flag-gated** — GTM suite (`OPEN_AGENTS_EXPOSE_GTM`), Verified Build panel
(`OPEN_AGENTS_EXPOSE_VERIFIED_BUILD`), workflow catalog
(`OPEN_AGENTS_EXPOSE_WORKFLOW_CATALOG`), harness (`HARNESS_ENABLED`), and the
subsystem switches `AGENT_LOOPS_ENABLED` / `BACKGROUND_AGENTS_ENABLED`.

## Navigation Structure

**Primary rail** (`components/workspace-navigation.tsx`) — Sessions, Runs,
Automations, Repositories, Settings; expanded / collapsed / mobile-sheet modes.
Legacy paths fold into the right active item (`/background-runs/*` → Runs;
`/loops/*` → Automations).

**Left sidebar** (`inbox-sidebar.tsx`) — sessions grouped by repository with
subgroups, per-group actions, inline rename, archive.

**Session workspace** — three zones: sidebar, center chat, right panel. Chat tabs
plus Changes and File tabs across the top. Right panel switches between `git`,
`verified-build`, and `runtime`.

**Settings** — two-level shell, sign-out pinned bottom, mobile Sheet.

**Comboboxes not a global palette** — `cmdk` powers repo/branch/model/sandbox/tool
pickers. Only documented shortcut: `Cmd/Ctrl+Shift+B` toggles the git panel.

## State Transitions

1. **Sign-in** — landing → Vercel OAuth → `/sessions`.
2. **Onboarding** — `requireOnboarded()`; no GitHub link **or** zero installations
   → `/get-started?next=…`. Sub-states: not linked → linked without installation →
   connected. `?github=<status>`, `?missing_installation_id=1`, `?reconnect=1` alter copy.
3. **GitHub connect** — `linkSocial` → `/api/github/post-link` → App install →
   callback → repos selectable. Org installs may be **pending approval**.
4. **Repo selection** — repo → branch (existing or new) → optional Vercel link →
   runtime mode → git defaults. `lastRepo` pre-fills next time.
5. **Session lifecycle** — `provisioning → active → hibernating → hibernated →
   restoring → active`, with `archived` and `failed` terminal, plus **absent**.
   Reasons: `sandbox-created`, `timeout-extended`, `snapshot-restored`, `reconnect`,
   `manual-stop`, `status-check-overdue`, `headless-turn-end`. A `failed` lifecycle
   with live runtime self-heals to `active`.
6. **Run lifecycle** — a send starts a durable run; `activeRunSource` (`browser` |
   `mcp`) claims the slot; can stop, pause for approval, or end with an outcome.
7. **PR lifecycle** — none → open → checks → merged | closed; merge offers
   "… & Archive" which archives the session.
8. **Automation lifecycle** — agent `disabled ⇄ enabled`; loop `draft → active ⇄
   paused → archived`.
9. **MCP authorization** — register → `/mcp/login` → `/mcp/consent` (forced every
   time) → scoped token.

### Run outcomes (13), precedence-ordered

`failed` → `aborted` → `repeated_tool_failure` → `max_steps` → `no_progress_fuse` →
`no_file_changes` → `no_sandbox_step_cap` → `step_ceiling` → `truncated` →
`diff_violation` → `awaiting_tool_approval` → `ended_unexpectedly` → `completed`.

Notable for journeys: `awaiting_tool_approval` is **not a failure** (normalizes to
`waiting`); `completed` is **not** proof the work is good; `no_file_changes` and
`diff_violation` only fire when the caller declared an expectation.

## Data Entities (user-visible, CRUD-able)

Session, Chat, Chat message, Share, GitHub installation, Vercel project link,
Background agent, Trigger, Background agent run, Agent loop, Agent loop run,
Workflow run, Workflow tool approval, Inference profile, Model variant, User skill,
MCP server, Composio tool profile, Repository settings, Managed runtime profile and
draft, Sandbox service, Repo learning, Usage event, User preferences, Agent (chat
role), Session event.

## Integrations

GitHub App (installation tokens, PRs, merges, check runs, Actions, secrets, repo
creation, inbound HMAC webhook) · GitHub OAuth (identity + `repo` scope) · Vercel
OAuth (sign-in) · Vercel Sandbox · Vercel Workflow · Vercel projects/deployments ·
Composio (user profiles, per-repo policy, per-chat selection) · hosted MCP server
(10 tools, 5 scopes, dynamic registration, forced consent, PKCE) · AI Gateway and
BYO-key inference profiles · ElevenLabs transcription · Redis · Neon Postgres ·
Vercel Analytics · BotID.

## Error and Empty States

**Only two `error.tsx` files exist** — the chat page and the shared-chat page. There
is **no `global-error.tsx`** and no root `error.tsx`, so a throw outside those two
subtrees falls through to the Next.js default. Worth walking.

`not-found.tsx` for chat. `loading.tsx` at repos, profiles, session, chat, shared,
settings and six settings subroutes, plus many per-section skeletons.

**Empty states** — sessions index, inbox sidebar, repo-picker scope, leaderboard,
learnings, skills, runtime profiles, repository secrets, admin gate, every combobox
`CommandEmpty`, automations ("No automations match these filters" → **Clear
filters**, distinct from "create your first automation"), sandbox activity.

**Typed API error kinds** — `unauthorized` 401, `forbidden` 403, `not_found` 404,
`invalid_request` 400, `conflict` 409, `rate_limited` 429, `upstream_unavailable`
503, `internal_error` 500, `gone` 410, `not_implemented` 501.

**Domain error kinds** — `github_scope_required`, `automation_definition_invalid`,
`feature_disabled`, `source_unavailable`, `invalid_filters`, allowlist
`missing|invalid|not_listed`, run attention reasons (`blocked, cancelled, failed,
failed_steps, stale, stalled, unknown_status, waiting_on_user`).

**Auth nuance** — a transient auth-check failure on top of cached data does **not**
unmount authenticated UI; only a real 401 signs the user out.

## Recommended Story Topics

1. **Authentication, Onboarding & GitHub App Connection** — Vercel sign-in, the
   two-step `/get-started` flow, per-org App installation, pending approvals, and
   the reconnect path; nothing else works until this state machine resolves.
2. **Session Creation: Repository, Branch, Runtime Mode & Git Defaults** — the
   highest-branching form in the app; gates every downstream journey.
3. **Sandbox Lifecycle: Provision, Hibernate, Restore, Reconnect, Fail, Absent** —
   eight persisted states map to nine UI pills and a per-state "why is this
   disabled" string; resume-from-snapshot and connection-issue are where users stick.
4. **The Chat Loop: Composer, Tools, Approvals & the 13 Run Outcomes** — one journey
   per non-`completed` outcome, plus attachments, voice, slash commands, mentions,
   stop/fork/resend, and approve/deny/approve-all.
5. **Code Review & Ship: Diff, Files, Commit, PR, Checks, Merge, Preview** — the
   product's payoff; three merge methods with archive-on-merge.
6. **Background Agents: Configure, Trigger, Permission-Gate, Test & Observe** —
   seven trigger kinds, readiness and preflight, write scope, run budgets, SSE.
7. **Agent Loops: Template, Builder, Triggers, Watchdog & Run Control** — xyflow
   canvas, guardrails, pause/resume/cancel/retry, stalled-run sweep.
8. **Runs & Automations: Cross-Surface Monitoring, Filtering, Attention Triage &
   Recovery** — filters, facets, health, attention reasons, stale runs, invalid-
   definition banners.
9. **Repository Workspace: Directory, Dashboard, GitHub Actions, Secrets & Vercel
   Link** — the operator-facing half of the product.
10. **Workspace Settings & Configuration** — the 15-route settings shell.
11. **Public & Alternate Surfaces: Shared Chats, Public Profiles, MCP Client
    Authorization, Mobile & Deploy-Your-Own**.
12. **Failure, Empty & Gated States** — the two error boundaries and everywhere
    there isn't one, typed errors, empty lists, rate limiting, archived-session
    lockout, MCP run lock, admin gate, allowlist refusals, feature flags.

## Walk environment (for `/ux-walker`)

- Local app: `http://localhost:3002` (started with `PORT=3002 bun run web`).
- Authenticated via test-auth cookie `open_agents_test_user_id=dev-managed-runtime-user`
  (`lib/session/test-auth.ts`; auto-enabled under `NODE_ENV=development`).
- The fixture user has **25 real sessions**, so lists are populated — empty-state
  and real-data journeys must be walked separately.
- Database is the **dev** Neon branch (`ep-old-union`), migrated to current head.
- Confirmed 200: `/sessions`, `/repos`, `/settings`, `/loops`. `/` and
  `/get-started` return 307 when signed in.
