# Portable Designs from Open Agents — for the Resident-Agent Rebuild

Companion to `docs/plans/resident-agent/portable-lessons.md` (operational scar
tissue). This document extracts architectural DESIGNS — schemas, state
machines, tool surfaces, protocols — worth carrying into the Cloudflare
Durable-Object/Workflows/Sandbox rebuild. It does not repeat lessons already
captured there.

All line numbers verified 2026-08-11 against the working tree at
`/Users/dennison/develop/open-agents` (branch `fix/composite-profile-availability`).

## TL;DR

The strongest transferable pieces are: (1) the MCP tool registry's
scope-per-tool + typed-error-envelope pattern, directly reusable for an
MCP-front-door DO; (2) the `chats.activeStreamId` compare-and-set lease
protocol, which is the exact shape a Durable Object's single-writer turn state
needs, just made free by the DO's actor model instead of hand-rolled CAS SQL;
(3) the background-agent run/event/tool-session schema (state machine +
append-only ledger with a `force`-gated terminal-status guard) as the
blueprint for the resident-agent's own run ledger; and (4) the managed-runtime
"profile declares its own toolchain + setup + verification commands, rolled
up into a typed pass/fail/blocked status" pattern, which maps almost
1:1 onto pluggable "brain profiles." The sandbox lifecycle workflow's
sleep-loop-that-reschedules-itself is the cleanest available template for a
Durable Object alarm loop. Everything Next.js/Vercel-specific (workflow
`"use step"` directives, `after()` deferral, Turbo env allowlists) should die;
the *shapes* above are stack-independent.

---

## 1. MCP server — auth, scopes, registry, error shaping

**Files:**
- `apps/web/app/api/mcp/[transport]/route.ts` (169 lines)
- `apps/web/lib/mcp-server/context.ts` (146 lines)
- `apps/web/lib/mcp-server/registry.ts` (94 lines)
- `apps/web/lib/mcp-server/tools/sessions-read.ts` (625 lines)
- `apps/web/lib/mcp-server/tools/sessions-write.ts` (427 lines)
- `apps/web/lib/auth/config.ts:153-187` (OAuth/OIDC scope wiring)

**Schema/protocol, quoted:**

Scope vocabulary (`context.ts:3-9`), five declared, two unused:
```ts
export const MCP_SCOPES = [
  "sessions:read",
  "sessions:write",
  "agents:read",
  "agents:write",
  "sandbox:exec",
] as const;
```
Confirmed by grep: `"agents:read"`, `"agents:write"`, `"sandbox:exec"` appear
**only** in `context.ts` and `registry.test.ts` — no registered `McpToolDefinition`
declares any of the three as its `scope`. They are reserved vocabulary,
advertised in the OAuth discovery metadata (`auth/config.ts:176-184`,
`metadata.scopes_supported`) before any tool exists to use them — i.e. the
scope catalog and the consent screen are decoupled from tool ship dates on
purpose.

Error taxonomy (`context.ts:23-33`), with a documented SDK caveat:
```ts
export const MCP_ERROR_KINDS = [
  "unauthorized", "forbidden_scope", "not_found", "invalid_request",
  "rate_limited", "conflict", "internal_error",
] as const;
```
The doc comment above it (`context.ts:13-22`) notes `invalid_request` rarely
reaches the wire because the MCP SDK validates Zod-schema violations *before*
`runMcpTool` dispatches — worth knowing so a rebuild doesn't duplicate
validation-error handling the transport already does.

Tool definition shape (`registry.ts:7-28`):
```ts
export type McpToolDefinition<TSchema, TOutput> = {
  name: string; description: string; scope: McpScope; inputSchema: TSchema;
  handler(ctx: McpToolContext, input: z.infer<TSchema>): Promise<TOutput>;
};
```
Dispatch (`registry.ts:55-93`): lookup by name → `requireScope` throws
`forbidden_scope` → `inputSchema.safeParse` throws `invalid_request` → handler
runs → unclassified handler errors are caught and rethrown as
`internal_error` (never leak raw messages).

Auth handshake (`route.ts:81-165`, quoted for the load-bearing check
better-auth's own plugin does NOT do):
```ts
const mcpAuthHandler = withMcpAuth(mcpChallengeAuth, async (req, session) => {
  const expiresAt = session.accessTokenExpiresAt
    ? new Date(session.accessTokenExpiresAt).getTime() : Number.NaN;
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    ... return unauthorizedResponse(req);
  }
  const limited = await checkRateLimit({ key: rateLimitKey(["mcp", session.userId]),
    limit: MCP_RATE_LIMIT /* 60 */, windowMs: MCP_RATE_LIMIT_WINDOW_MS /* 60_000 */ });
  ...
```
`route.ts:46-51` documents *why*: `withMcpAuth`'s session lookup is a bare
`findOne` that never compares `accessTokenExpiresAt` to now, so the plugin's
advertised 1-hour token lifetime is fiction unless the caller adds this check.

Each registered tool call is wrapped uniformly (`route.ts:113-158`): success →
`{ content: [{ type: "text", text: JSON.stringify(result) }] }`; failure →
`{ isError: true, content: [{ type: "text", text: JSON.stringify(toMcpErrorPayload(error)) }] }`,
with structured `mcp.tool.invoked` / `mcp.auth.rejected` / `mcp.tool.failed`
log events carrying `requestId`, `toolName`, `latencyMs`, `outcome`.

Tool context construction and ownership pattern
(`sessions-read.ts:287-307`, repeated in `sessions-write.ts:42-62`):
```ts
async function requireOwnedSessionMetadata(ctx, sessionId) {
  const record = await getSessionMetadataById(sessionId);
  if (!record || record.userId !== ctx.userId) {
    throw new McpToolError("not_found", `Session ${sessionId} was not found.`);
  }
  return record;
}
```
Ownership check returns `not_found`, not `forbidden` — deliberately
indistinguishable from "doesn't exist" to avoid leaking existence of other
users' resources.

Eight tools total: five read (`whoami`, `list_sessions`, `get_session`,
`get_messages`, `get_diff_summary`, scope `sessions:read`) and three write
(`start_session`, `send_message`, `stop_run`, scope `sessions:write`).
`start_session`/`send_message` route through `createSessionCore` and
`startChatRun` — the exact same core functions the browser UI uses (see §2) —
so an MCP-originated session picks up the user's default model, repo
defaults, and Composio selection instead of silently falling back to schema
defaults (`sessions-write.ts:247-254`).

**What it gets right:**
- Scope-per-tool with a reserved-but-unused scope vocabulary decouples the
  OAuth consent surface from tool rollout.
- One typed error envelope (`errorKind` + `message` + optional `details`)
  used identically at the transport boundary and inside every handler.
- MCP write tools reuse the *exact* application core functions the primary UI
  uses (no parallel "MCP session creation" code path to drift).
- `stop_run` is deliberately non-throwing on an unowned/missing chat id —
  degrades to `activeStreamId: null`, which the CAS-based stop function
  already treats as a safe no-op (`sessions-write.ts:160-190`).

**What I would change:**
- The manual `accessTokenExpiresAt` check patched onto a stock auth plugin is
  a footgun waiting to regress — build expiry checking into the auth layer
  itself rather than the route.
- Rate limiting is per-user only (`rateLimitKey(["mcp", session.userId])`);
  no per-tool or per-scope limit exists, so one hot tool can exhaust a user's
  entire 60-req/min budget for every other tool.
- The reserved `agents:*`/`sandbox:exec` scopes have no tools yet — fine as a
  placeholder, but track this as tech debt, not a finished design; verify at
  build time (not just by grep) that every declared scope maps to at least
  one tool before a release ships new tools under it.

**Maps to resident-agent as:** The MCP front door is a Worker terminating
OAuth (same RFC 9728 protected-resource / dynamic-client-registration shape)
in front of the Durable Object registry. Port the `McpToolDefinition` shape
(name/scope/inputSchema/handler) verbatim as the contract each DO-exposed
tool implements; port the error-kind taxonomy and the "handler exceptions become
`internal_error`, only `McpToolError` subclasses leak detail" discipline.
`agents:read`/`agents:write` are natural candidates for "manage worker
registry" scopes once the DO-per-worker registry exists; `sandbox:exec` maps
directly to "run a command in this worker's Sandbox container."

---

## 2. Session/turn spine — createSessionCore, startChatRun, the activeStreamId lease

**Files:**
- `apps/web/lib/sessions/create-session.ts` (216 lines)
- `apps/web/lib/chat/start-run.ts` (294 lines)
- `apps/web/lib/chat/stop-run.ts` (57 lines)
- `apps/web/lib/db/sessions.ts:571-635` (CAS primitives)

**Schema/protocol, quoted:**

`createSessionCore` (`create-session.ts:84-215`) is a pure precedence
resolver, not a DB-only insert. The precedence rule, stated once and applied
identically to five different fields
(`create-session.ts:107-144`):
> "request body > repo defaults > user preferences > system default"

It creates the session row and its first chat in one call to
`createSessionWithInitialChat` (a single transaction — avoids the
orphaned-session-without-a-chat failure mode of two separate inserts), then
fires `kickSandboxPrewarmWorkflow` only for repo-backed sessions
(`create-session.ts:206-212`). A no-repo ("New Chat") session gets
`sandboxState: null, lifecycleState: null` (`create-session.ts:186-188`) —
sandbox provisioning is opt-in per session, not universal.

`startChatRun`'s lease handshake (`start-run.ts:212-293`) is the single-writer
protocol for "is a turn already running on this chat":

```ts
export type StartChatRunResult =
  | { status: "started"; runId: string; readable: () => ReadableStream<unknown> }
  | { status: "resumed"; runId: string }
  | { status: "conflict"; runId: string; cancelledRunId?: string };
```

`reconcileChatRunSlot` (`start-run.ts:135-153`) resolves an existing
`chats.active_stream_id` against the live workflow runtime with three
outcomes — `resume` (still running, join it), `ready` (stale/absent, safe to
start fresh), `conflict` (another writer keeps re-claiming the slot after
`ACTIVE_STREAM_RECONCILIATION_MAX_ATTEMPTS` = 3 bounded retries,
`start-run.ts:70,90-121`).

CAS primitives (`db/sessions.ts:585-635`):
```ts
export async function compareAndSetChatActiveStreamId(chatId, expectedStreamId, nextStreamId) {
  const activeStreamMatch = expectedStreamId === null
    ? isNull(chats.activeStreamId) : eq(chats.activeStreamId, expectedStreamId);
  const [updated] = await db.update(chats).set({ activeStreamId: nextStreamId })
    .where(and(eq(chats.id, chatId), activeStreamMatch)).returning({ id: chats.id });
  return Boolean(updated);
}

export async function claimChatActiveStreamId(chatId, workflowRunId) {
  const [updated] = await db.update(chats).set({ activeStreamId: workflowRunId })
    .where(and(eq(chats.id, chatId),
      or(isNull(chats.activeStreamId), eq(chats.activeStreamId, workflowRunId))))
    .returning({ id: chats.id });
  return Boolean(updated);   // true = we now own the slot (idempotent re-claim included)
}
```
`claimChatActiveStreamId` is the *idempotent claim* — it succeeds both on a
null slot and on a slot already equal to the caller's own run id, so a
workflow that self-claims its slot as its first durable step doesn't race
itself. `start-run.ts:250-286`: if the claim after `start()` is lost, the
just-started duplicate run is explicitly cancelled and awaited (not
fire-and-forget — an unawaited cancel that rejects would leave an orphaned,
billing run) and the conflict result reports the *winning* run id, never the
one just cancelled.

`stopChatRun` (`stop-run.ts:23-56`) is the mirror: cancel the workflow, then
CAS-clear `activeStreamId` from the specific id being stopped to `null` — a
plain `updateChatActiveStreamId(chatId, null)` would be wrong because a newer
run could have claimed the slot in between.

**What it gets right:**
- One column (`chats.activeStreamId`) is the entire concurrency-control
  surface for "is a turn running," and every mutation to it goes through CAS
  — no raw `UPDATE ... SET active_stream_id` anywhere outside these two
  primitives (verified: only two write functions touch the column plus the
  idempotent claim).
- The three-way `started`/`resumed`/`conflict` result type forces every
  caller (HTTP route, MCP tool) to handle "someone else already started this"
  explicitly rather than accidentally double-starting a billable run.
- `createSessionCore` centralizes defaults precedence so a second entry point
  (MCP) cannot silently diverge from the browser's behavior.

**What I would change:**
- This is hand-rolled optimistic concurrency control over a shared Postgres
  row precisely because there is no actor boundary. A Durable Object makes
  the entire CAS dance unnecessary — keep the *state machine* (started /
  resumed / conflict; claim is idempotent; only the owner clears) but drop
  the SQL.
- The reconciliation retry loop's bound (3 attempts) is a magic number with
  no documented derivation — if ported as a heuristic anywhere, name why 3.

**Maps to resident-agent as:** The Durable Object *is* the activeStreamId
lease, made free — one DO instance per worker/task gives single-writer
semantics without CAS. Keep the three-outcome contract (`started`/`resumed`/
`conflict`) as the DO's public "start a turn" method signature, and keep the
idempotent-claim discipline for the *Workflow* layer: the turn-Workflow
should self-register its run id with the owning DO as its first step (so a
killed HTTP-equivalent request doesn't strand an unclaimed run), exactly
mirroring `claimChatActiveStreamId`'s "idempotent even from inside the
started work" shape. `createSessionCore`'s precedence-resolution pattern maps
to "resolve a new worker's config: explicit params > repo/task defaults >
account defaults > system default," reusable verbatim as a design shape.

---

## 3. Background agents — the closest existing worker registry + grants + ledger

**Files:**
- `apps/web/lib/db/schema.ts:1142-1657` (six tables)
- `apps/web/lib/background-agents/config.ts` (277 lines — env-driven policy knobs)
- `apps/web/lib/background-agents/dispatcher.ts` (esp. lines 726-976)
- `apps/web/lib/background-agents/store.ts:693-797` (run status CAS)

**Schema, quoted (table names and enums verbatim):**

`background_agents` (`schema.ts:1142-1226`) — the "worker definition" row.
Grant-relevant columns:
```ts
permissions: jsonb("permissions").$type<BackgroundAgentPermissions>()      // schema.ts:59-68
composioToolkitSlugs: jsonb("composio_toolkit_slugs").$type<string[]>()    // Composio tool grant
builtinToolNames: jsonb("builtin_tool_names").$type<string[] | null>()     // null = role default (all); set = allowlist
githubActions: jsonb("github_actions").$type<BackgroundAgentGithubActions>() // per-action toggles, schema.ts:74-88
writeScope: jsonb("write_scope").$type<BackgroundAgentWriteScope>()        // this_repo | all_repos | specific_repos, schema.ts:94-101
requireCiGreenForMerge: boolean(...).default(true)
runBudgetPerTarget: integer(...).default(10)                              // per (repo, PR) 24h run ceiling
modelId: text("model_id")                                                 // optional explicit model override
```
`BackgroundAgentGithubActions` (`schema.ts:74-88`) is the per-action grant
vocabulary: `open_pull_request`, `comment_on_pr_or_issue`,
`approve_pull_request`, `request_changes`, `merge_pull_request`, `push`,
`delete_branch` — defaults are permissive-but-narrow
(`open_pull_request: true, comment_on_pr_or_issue: true`, everything else
false).

`background_agent_triggers` (`schema.ts:1281-1346`) — one trigger row per
(kind, condition), FK to either an agent OR a (newer, parallel) `agent_loops`
row, enforced by a DB check constraint, not application logic:
```ts
check("background_agent_triggers_owner_check", sql`num_nonnulls(agent_id, loop_id) = 1`)
```
Trigger `kind` enum: `github.pull_request`, `github.pull_request_review`,
`github.deployment_status`, `github.issue`, `github.check_suite`,
`schedule.cron`, `webhook.error`.

`background_agent_runs` (`schema.ts:1348-1449`) — the run/lifecycle table.
Status enum: `queued | running | succeeded | failed | skipped | cancelled`.
Idempotency is a DB-level unique index, not app-level dedup:
```ts
uniqueIndex("background_agent_runs_idempotency_idx").on(table.idempotencyKey)
```
A run row also carries an optional, checked-consistent execution snapshot
(`schema.ts:1444-1447`, a CHECK constraint requiring
`execution_snapshot`/`definition_version`/`definition_hash` to be all-null or
all-three-present with a validated SHA-256 hash format) — a config-drift
guard baked into the schema itself, not a runtime assertion.

`background_agent_events` (`schema.ts:1511-1575`) — the append-only ledger.
Status enum: `started | running | succeeded | failed | blocked | skipped |
info`. `level`: `info | warn | error`. `redactionStatus`: `not_required |
passed | failed | blocked`. Ordering is enforced, not implied:
```ts
uniqueIndex("background_agent_events_run_seq_idx").on(table.runId, table.sequence)
```
The comment at `schema.ts:1564-1569` documents *why*: sequence is computed
non-atomically as `max(sequence)+1`, so the unique index turns a lost race
into a retry instead of a silent sequence collision.

`background_agent_outputs` (`schema.ts:1577-1620`) — one row per
externally-visible side effect (`comment | ready_pr | issue | notification |
none | pr_comment | pr_review | merge | push | branch_delete`), status
`pending | created | failed | skipped`. This is the audit trail of
*mechanical* actions the agent actually took, separate from the event ledger
of *what happened internally*.

`background_agent_tool_sessions` (`schema.ts:1622-1657`) — per-run,
per-role, per-phase tool session tracking: `agentRole: main | explorer |
executor | design`, `phase: investigate | mutate | notify | always`, `status:
planned | ready | failed | skipped`.

**Run status state machine** (`store.ts:693-797`), the actual guard:
```ts
const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "skipped", "cancelled"];
const whereCondition = params.force
  ? eq(backgroundAgentRuns.id, params.runId)
  : and(eq(backgroundAgentRuns.id, params.runId),
        notInArray(backgroundAgentRuns.status, TERMINAL_RUN_STATUSES),
        params.expectedStatuses ? inArray(...) : undefined,
        params.expectedWorkflowRunId ? eq(...) : undefined);
```
A non-forced UPDATE that matches zero rows is disambiguated
(`store.ts:770-793`): if the run exists and is already terminal, it emits a
`background-agent.run.status_conflict` event; a `force: true` (documented at
`store.ts:711-716` as reserved for the stale-run sweeper only) bypasses the
guard entirely to terminalize a genuinely stuck run.

**Stale-run sweep + cron catch-up** (`dispatcher.ts:740-976`):
```ts
const staleAfterMs = Number(process.env.BACKGROUND_AGENTS_STALE_RUN_MS ?? 2*60*60*1000);
```
`sweepStaleBackgroundRuns` runs at the top of every scheduled dispatch pass
(`dispatcher.ts:805-808`), forcibly fails anything older than the threshold,
and records `background-agent.run.swept_stale`
(`dispatcher.ts:772`) with payload `{ staleAfterMs, lastEventAt }`.

Cron catch-up is narrower than "replay every missed window": for a
legacy trigger with `nextRunAt: null`, it seeds one value
(`dispatcher.ts:840-847`); otherwise it fires **the single due window**
(`getDueScheduleTime`, `dispatcher.ts:731-738`) — not a backlog of every
5-minute tick missed since the last run. Schedule state (`lastRunAt`/
`nextRunAt`) is always advanced, even on a duplicate or failed dispatch
(`dispatcher.ts:957-964`, comment: *"a failed run must not wedge the
schedule"*).

**Repo allowlist gating** (`config.ts:17-55`):
```ts
export function getBackgroundAgentRepoAccess(owner, repo): BackgroundAgentRepoAccess {
  const access = checkRepositoryAllowlist(getBackgroundAgentsRepoPolicy(), owner, repo);
  ...
  return { allowed: false, reason: reasonByPolicyReason[access.reason] };
}
```
Three distinct refusal reasons — `repo_allowlist_unconfigured`,
`repo_allowlist_invalid`, `repo_not_allowlisted` — deliberately kept apart so
"nobody configured the allowlist" is distinguishable from "this repo was
checked and refused" in logs and UI (`dispatcher.ts:57-98` maps refusal
reason to log level: `repo_not_allowlisted` is `console.info`, the other two
are `console.warn`, since they indicate misconfiguration rather than
expected policy).

**Run-budget knobs**, all in `config.ts`, all env-overridable with the same
strict-parse-or-default pattern (`POSITIVE_INTEGER_PATTERN`): hard turn cap
(`BACKGROUND_AGENT_MAX_TURNS`, opt-in absolute ceiling per
`config.ts:110-116`, default unset = no cap), no-progress budget
(`BACKGROUND_AGENT_MAX_STALE_TURNS`, default 20), action-repetition
threshold (`BACKGROUND_AGENT_REPETITION_THRESHOLD`, default 6), stall grace
(`BACKGROUND_AGENT_STALL_GRACE_TURNS`, default 5), stall finalize window
(`BACKGROUND_AGENT_STALL_FINALIZE_TURNS`, default 3), and a per-run token
fuse (`BACKGROUND_AGENT_MAX_RUN_TOKENS`, default 50,000,000 — explicitly a
runaway-cost fuse, not a work limit, `config.ts:248-256`).

**What it gets right:**
- The permission model is compositional across four independent axes:
  built-in tool allowlist, Composio toolkit slugs, per-action GitHub
  toggles, and write-scope (which repos). None of these gate each other —
  an agent can have full GitHub write actions but a write-scope of
  `this_repo`, or full write-scope but a builtin allowlist that excludes
  `web_fetch`.
- Idempotency and ordering are DB constraints (`idempotencyKey` unique index,
  `(runId, sequence)` unique index), not app-level "check before insert"
  logic that a race can defeat.
- The `force` escape hatch for the sweeper is narrow, documented at its
  declaration site, and itself produces an audit event — a guard that bends
  under one specific, named condition rather than silently.
- Progress/stall budgets are separated from the raw turn-count budget
  (`#914` in comments: turn count was deprecated in favor of a no-progress
  git-delta budget) — a real production lesson already folded into the
  schema's current shape, worth preserving as-is.

**What I would change:**
- `agentLoops`/`agentLoopRuns`/etc. are a second, structurally similar
  subsystem layered onto the same triggers table via a nullable-FK +
  check-constraint rather than a clean supertype — evidence that this schema
  grew two worker-definition concepts (single-agent vs. graph-of-nodes) where
  a resident-agent rebuild starting fresh should pick one worker/task
  abstraction and not bolt a second one on later via nullable FKs.
- Several budget defaults are annotated "STARTING VALUE... not a validated
  target" (`config.ts:131-138,161-169`) — carry the mechanism, not the
  numbers; they were never tuned from real data at the time this was written.
- `builtinToolNames` is a raw string array with no schema-level tie to the
  actual tool registry — a typo'd tool name silently grants nothing rather
  than failing loudly at agent-creation time (INFERRED from reading the
  column type; did not trace the write-path validator).

**Maps to resident-agent as:** This is the direct template for the
resident-agent's worker registry: `background_agents` → worker definition
(the DO's config, but the compositional grant shape — tool allowlist +
external-toolkit slugs + per-action toggles + write-scope — should be copied
almost verbatim as the DO's persisted grant record); `background_agent_runs`
→ per-turn Workflow run row, with the exact same terminal-status CAS guard
(`force`-gated bypass, reserved for a sweeper) as the pattern for a DO
reconciling a stuck Workflow; `background_agent_events` → the turn ledger
(sequence-numbered, redaction-status-tagged) that should live in the DO's
SQLite storage; `background_agent_outputs` → the record of mechanical
external actions, kept separate from the event ledger so "what the agent did
internally" and "what became visible outside the system" are queryable
independently — directly reusable for auditing MCP client actions.

---

## 4. Managed runtime profiles — pluggable "brain profiles" blueprint

**Files:**
- `packages/sandbox/managed-runtime-profiles.ts` (223 lines)
- `apps/web/lib/managed-runtime/profile-resolution.ts` (117 lines)
- `apps/web/lib/managed-runtime/profile-run-status.ts` (112 lines)
- `apps/web/lib/db/schema.ts:523-591` (`managed_runtime_profile_runs`)
- `apps/web/app/workflows/chat-sandbox-runtime-impl.ts:379-735` (execution)

**Schema/protocol, quoted:**

The profile contract itself (`managed-runtime-profiles.ts:1-20`):
```ts
export type ManagedRuntimeProfileCommand = {
  id: string; label: string; description: string; command: string;
  timeoutMs?: number; required?: boolean;
};
export type ManagedRuntimeProfile = {
  id: string; version: string; displayName: string; description: string;
  setupCommands: ManagedRuntimeProfileCommand[];
  verificationCommands: ManagedRuntimeProfileCommand[];
  expectedTools: string[]; optionalTools: string[]; defaultPorts: number[];
};
```
A profile is entirely declarative shell + metadata — no code path assumes
Node/Bun/Python exists in the sandbox except what the profile's own
`setupCommands` install (comment at `managed-runtime-profiles.ts:22-24`:
*"Managed runtime profiles must declare their own toolchain instead of
assuming Node, Bun, npm, Python, or any other runtime exists in every
sandbox."*). Only one built-in profile exists today,
`web-bun-agent-browser` (`managed-runtime-profiles.ts:106-178`); its install
scripts are idempotent (skip reinstall if the pinned version is already
present, `managed-runtime-profiles.ts:79-85`) and pin exact dependency
versions with an inline postmortem
(`AGENT_BROWSER_VERSION = "0.33.2"`, comment at lines 43-54 explaining a
real production outage from an unpinned upstream packaging change).

Three-tier resolution, never silently substituting (`profile-resolution.ts:45-116`):
```ts
// 1. built_in  — packages/sandbox/managed-runtime-profiles.ts, code-only
// 2. session   — managed_runtime_saved_profiles scoped to (userId, sessionId)
// 3. user_default — managed_runtime_saved_profiles scoped to userId, owner-checked
// else: { ok: false, kind: "profile_not_found", nextAction: ... }
```

Typed error taxonomy + fixed next-action copy (`profile-run-status.ts:36-58`):
```ts
export const MANAGED_RUNTIME_ERROR_KINDS = [
  "profile_not_found", "setup_command_failed", "verification_failed",
  "setup_exec_error", "evidence_write_failed",
] as const;
```
Every kind maps to one fixed, user-facing remediation string
(`NEXT_ACTION_BY_ERROR_KIND`) — the same discipline the lessons doc calls out
generic-error-message failures for, applied here from the start.

Run status rollup — a real small state machine, not a boolean
(`profile-run-status.ts:80-111`):
```ts
// any observation "running"                => "running"
// any REQUIRED observation "failed"         => "failed"
// zero observations                         => "blocked"
// any REQUIRED observation not "passed"     => "blocked"  (e.g. "skipped" never counts as passed)
// else                                      => "passed"
```
This is the exact fix for a named prior bug (`profile-run-status.ts:101-105`,
Codex #825 P2): a required command that merely didn't fail (skipped) must
never roll up to "passed."

Persisted evidence row (`schema.ts:523-591`, `managed_runtime_profile_runs`):
`profileId`/`profileVersion`/`profileDisplayName` snapshot the profile at run
time; `requestedProfileId`/`resolvedProfileId` are explicitly **not**
foreign-keyed (`schema.ts:541-544`: built-in profile ids exist only in code,
so a DB FK is impossible — validated at the app layer instead);
`setupResults`/`verificationResults` are `jsonb` arrays of
`ManagedRuntimeCommandObservation` (`schema.ts:29-39`: `commandId`, `label`,
`status`, `required?`, `exitCode`, `durationMs`, `summary`, `startedAt`,
`finishedAt`) — one row per command, appended incrementally as each command
finishes (`chat-sandbox-runtime-impl.ts:481-494`) so a crash mid-setup leaves
a real partial-progress record instead of nothing.

**What it gets right:**
- Profiles are pure data (id/version/commands), letting the run-status
  rollup, the resolution layer, and the UI all be generic over "any profile,"
  not special-cased per profile.
- The "required vs optional" distinction on both tools (`expectedTools` vs
  `optionalTools`) and commands (`required?: boolean`) means a profile
  can report diagnostic information (e.g. "node unavailable") without that
  failing the run.
- Evidence is written incrementally per-command, not as one blob at the end
  — directly satisfies the "evidence bundle, not self-report" discipline
  from the lessons doc.
- `code-editor-gate.ts` (`apps/web/lib/managed-runtime/code-editor-gate.ts:11-23`)
  shows the pattern extending cleanly: any UI capability gate ("can this
  session use the code editor?") is just a predicate over
  `profile.expectedTools`/`optionalTools`, no separate feature-flag table.

**What I would change:**
- Only one built-in profile exists in production; the "pluggable" claim is
  validated by design (the type/resolution layer is generic) but not yet by
  a second real profile — INFERRED risk, not observed: a second profile
  might reveal assumptions baked into the one instance (e.g. hardcoded
  `AGENT_BROWSER_VERSION`-style install logic that isn't actually
  profile-agnostic).
- User-authored profiles (`managed_runtime_saved_profiles`) carry full
  `setupCommands`/`verificationCommands` as raw shell strings with no
  sandboxing of the *authoring* step itself beyond normal tool-call approval
  — worth deciding deliberately for a rebuild whether brain-profile
  setup/verification commands from an external MCP client need tighter
  containment than from the first-party UI.

**Maps to resident-agent as:** This is close to a direct port. A "brain
profile" (coding-agent CLI + its install/verify steps) is exactly a
`ManagedRuntimeProfile`: `setupCommands` installs the CLI (Claude Code,
Codex, etc.) into the Sandbox container, `verificationCommands` proves it's
on PATH and responds, `expectedTools`/`optionalTools` declare what the
Workflow can assume. The `built_in → session → user_default` resolution
order and the `running/passed/failed/blocked` rollup state machine should be
carried over unchanged; the per-command observation array becomes the
natural shape for what the turn-Workflow's setup step returns (a
DATA-only, `step.do()`-safe payload — see the lessons doc's step-boundary
lesson, not repeated here).

---

## 5. Tool policy per runtime mode — judgment vs. mechanics split

**File:** `packages/agent/open-agent.ts:49-394`

**Schema/protocol, quoted:**

```ts
export const OPEN_AGENT_RUNTIME_MODES = ["classic", "managed_runtime"] as const;
```

Full native tool registry (`open-agent.ts:187-205`): `todo_write`, `read`,
`write`, `edit`, `grep`, `glob`, `bash`, `task`, `ask_user_question`,
`setup_managed_runtime_profile`, `skill`, `web_fetch`,
`browser_navigate`/`browser_click`/`browser_type`/`browser_extract`/`browser_screenshot`.

The `managed_runtime` coordinator's tool set is a hard-coded subset
(`open-agent.ts:211-232`):
```ts
export const MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES = [
  "todo_write", "task", "ask_user_question", "setup_managed_runtime_profile",
  "skill", "web_fetch", PROPOSE_TOOL_NAME, MANAGE_BACKGROUND_AGENT_TOOL_NAME,
] as const;
```
Notice what's **excluded**: `read`, `write`, `edit`, `grep`, `glob`, `bash`.
The comment at `open-agent.ts:218-225` is explicit about why `propose_tool`
and `manage_background_agent` are allowed even though they look like
mutation tools: *"config-write actions, not direct code-execution tools...
execution of any resulting background-agent run is still gated by the
grant/allowlist layer, not by tool visibility here."* — i.e. the coordinator
can decide and configure, but every tool that *executes* is walled off; it
must delegate through `task` to a subagent that runs inside the sandbox.

A second, narrower subset for sandbox-free chat (`open-agent.ts:240-245`):
```ts
export const CHAT_ONLY_TOOL_NAMES = [
  "todo_write", "ask_user_question", "skill", "web_fetch",
] as const;
```

The allowlist-application function makes explicit that grants only ever
narrow *native* tools, never externally-injected ones
(`open-agent.ts:280-295`):
```ts
function applyBuiltinAllowlist(toolSet, allowedBuiltinToolNames) {
  if (allowedBuiltinToolNames == null) return toolSet;
  const allowed = new Set(allowedBuiltinToolNames);
  const result = {};
  for (const [name, toolDef] of Object.entries(toolSet)) {
    if (!BUILTIN_TOOL_NAME_SET.has(name) || allowed.has(name)) result[name] = toolDef;
  }
  return result;
}
```
`getRuntimeModeToolPolicy` (`open-agent.ts:315-394`) layers all of this:
sandbox-free short-circuits to chat-only + caller tools; otherwise merges
base tools with caller-provided (Composio/GitHub) tools, conditionally adds
feature-flagged authoring/manage-agent tools, then — only in
`managed_runtime` mode — intersects down to the coordinator set while still
preserving externally-injected tools, and finally applies the optional
builtin-only allowlist (this is the exact function the background-agent
`builtinToolNames` column from §3 feeds into).

**What it gets right:**
- The judgment/mechanics split is enforced structurally (tool *presence*),
  not by convention or prompt instruction — the coordinator physically
  cannot call `bash` in managed_runtime mode.
- Grants (the allowlist) only ever narrow built-in tools; caller-supplied
  integration tools (Composio, GitHub) always pass through, so a
  misconfigured allowlist can't accidentally kill a user's external
  integrations — a deliberate asymmetry, not an oversight (confirmed by the
  loop structure at `open-agent.ts:382-392`).
- Four independent policy axes (`sandboxFree`, `toolAuthoringEnabled`,
  `manageAgentEnabled`, `allowedBuiltinToolNames`) compose without special
  casing — this is the same "grants are compositional, not hierarchical"
  pattern as the background-agent permission model in §3.

**What I would change:**
- `MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES` and `CHAT_ONLY_TOOL_NAMES` are
  hand-maintained arrays that must be kept in sync with the tool registry by
  discipline, not by a type-level guarantee beyond the `satisfies` clause
  checking membership — a new native tool added to `tools` and forgotten in
  both lists silently becomes coordinator-invisible or chat-only-invisible
  with no compile error forcing a decision either way.

**Maps to resident-agent as:** This is the direct template for the DO's
own tool-exposure policy toward the coding-agent CLI running in the Sandbox
container: the DO (coordinator) should hold only judgment/config tools
(equivalent to `MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES`) and delegate all
actual code execution to the CLI process inside the container via a `task`-
equivalent call — never execute `bash`/file-mutation tools directly from the
DO's own model loop. The allowlist-only-narrows-builtins asymmetry should be
kept: any MCP-client-supplied external tools (future `agents:*`/`sandbox:exec`
scoped operations) should not be subject to the same allowlist that gates
native tools.

---

## 6. Sandbox lifecycle — hibernate/resume, lease claim, evaluator loop

**Files:**
- `apps/web/lib/sandbox/lifecycle.ts` (267 lines)
- `apps/web/lib/sandbox/lifecycle-kick.ts` (133 lines)
- `apps/web/app/workflows/sandbox-lifecycle.ts` (~120 lines)
- `packages/sandbox/interface.ts` (185 lines)
- `packages/sandbox/vercel/snapshot-refresh.ts`

**Schema/protocol, quoted:**

Lifecycle state enum (`lifecycle.ts:19-26`):
```ts
export type SandboxLifecycleState =
  | "provisioning" | "active" | "hibernating" | "hibernated"
  | "restoring" | "archived" | "failed";
```
Reason enum (`lifecycle.ts:28-34`): `sandbox-created`, `timeout-extended`,
`snapshot-restored`, `reconnect`, `manual-stop`, `status-check-overdue`.

Due-time is the min of two independent clocks (`lifecycle.ts:122-146`):
```ts
function getLifecycleDueAtMs(source) {
  const inactivityDueAtMs = getInactivityDueAtMs(source); // hibernateAfter, or lastActivityAt+timeout
  const expiryDueAtMs = getExpiryDueAtMs(source);          // sandboxExpiresAt - buffer, or null
  return expiryDueAtMs === null ? inactivityDueAtMs : Math.min(inactivityDueAtMs, expiryDueAtMs);
}
```

`evaluateSandboxLifecycle` (`lifecycle.ts:170-267`) is the one-shot
evaluator, structured as a sequence of short-circuit skips before any
mutation: `session-not-found` → `session-archived` → `sandbox-not-operable` →
`unsupported-sandbox-type` → `not-due-yet` → `active-workflow`. Only after
all six pass does it write `lifecycleState: "hibernating"`
(optimistic-write-before-verify), connect to the sandbox, **re-check for an
active stream a second time** (`lifecycle.ts:211-214`, in case a turn started
between the first check and the connect), then **re-fetch the session and
compare lifecycle timing** (`lifecycle.ts:216-239`) — if a newer activity
update pushed the due time past `now` while the evaluator was mid-flight, it
aborts hibernation and restores `active` state instead of hibernating stale
data. Only then does it call `sandbox.stop()` and clear state
(`lifecycle.ts:241-249`).

The durable evaluator loop (`app/workflows/sandbox-lifecycle.ts`, `"use
workflow"` body) is a **self-rescheduling `while (true)`**, not a one-shot
that terminates on "not due":
```ts
while (true) {
  const decision = await computeLifecycleWakeDecision(sessionId, runId);
  if (!decision.shouldContinue || decision.wakeAtMs === undefined) {
    await clearLifecycleRunIdIfOwned(sessionId, runId);
    return { skipped: true, reason: decision.reason ?? "no-decision" };
  }
  await sleep(new Date(Math.max(decision.wakeAtMs, Date.now() + SANDBOX_LIFECYCLE_MIN_SLEEP_MS)));
  const evaluation = await runLifecycleEvaluation(sessionId, reason);
  if (evaluation.action === "skipped" &&
      ["not-due-yet", "active-workflow", "snapshot-already-in-progress"].includes(evaluation.reason)) {
    continue;   // reschedule, don't terminate
  }
  await clearLifecycleRunIdIfOwned(sessionId, runId);
  return { skipped: false, evaluation };
}
```
The lease claim itself happens **inside** the workflow's first step
(`computeLifecycleWakeDecision` → `claimLifecycleLease`,
`sandbox-lifecycle.ts:13-32`), which reads current state, refuses if another
run already owns a different `runId`, writes its own id if not already
matching, then **re-reads to verify the write actually landed** before
reporting success — a verify-after-write, not a trust-the-write-succeeded
claim.

`kickSandboxLifecycleWorkflow` (`lifecycle-kick.ts:99-133`) is the outer
trigger: it does a best-effort pre-claim (`claimSessionLifecycleRunId`)
before calling `start()` purely to avoid kicking a duplicate workflow when
one is already running — the *authoritative* claim is the one inside the
workflow itself (`sandbox-lifecycle.ts`'s `claimLifecycleLease`). If
`start()` throws, `lifecycle-kick.ts:38-51` clears the lease it just claimed
(only if still owned) and falls back to running `evaluateSandboxLifecycle`
inline — a durable-workflow-with-synchronous-fallback pattern, not a bare
fire-and-forget.

`Sandbox` interface (`packages/sandbox/interface.ts:78-185`) declares
optional capability methods rather than assuming every backend supports
everything: `execDetached?`, `setGitHubAuthToken?`, `domain?`,
`extendTimeout?`, `snapshot?`, `getState?`. `wasCreated?: boolean`
(`interface.ts:86-94`) lets a caller distinguish "fresh VM" from "resumed
existing one" to skip one-time setup work.

Snapshot result is a native provider id, not a blob (`interface.ts:9-15`):
```ts
export interface SnapshotResult { snapshotId: string; }
```

**What it gets right:**
- The evaluator treats "not due yet" as a *reschedule*, never a terminal
  no-op — the workflow loop is the actual clock, not an external cron
  hoping to catch the right minute.
- Double-checking active-stream state (before AND after connecting to the
  sandbox) and re-verifying lifecycle timing after the connect closes the
  exact race a single check would miss: a turn starting during the
  hibernate-evaluation window.
- The lease claim's verify-after-write step (`sandbox-lifecycle.ts:29-31`)
  treats "I wrote it" and "it's actually mine" as two different facts to
  confirm separately.
- The `Sandbox` interface's optional-method design lets a lesser backend
  (no snapshot support, no detached exec) implement a true subset without
  breaking the type.

**What I would change:**
- The lease/claim logic is split across three files (`lifecycle-kick.ts`
  pre-claims, `sandbox-lifecycle.ts` re-claims and is authoritative,
  `lifecycle.ts` does the actual work) — functionally correct but the
  authority split is easy to misread (I initially mischaracterized which
  layer "really" owns the claim before reading `sandbox-lifecycle.ts:13-32`
  directly; a rebuild should make the authoritative claim owner obvious from
  file/function naming, not from tracing three files).
- `SANDBOX_LIFECYCLE_MIN_SLEEP_MS` floor and the stale-run grace period
  (`SANDBOX_LIFECYCLE_STALE_RUN_GRACE_MS`) are both untraced magic constants
  in this pass — worth pulling their actual values before porting numbers,
  not just the mechanism (not verified in this research pass; see Open
  Questions).

**Maps to resident-agent as:** This is close to the cleanest available
template for a Durable Object alarm loop managing its own Sandbox
container's lifecycle. Port the self-rescheduling loop shape directly: a DO
alarm handler that computes a wake decision, re-arms itself via
`ctx.storage.setAlarm()` on "not due yet," and only terminates the loop on a
genuine terminal outcome. Port the double-check-before-mutating discipline
(check active work before AND after the slow I/O of connecting to the
container) and the verify-after-write lease claim. The state enum
(`provisioning/active/hibernating/hibernated/restoring/archived/failed`)
maps directly onto DO-tracked container lifecycle state; `snapshot?()`
returning a native provider id (not a blob URL) matches how Cloudflare
Sandbox container checkpoints would be referenced.

---

## 7. Subagent delegation — task tool, roster, workspace scoping

**Files:**
- `packages/agent/tools/task.ts` (948 lines)
- `packages/agent/subagents/registry.ts` (36 lines)
- `packages/agent/subagents/roster.ts` (171 lines)
- `packages/agent/subagents/explorer.ts` (118 lines, representative of
  explorer/executor/design)
- `packages/agent/subagents/constants.ts:1` (`SUBAGENT_STEP_LIMIT = 100`)
- `packages/agent/delegated-workspace.ts` (workspace policy schema)

**Schema/protocol, quoted:**

Three registered subagent types (`registry.ts:5-21`): `explorer` (read-only
exploration, tools `read`/`grep`/`glob`/`bash`-read-only), `executor`
(implementation/edits), `design` (frontend UI generation). Each is its own
`ToolLoopAgent` instance with its own model default, own system prompt, own
tool set, own `stepCountIs(SUBAGENT_STEP_LIMIT)` — `explorer.ts:78-117`
shows the shape: hard-coded default model
`gateway("anthropic/claude-haiku-4.5")`, a fixed tool object
(`{ read, grep, glob, bash }`, no `write`/`edit` — enforced by omission, not
prompt instruction, mirroring §5's structural judgment/mechanics split), and
a `callOptionsSchema` requiring `task`, `instructions`, `sandbox`, `model`.

Workspace policy is a three-value declaration, resolved to a two-value
execution mode (`delegated-workspace.ts:9-39`):
```
requestedPolicy: "auto" | "shared" | "isolated"
        ↓ resolveDelegatedWorkspacePolicy(...)
executionMode: "shared" | "isolated"   // "auto" collapses to "shared" unless isolated is explicitly requested
```
Only `executor`/`design` (`task.ts:126`,
`WRITE_CAPABLE_SUBAGENTS = new Set(["executor", "design"])`) can hold a
**shared writer lease** — `explorer` never contends for one, since it never
writes. Acquiring a shared lease captures a workspace baseline and checks
drift (`task.ts:615-653`); a blocked drift check or a denied lease throws a
typed error (`SharedWorkspaceDriftError` / `SharedWriterLeaseConflictError`)
after emitting a terminal `DelegatedWorkerCompletionPacket` — the delegate
never silently proceeds against a workspace someone else is actively
mutating.

Every delegated worker run — regardless of outcome — ends in a
`DelegatedWorkerCompletionPacket` (built via
`buildDelegatedWorkerCompletionPacket`, `task.ts:463-491`) with a `status` of
`completed | blocked | failed | cancelled`, an evidence-ref array (`task.ts:
240-272`: `task_output`, `runtime`, `workspace`, `usage` refs, each pointing
at a specific location in the tool's own output rather than being freeform
text) — this is the same evidence-bundle discipline as §4's managed-runtime
observations, applied to subagent delegation.

Context is scoped to the delegate through `experimental_context`
(`explorer.ts:110-114`, `prepareCall`):
```ts
experimental_context: { sandbox, model, workspacePolicy: options.workspacePolicy },
```
— the delegate receives *only* the sandbox handle, its resolved model, and
its workspace policy; it does not inherit the parent's full conversation,
tool grants, or session context. `roster.ts` layers a per-role override on
top (`applyRosterOverrides`, `roster.ts:121-170`): per-role model selection,
appended instructions, and Composio toolkit slugs, sourced from
`ResolvedAgent` rows upstream and threaded through the same
`experimental_context` channel — "no new schema or DB column," per the file's
own header comment (`roster.ts:1-8`).

Stream provenance discipline (`task.ts:71-91`): only a specific allowlist of
stream part types counts as "the provider actually responded"
(`text-start`, `text-delta`, `tool-call`, `finish-step`, etc.) — `start`/
`start-step` are deliberately excluded because the SDK emits them before the
provider request is even made, so treating them as proof-of-output made a
prior model-failure diagnostic unreachable (`task.ts:72-79`).

**What it gets right:**
- Delegation is structurally isolated: a subagent gets a fresh tool set (no
  `task` tool of its own — no evidence of recursive subagent spawning in
  this registry), a fresh model, and no visibility into the parent's message
  history beyond what's explicitly written into `instructions`.
- The shared-writer-lease + workspace-drift-check pair means two concurrent
  delegates writing to the same workspace is a *detected and refused*
  condition, not an unspecified race.
- Every terminal outcome (success, blocked, failed, cancelled) produces the
  same typed completion-packet shape with evidence refs — a caller doesn't
  need to special-case "how do I know what happened" per failure mode.
- Read-only vs. write-capable is enforced by which tools a subagent type is
  literally given (`explorer` has no `write`/`edit` in its tool object at
  all), the same structural-not-prompted discipline as §5.

**What I would change:**
- The roster/override mechanism (`roster.ts`) is described as "no new
  schema... runtime-only object" — convenient short-term, but it means
  per-role model/instruction overrides have no durable record independent of
  the request that set them; if a resident-agent worker needs an audit trail
  of "which model ran this subagent role and why," this pattern alone won't
  provide it (would need to be logged separately, e.g. into the run ledger
  from §3).
- `SUBAGENT_STEP_LIMIT = 100` is a single flat constant shared by all three
  subagent types regardless of task complexity — INFERRED to be a coarse
  ceiling rather than a tuned-per-role budget (not verified against any
  per-role override in this pass).

**Maps to resident-agent as:** The `task` tool's contract — typed
completion packet, evidence refs, workspace-policy negotiation, structural
(not prompted) read/write capability separation — is the template for how a
resident-agent worker's DO would delegate a sub-task to another worker or to
a sandboxed subprocess. The `experimental_context` scoping-to-only-what's-
needed pattern maps directly to what a Workflow step should pass into a
Sandbox container invocation: sandbox handle, resolved model, workspace
policy — nothing else inherited by default. The shared-writer-lease/drift-
check pair is directly relevant if multiple resident-agent workers can ever
touch the same underlying repo checkout concurrently.

---

## What NOT to carry over

- **`"use step"` / `"use workflow"` directive discipline** (Workflow DevKit
  composition rules) — Cloudflare Workflows has its own step-boundary model
  (`step.do()`); the *lesson* (serialization boundaries, silent
  non-execution) is portable, the specific directive syntax is not.
- **`next/server`'s `after()` deferral** (`sessions-write.ts:98-114`,
  `create-session.ts:37`'s `scheduleBackgroundWork` injection point exists
  *specifically* to work around `after()` only being available inside a
  Next.js request scope) — a Cloudflare Worker has its own
  `ctx.waitUntil()`; the injectable-scheduler pattern itself (so core logic
  never imports the framework-specific deferral primitive) is worth keeping,
  the Next.js-specific fallback-skip logic is not.
- **Turbo env-allowlist / `.env.example` wiring** — no Cloudflare
  equivalent; `wrangler.toml` bindings replace this entirely. (Already
  covered as a *lesson*, not a design, in the companion doc — noted here only
  to flag it's out of scope for this document too.)
- **Postgres-specific CAS SQL** (`and`/`or`/`isNull`/`eq` Drizzle
  compare-and-set in `db/sessions.ts` and `store.ts`) — the *protocol* (CAS
  semantics, idempotent claim, force-gated bypass) is portable; the SQL
  itself should not survive, since a Durable Object's actor model makes
  compare-and-set unnecessary for anything scoped to one DO.
- **`mcp-handler` + `better-auth`'s `withMcpAuth`** as specific npm
  packages — the *shapes* they produce (RFC 9728 protected-resource
  metadata, OAuth scope-per-tool, the 401 challenge format) are standard and
  portable; the packages are Next.js/Node-oriented and unlikely to run
  unmodified in a Cloudflare Worker.
- **`agentLoops` as a second worker-definition concept bolted onto
  `backgroundAgentTriggers` via nullable FK** — flagged in §3 as something
  that grew organically; a rebuild starting fresh should not reproduce the
  two-worker-types-sharing-one-triggers-table shape.
- **Vercel Sandbox-specific snapshot mechanics** (`packages/sandbox/vercel/*`)
  — the `Sandbox` interface's *shape* (optional `snapshot?()`, `execDetached?()`,
  capability-flagged methods) is portable; the Vercel SDK calls underneath
  are not.

---

## Open questions

- Exact values of `SANDBOX_LIFECYCLE_MIN_SLEEP_MS` and
  `SANDBOX_LIFECYCLE_STALE_RUN_GRACE_MS` (both referenced in
  `apps/web/lib/sandbox/config.ts` per the imports in
  `lifecycle-kick.ts`/`sandbox-lifecycle.ts`, not read directly in this
  pass) — needed before porting the numeric tuning, not just the mechanism.
- Whether `builtinToolNames` (background-agent tool allowlist, §3) is
  validated against the live tool registry at agent-creation time or only at
  run time — did not trace the write-path validator; if unvalidated, a
  typo'd tool name silently grants nothing rather than failing at
  configuration time.
- Whether any *other* MCP tool (beyond the eight in the registry) is planned
  to use the reserved `agents:read`/`agents:write`/`sandbox:exec` scopes —
  no roadmap doc for this was consulted in this pass; the scopes exist as
  vocabulary but their intended tool surface is not documented in code.
- Whether subagents (`explorer`/`executor`/`design`) can themselves call
  `task` to spawn a further subagent — the registry shows no such tool in
  any subagent's tool set (`explorer.ts:81-86` has no `task`), suggesting
  delegation is single-level by design, but this was inferred from one
  subagent's tool list, not confirmed by an explicit "no recursion" guard
  read directly.
- The real-world validation status of the "pluggable profile" claim in §4:
  only one built-in `ManagedRuntimeProfile` exists in this codebase. Whether
  the abstraction holds up for a genuinely different toolchain (e.g. a
  Python-only profile, or a profile with no browser tooling at all) is
  untested in production as far as this pass could determine.

---

## Sources

- `apps/web/app/api/mcp/[transport]/route.ts:1-169`
- `apps/web/lib/mcp-server/context.ts:1-146`
- `apps/web/lib/mcp-server/registry.ts:1-94`
- `apps/web/lib/mcp-server/tools/sessions-read.ts:1-625`
- `apps/web/lib/mcp-server/tools/sessions-write.ts:1-427`
- `apps/web/lib/auth/config.ts:140-188`
- `apps/web/lib/sessions/create-session.ts:1-216`
- `apps/web/lib/chat/start-run.ts:1-294`
- `apps/web/lib/chat/stop-run.ts:1-57`
- `apps/web/lib/db/sessions.ts:571-635`
- `apps/web/lib/db/schema.ts:1-113, 523-591, 1142-1657`
- `apps/web/lib/background-agents/config.ts:1-277`
- `apps/web/lib/background-agents/dispatcher.ts:57-98, 726-976`
- `apps/web/lib/background-agents/store.ts:693-797`
- `apps/web/lib/background-agents/executor.ts:1-120` (imports/context only)
- `apps/web/lib/background-agents/tool-preflight.ts:1-120`
- `packages/sandbox/managed-runtime-profiles.ts:1-223`
- `apps/web/lib/managed-runtime/profile-resolution.ts:1-117`
- `apps/web/lib/managed-runtime/profile-run-status.ts:1-112`
- `apps/web/lib/managed-runtime/code-editor-gate.ts:1-24`
- `apps/web/app/workflows/chat-sandbox-runtime-impl.ts:379-494`
- `packages/agent/open-agent.ts:49-394`
- `apps/web/lib/sandbox/lifecycle.ts:1-267`
- `apps/web/lib/sandbox/lifecycle-kick.ts:1-133`
- `apps/web/app/workflows/sandbox-lifecycle.ts:1-121`
- `packages/sandbox/interface.ts:1-185`
- `packages/sandbox/vercel/snapshot-refresh.ts:1-60` (imports/signatures only)
- `apps/web/lib/sandbox/utils.ts:85-125`
- `packages/agent/tools/task.ts:1-948`
- `packages/agent/subagents/registry.ts:1-36`
- `packages/agent/subagents/roster.ts:1-171`
- `packages/agent/subagents/explorer.ts:1-118`
- `packages/agent/subagents/constants.ts:1`
- `docs/plans/resident-agent/portable-lessons.md` (read for cross-reference /
  de-duplication only, not re-quoted here beyond the deconfliction note above;
  first read via `git show origin/main:...` since the file was not yet
  materialized in the working tree at the start of this research pass)
