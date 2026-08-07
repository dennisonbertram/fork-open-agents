# 07 — Data Model: Database Schema as Source of Truth for iOS Client Models

Research brief for the native iOS (Swift/SwiftUI) app plan. Ground truth read from
`/Users/dennison/develop/open-agents/apps/web/lib/db/schema.ts` (1,787 lines, 40 tables) plus the
`lib/db/*` helpers and the API routes that serialize these rows to clients. All line citations
are against the working tree as of 2026-06-09 (branch `feat/agents-phase6-authored-tools`).

## Global conventions (apply to every table)

- **All primary keys are `text` IDs** (nanoid-generated in route handlers, e.g. `apps/web/app/api/sessions/route.ts:1` imports `nanoid`). There are no integer/UUID PKs. Swift models should use `String` ids.
- **Timestamps** are Drizzle `timestamp` columns hydrated as JS `Date` and serialized by `Response.json` to **ISO-8601 strings**. iOS should decode with ISO8601 (fractional seconds).
- **Enums are Postgres `text` columns with TS enum constraints** — not DB-level enums. The API can in principle return values outside the list after migrations; Swift enums should decode leniently (unknown-case fallback).
- **JSONB columns** carry typed payloads via `.$type<...>()`; the canonical TS types are listed per table below.
- Most tables `references(() => users.id, { onDelete: "cascade" })` — everything is per-user; there is no multi-tenancy beyond `userId`.
- Drizzle row types are exported as `Session`, `Chat`, `ChatMessage`, etc. via `$inferSelect` at `schema.ts:1274-1336`, `1373-1377`, `1487-1494`, `1545-1546`, `1629-1630`, `1655-1656`, `1686-1687`, `1783-1786`. API routes mostly return these raw rows (camelCase keys, as defined in the Drizzle object — **not** the snake_case DB column names).

---

## 1. Auth / users subsystem (better-auth managed; mostly server-internal)

### `users` (schema.ts:70-81)
What it is to a user: **your account**.
- `id` text PK, `username` text NOT NULL, `email` text nullable, `emailVerified` bool default false, `name` text nullable, `avatarUrl` text nullable, `isAdmin` bool default false, `createdAt`/`updatedAt`/`lastLoginAt` timestamps.

### `accounts` (schema.ts:84-100) — server-internal
OAuth provider accounts (better-auth): `accountId`, `providerId` ("vercel"/"github"), `userId` FK→users, `accessToken`/`refreshToken`/`idToken`, token expiries, `scope`, `password`, timestamps. **Never sent to clients** — tokens live here.

### `auth_sessions` (schema.ts:103-114) — server-internal
better-auth cookie sessions: `expiresAt`, unique `token`, `ipAddress`, `userAgent`, `userId` FK. iOS will interact with this only via better-auth session cookies/tokens, never the row.

### `verification` (schema.ts:117-124) — server-internal
better-auth verification tokens: `identifier`, `value`, `expiresAt`.

**Client-facing auth type** is NOT a DB row: `Session` / `SessionUserInfo` in `apps/web/lib/session/types.ts:1-20`:
```ts
interface Session { created: number; authProvider: "vercel" | "github";
  user: { id; username; email?; avatar; name? } }
interface SessionUserInfo { user; authProvider?; isAdmin?; hasGitHub?;
  hasGitHubAccount?; hasGitHubInstallations? }
```

---

## 2. Sessions / chats / messages subsystem (the core user-facing model)

### `sessions` (schema.ts:257-343)
What it is to a user: **a workspace — one repo+branch+cloud sandbox where agents do work**.
- `id` PK, `userId` FK, `title` NOT NULL (auto-named after random cities, `route.ts` `getRandomCityName`).
- `status` enum: `running | completed | failed | archived` (default `running`).
- Repo: `repoOwner`, `repoName`, `branch`, `cloneUrl` (all nullable — empty-sandbox sessions exist).
- Vercel link: `vercelProjectId`, `vercelProjectName`, `vercelTeamId`, `vercelTeamSlug`.
- `isNewBranch` bool default false; `autoCommitPushOverride` / `autoCreatePrOverride` nullable bools (null = inherit user preference).
- `globalSkillRefs` jsonb `GlobalSkillRef[]` (`{source: "owner/repo", skillName}` — zod schema at `apps/web/lib/skills/global-skill-refs.ts:7-20`).
- `sandboxState` jsonb `SandboxState` = `{ type: "vercel" } & VercelState` (`packages/sandbox/factory.ts:13`); `VercelState` = `{ source?, sandboxName?, sandboxId?, snapshotId?, expiresAt? (ms epoch) }` (`packages/sandbox/vercel/state.ts:7-21`).
- `runtimeMode` enum `classic | managed_runtime` default `classic`; `managedRuntimeProfileId` text NOT NULL default `"web-bun-agent-browser"`; `inferenceProfileId` FK→inference_profiles (set-null).
- Lifecycle: `lifecycleState` enum `provisioning | active | hibernating | hibernated | restoring | archived | failed` (nullable), `lifecycleVersion` int default 0, `lastActivityAt`, `sandboxExpiresAt`, `hibernateAfter`, `lifecycleRunId`, `lifecycleError`.
- Git stats: `linesAdded`/`linesRemoved` int default 0; PR: `prNumber` int, `prStatus` enum `open | merged | closed`.
- Snapshot: `snapshotUrl`, `snapshotCreatedAt`, `snapshotSizeBytes`.
- Offline diff: `cachedDiff` jsonb (a `DiffResponse`, see §11), `cachedDiffUpdatedAt`.
- `createdAt`, `updatedAt`.

### `chats` (schema.ts:345-368)
What it is to a user: **a conversation thread inside a session** (sessions have many chats).
- `id` PK, `sessionId` FK cascade, `title`, `modelId` default `"anthropic/claude-haiku-4.5"`, `inferenceProfileId` FK set-null.
- `composioSelection` jsonb `ChatComposioSelection` = `{ mainProfileId: string|null, agentProfileOverrides?: Partial<Record<"main"|"explorer"|"executor"|"design", string|null>>, directToolkitSlugs?: string[] }` (`apps/web/lib/composio/types.ts:20-25`; one-wins rule: non-empty `directToolkitSlugs` beats profile).
- `activeStreamId` text nullable — **non-null means an assistant stream is in flight** (used for resumable streams and "isStreaming" flags).
- `lastAssistantMessageAt` timestamp — drives unread computation.
- `createdAt`, `updatedAt`.

### `chat_messages` (schema.ts:744-755)
What it is to a user: **one message bubble in a chat**.
- `id` PK (this is the AI-SDK message id), `chatId` FK cascade, `role` enum `user | assistant` (NO system/tool roles persisted), `parts` jsonb NOT NULL, `createdAt`.
- **CRITICAL naming trap:** despite the column name, `parts` stores the **entire `WebAgentUIMessage` object** `{id, role, parts: [...], metadata}` — not just the parts array. Persist site: `apps/web/app/api/chat/route.ts:449-453` (`parts: latestMessage`); read site casts `message.parts as WebAgentUIMessage` and returns it as `messages[]` (`apps/web/app/api/sessions/[sessionId]/chats/[chatId]/route.ts:63-72`). iOS message model = AI SDK UIMessage, not the DB row.

### `chat_reads` (schema.ts:757-774)
What it is to a user: **read receipts powering unread badges**.
- Composite PK (`userId`,`chatId`), `lastReadAt` timestamp default now, timestamps. Written via `POST .../chats/[chatId]/read`.

### `shares` (schema.ts:731-742)
What it is to a user: **a public share link for a chat**.
- `id` PK (the share slug), `chatId` FK unique, timestamps.

### `session_events` (schema.ts:635-729)
What it is to a user: **the observability timeline ("what the agent/sandbox did")** shown in the runtime observability panel.
- `id` PK, `sessionId` FK, `chatId` FK set-null, `userId` FK.
- `source` enum: `chat | workflow | managed_runtime | sandbox | harness | service | browser | github | system`.
- `actorType` enum: `user | coordinator | worker | sandbox | harness | browser | github | workflow | system`; `actorId` nullable.
- `eventName` text; `status` enum `started | running | succeeded | failed | blocked | skipped | info`; `summary` text.
- Correlation ids: `requestId`, `workflowRunId`, `harnessRunId`, `sandboxName`, `managedRuntimeProfileRunId` FK, `serviceId` FK, `browserRunId` FK.
- `payload` jsonb `Record<string, unknown>`; `redactionStatus` enum `not_required | passed | failed | blocked` default `passed`.

**Canonical message TS types** (`apps/web/app/types.ts`):
- `WebAgentUIMessage = UIMessage<WebAgentMessageMetadata, WebAgentDataParts, WebAgentUITools>` (types.ts:166-171).
- `WebAgentMessageMetadata` (types.ts:21-37): `selectedModelId?, modelId?, inferenceRoute? ("gateway"|"user"), inferenceProfileId?, inferenceProfileName?, inferenceProvider?, lastStepUsage?/totalMessageUsage? (LanguageModelUsage), lastStepCost?/totalMessageCost? (USD), lastStepFinishReason?, stepFinishReasons?`.
- `WebAgentDataParts` (types.ts:155-162) — the custom data parts an iOS renderer must handle: `data-commit` (`WebAgentCommitData`: status pending/success/error/skipped, committed?, pushed?, commitMessage?, commitSha?, url?, error?), `data-pr` (`WebAgentPrData`: status, created?, syncedExisting?, prNumber?, url?, error?, skipReason?, requiresManualCreation?), `data-snippet` (`{content, filename}`), `data-workspace-status` (`{status:"setting-up", message, title?, logLines?, logUpdatedAt?}`), `data-verified-build` (`{status, runId, harnessRunId, mode, reason, requestId}`), `data-runtime-proof` (large nested proof object, types.ts:84-153).
- Plus standard AI SDK parts: `text`, `reasoning`, `file`, tool parts (`tool-*` typed from agent tools + `dynamic-tool`), `step-start`.

**Canonical session list type**: `SessionWithUnread` (`apps/web/lib/db/sessions.ts:179-199`):
```ts
Pick<Session, "id"|"title"|"status"|"repoOwner"|"repoName"|"branch"|
  "linesAdded"|"linesRemoved"|"prNumber"|"prStatus"|"createdAt"> &
{ hasUnread: boolean; hasStreaming: boolean; latestChatId: string|null; lastActivityAt: Date }
```
Returned by `GET /api/sessions` as `{ sessions }` (all), `{ sessions, archivedCount }` (active), or `{ sessions, archivedCount, pagination:{limit,offset,hasMore,nextOffset} }` (archived) — `apps/web/app/api/sessions/route.ts:135-168`. Heavy jsonb columns (`sandboxState`, `cachedDiff`) are intentionally excluded from list queries.

**Canonical session detail**: `GET /api/sessions/[sessionId]` returns `{ session: <full sessions row> }` including `sandboxState` and `cachedDiff` (`apps/web/app/api/sessions/[sessionId]/route.ts:46`).

**Canonical chat list type**: `ChatSummary = chats.$inferSelect & { hasUnread: boolean; isStreaming: boolean }` (`apps/web/lib/db/sessions.ts:365-368`), returned by `GET /api/sessions/[id]/chats` as `{ chats, defaultModelId }`.

**Chat refresh**: `GET /api/sessions/[id]/chats/[chatId]` returns `{ chat: {id, modelId, inferenceProfileId, composioSelection, activeStreamId}, isStreaming, messages: WebAgentUIMessage[] }` (`route.ts:62-72`).

---

## 3. Sandbox services & browser runs

### `sandbox_services` (schema.ts:370-415)
What it is to a user: **a long-running process in the sandbox (dev server, code editor) with a URL you can open**.
- `id` PK, `sessionId` FK, `userId` FK.
- `kind` enum: `dev_server | code_editor | custom`; `status` enum: `stopped | starting | running | failed | stale`.
- `packageDir`, `command` NOT NULL, `port` int NOT NULL, `url`, `pid`, `commandId`, `logPath`, `healthPath`, `lastHealthStatus` int, `lastStartedAt`/`lastSeenAt`/`lastStoppedAt`, `relaunchOnResume` bool default true, `failureMessage`, timestamps.
- Unique (`sessionId`,`kind`,`port`).

### `sandbox_browser_runs` (schema.ts:417-455)
What it is to a user: **an automated browser QA run against your dev server, with pass/fail and artifacts**.
- `id` PK, `sessionId` FK, `chatId` FK set-null, `serviceId` FK set-null.
- `status` enum: `queued | running | passed | failed`; `targetUrl` NOT NULL; `summary`; `consoleErrors`/`networkErrors`/`steps`/`artifactRefs` jsonb arrays (untyped, default `[]`).
- `redactionStatus` enum `pending | passed | failed | blocked` default `pending`; `startedAt`, `finishedAt`, `createdAt`.

Both are rendered in the session observability panel and managed-runtime evidence UI (`GET /api/sessions/[id]/observability` returns `services` and `browserRuns` arrays — `observability/route.ts:152-168`; also `GET .../browser-runs`, `GET/POST .../sandbox-services`, `GET .../sandbox-services/[serviceId]/logs`).

---

## 4. Managed runtime subsystem

### `managed_runtime_profile_runs` (schema.ts:457-509)
What it is to a user: **proof that the sandbox toolchain was set up and verified for a run**.
- `id` PK, `sessionId` FK, `chatId` FK set-null, `userId` FK, `workflowRunId` text, `sandboxName`.
- `profileId`/`profileVersion`/`profileDisplayName` NOT NULL; `status` enum: `running | passed | failed | blocked`.
- `expectedTools`/`optionalTools` jsonb `string[]`; `setupResults`/`verificationResults` jsonb `ManagedRuntimeCommandObservation[]` (= `{commandId, label, status: running|passed|failed|skipped, required?, exitCode?, durationMs?, summary?, startedAt, finishedAt?}`, schema.ts:25-35).
- `summary`, `failureMessage`, `startedAt` NOT NULL, `finishedAt`, timestamps.

### `managed_runtime_saved_profiles` (schema.ts:511-564)
What it is to a user: **a saved custom runtime profile (your own toolchain recipe)**.
- `id` PK, `userId` FK, `sessionId` FK nullable cascade, `sourceDraftId`.
- `scope` enum: `session | repo | user_default` (default `session`); `version`, `displayName`, `description` NOT NULL.
- `setupCommands`/`verificationCommands` jsonb `ManagedRuntimeProfileCommand[]` (from `@open-agents/sandbox/managed-runtime-profiles`), `expectedTools`/`optionalTools` `string[]`, `defaultPorts` `number[]`.
- Test state: `latestTestRunId`, `testResults` `ManagedRuntimeCommandObservation[]`, `testFailureMessage`, `testedAt`, timestamps.

### `managed_runtime_profile_drafts` (schema.ts:566-633)
What it is to a user: **an agent-proposed runtime profile awaiting your approve/revise/discard decision** (rendered as an interactive chat card).
- `id` PK, `userId`/`sessionId` FK, `chatId` FK set-null, `toolCallId` NOT NULL (unique per session).
- `status` enum: `draft_ready | testing | tested | needs_changes | revision_requested | approved | applied | discarded` (default `draft_ready`).
- `targetScope` enum `session | repo | user_default`; `goal` NOT NULL; `repoSignals` `string[]`; `profileDraft` jsonb `ManagedRuntimeProfileDraftData` NOT NULL; `questionsForUser` `string[]`.
- Test state mirrors saved profiles; `userInstructions` text; `userDecision` enum `approved | revise | discarded` nullable; timestamps.

APIs: `GET/POST /api/sessions/[id]/managed-runtime/profile-drafts`, `PATCH .../[draftId]`, `GET/POST .../managed-runtime/profiles`, plus settings: `GET /api/settings/runtime-profiles`.

---

## 5. Verified build subsystem

### `verified_build_runs` (schema.ts:776-832)
What it is to a user: **a harness-driven "verified build" / investigation run with go/no-go verdict**, surfaced via the `data-verified-build` chat part.
- `id` PK, `sessionId`/`chatId`/`userId` FK (all cascade), `harnessRunId` unique NOT NULL.
- `mode` enum: `investigation | verified_build`; `status` text NOT NULL (**free-form, not enum-constrained** — comes from harness).
- `tenantId` NOT NULL, `projectId`, `actorId` NOT NULL, `idempotencyKey` NOT NULL (unique with tenant/project/actor).
- `intentSummary`, `selectionReason`, `lastEventId`/`lastEventName`/`lastEventAt`.
- `planApprovalState` enum: `not_required | pending | approved | rejected` (default `not_required`); `pendingApprovalKind`; `finalReportArtifactId`.
- `goNoGo` enum: `unknown | go | no_go` (default `unknown`); timestamps.

### `verified_build_events` (schema.ts:834-858) — mostly server-internal
- `id` PK, `verifiedBuildRunId` FK cascade, `harnessEventId` (unique per run), `eventName`, `eventPayload` jsonb, `eventAt`, `receivedAt`, `requestId`. Harness API routes under `app/api/harness/*` consume/produce these.

---

## 6. Background agents subsystem

### `background_agents` (schema.ts:860-905)
What it is to a user: **an automation you configure to run on a repo when triggers fire (e.g. review every PR)**.
- `id` PK, `userId` FK, `name` NOT NULL, `description`.
- `status` enum: `enabled | disabled` (default `disabled`).
- `repoOwner`/`repoName` NOT NULL, `instructions` NOT NULL.
- `permissions` jsonb `BackgroundAgentPermissions` (schema.ts:48-57): `{github?: {contents?: "read"|"write", pullRequests?: "read"|"write", issues?: "read"|"write", deployments?: "read", statuses?: "read", checks?: "read"}}`.
- `outputMode` enum: `comment | ready_pr | issue | notification | none` (default `none`); `checkCommand`; `composioToolkitSlugs` jsonb `string[]` default `[]`; timestamps.

### `background_agent_triggers` (schema.ts:907-955)
What it is to a user: **when the automation fires**.
- `id` PK, `agentId` FK cascade, `userId` FK, `name`.
- `kind` enum: `github.pull_request | github.deployment_status | github.issue | schedule.cron | webhook.error`.
- `status` enum `enabled | disabled` (default enabled); `conditions` jsonb `BackgroundAgentTriggerConditions` (schema.ts:40-46: `{actions?, branches?, labels?, environments?, severities?}` all `string[]`).
- `schedule` (cron string), `webhookPublicId` (unique), `webhookSecretHash`, `lastRunAt`, `nextRunAt`, `lastSkipReason`, timestamps.

### `background_agent_tool_grants` (schema.ts:957-989)
What it is to a user: **per-agent permission slips for external (Composio) tools by role/phase**.
- `id` PK, `agentId`/`userId` FK; `provider` enum `composio`; `profileId` nullable; `agentRole` enum `main | explorer | executor | design`; `phase` enum `investigate | mutate | notify | always`; `status` enum `enabled | disabled` (default disabled); timestamps.

### `background_agent_runs` (schema.ts:991-1076)
What it is to a user: **one execution of an automation, with links to what it produced**. Rendered on `/background-runs` page and settings.
- `id` PK, `agentId` FK set-null, `triggerId` FK set-null, `userId` FK.
- `status` enum: `queued | running | succeeded | failed | skipped | cancelled`.
- `source` enum: `github | schedule | webhook`; `triggerKind` same enum as triggers.
- `externalId` NOT NULL, `idempotencyKey` NOT NULL unique.
- `repoOwner`/`repoName` NOT NULL; `ref`, `sha`, `branch`, `prNumber` int, `issueNumber` int, `deploymentUrl`, `sandboxName`.
- `outputKind` enum (nullable): `comment | ready_pr | issue | notification | none`; `outputUrl`; `errorKind`; `errorMessage`.
- `payloadSummary` jsonb `BackgroundAgentPayloadSummary` (schema.ts:59-67: `{title?, url?, actor?, action?, environment?, severity?, message?}`).
- `resultSummary` jsonb `RunSummary` (`apps/web/lib/background-agents/run-summary.ts:18-25`): `{headline, checked[], changed[], blocked[], artifacts: [{kind,label,url?,prNumber?,issueNumber?}], next[]}`.
- `requestId`, `workflowRunId`, `startedAt`, `finishedAt`, timestamps.

### `background_agent_events` (schema.ts:1078-1131)
Run timeline events: `runId` FK cascade, `agentId` set-null, `userId`, `eventName`, `status` enum (`started|running|succeeded|failed|blocked|skipped|info`), `level` enum `info|warn|error`, `summary`, `requestId`, `workflowRunId`, `sandboxName`, `errorKind`, `payload` jsonb, `redactionStatus` enum (`not_required|passed|failed|blocked`), `createdAt`.

### `background_agent_outputs` (schema.ts:1133-1161)
What the run produced: `runId` FK, `userId`, `kind` enum (`comment|ready_pr|issue|notification|none`), `status` enum `pending|created|failed|skipped`, `url`, `prNumber`, `payload` jsonb, `createdAt`.

### `background_agent_tool_sessions` (schema.ts:1163-1198) — server-internal
Composio session reuse per run: `runId`/`agentId`/`userId`, `provider` (`composio`), `profileId`, `agentRole`, `phase`, `providerSessionId`, `configHash`, `status` enum `planned|ready|failed|skipped`, `createdAt`, `lastUsedAt`.

APIs: `GET/POST /api/background-agents` returns `{agents}` / `{agent}` (full Drizzle rows via `lib/background-agents/store.ts`); `[agentId]` GET/PATCH/DELETE, `/status`, `/test`; runs via `/api/background-agent-runs`. Zod input schemas: `createBackgroundAgentSchema` / `updateBackgroundAgentSchema` in `apps/web/lib/background-agents/types.ts:91-131`.

---

## 7. Workflows / goal ledger subsystem

### `workflow_runs` (schema.ts:1200-1248)
What it is to a user: **one agent generation loop ("turn") with timing/attribution** — shown in the observability panel.
- `id` PK, `chatId`/`sessionId`/`userId` FK cascade, `modelId`, `inferenceRoute` enum `gateway | user`, `inferenceProfileId` FK set-null, `requestId`, `runtimeMode` enum `classic | managed_runtime` (nullable), `sandboxName`, `managedRuntimeProfileId`/`Version`, `managedRuntimeProfileRunId` FK set-null, `errorMessage`.
- `status` enum: `completed | aborted | failed`; `startedAt`/`finishedAt` NOT NULL; `totalDurationMs` int NOT NULL; `createdAt`.
- **Written at run FINISH** (important: rows don't exist while streaming).

### `workflow_run_steps` (schema.ts:1250-1272)
Per-step timing: `workflowRunId` FK cascade, `stepNumber` (unique per run), `startedAt`/`finishedAt`/`durationMs` NOT NULL, `finishReason`, `rawFinishReason`, `createdAt`.

### `workflow_input_snapshots` (schema.ts:1350-1371) — server-internal audit
`workflowRunId` plain text (FK intentionally dropped — parent row written at finish; see comment schema.ts:1342-1349), `workflowId`, `schemaVersion`, `inputValues` jsonb (sensitive fields `"[REDACTED]"`), `persistedAt`.

### `workflow_goals` (schema.ts:1701-1750)
What it is to a user: **the agent's stated objective + plan for a run** — rendered in the observability panel.
- `id` PK, `userId` FK, `workflowRunId` plain text (no FK, same reason), `sessionId`/`chatId` FK set-null, `objective` NOT NULL.
- `status` enum: `draft | planned | running | awaiting_input | blocked | validating | complete | failed | canceled | archived` (default `draft`; terminal: complete/failed/canceled/archived).
- `plan` jsonb `{steps: string[]}`; `blockedReason`; `evidenceRefs` `string[]`; timestamps.

### `workflow_goal_events` (schema.ts:1752-1781)
Goal timeline: `goalId` FK cascade, `userId`, `sequence` int (unique per goal), `eventType`, `summary`, `payload` jsonb, `createdAt`.

**Observability aggregate response** (`GET /api/sessions/[id]/observability`, route.ts:152-168): `{ runtimeMode, events[], profileRuns[], workflowRuns[] (dates ISO-stringified), workers, directToolUse, services[], browserRuns[], workflowGoals: [{id, objective, status, blockedReason, evidenceRefs, createdAt, updatedAt, events:[{id,eventType,summary,sequence,payload?,createdAt}]}] }`.

---

## 8. Composio subsystem

### `composio_tool_profiles` (schema.ts:1379-1412)
What it is to a user: **a named bundle of external tool integrations (toolkits + connected accounts)**.
- `id` PK, `userId` FK, `name` (unique per user), `toolkitSlugs` jsonb `string[]` NOT NULL, `authConfigIdsByToolkit` `Record<string, string|null>`, `connectedAccountIdsByToolkit` `Record<string, string[]>`, `workbenchEnabled` bool default false, `allowInChatConnectionManagement` bool default false, timestamps.
- Client-facing summary type: `ComposioToolProfileSummary` (`lib/composio/types.ts:43-48`).

### `composio_agent_sessions` (schema.ts:1414-1448) — server-internal
Cached Composio sessions per (user, chat, agentKey, profile, configHash): `agentKey` enum `main|explorer|executor|design`, `profileId` FK cascade, `configHash`, `composioSessionId`, `createdAt`, `lastUsedAt`.

### `repository_composio_settings` (schema.ts:1450-1485)
What it is to a user: **per-repo policy restricting which tool profiles/toolkits agents may use**.
- `id` PK, `userId`, `repoOwner`/`repoName` (unique per user+repo), `inheritGlobalDefaults` bool default true, `allowedProfileIds` `string[]`, `blockedToolkitSlugs` `string[]`, `agentDefaults` jsonb `Partial<ComposioAgentDefaults>` (= per-role `{defaultProfileId, allowChatOverride}`), timestamps.

APIs: `/api/settings/composio`, `/api/settings/repositories/[owner]/[name]/composio`, `/api/composio/*`.

---

## 9. GitHub installations / Vercel links / inference profiles / skills

### `github_installations` (schema.ts:126-155)
What it is to a user: **a GitHub App installation granting repo access** (repo picker is driven by these).
- `id` PK, `userId` FK, `installationId` int NOT NULL, `accountLogin` NOT NULL, `accountType` enum `User | Organization`, `repositorySelection` enum `all | selected`, `installationUrl`, timestamps. Unique (userId,installationId) and (userId,accountLogin).
- **Repos themselves are NOT stored in the DB.** They are fetched live from GitHub: `GET /api/github/installations/repos?installation_id=N&query=&limit=` returns a bare array of `InstallationRepository` = `{name, full_name, description, private, clone_url, updated_at, language}` (snake_case! `apps/web/lib/github/repos.ts:24-32`, route returns `NextResponse.json(repos)` at `installations/repos/route.ts:74`).

### `vercel_project_links` (schema.ts:157-177)
What it is to a user: **the Vercel project associated with a repo (for deploy previews)**.
- Composite PK (`userId`,`repoOwner`,`repoName`); `projectId`/`projectName` NOT NULL; `teamId`/`teamSlug` nullable; timestamps.

### `inference_profiles` (schema.ts:179-212)
What it is to a user: **your own Anthropic API key (BYOK) used instead of the gateway**.
- `id` PK, `userId` FK, `name` (unique per user), `provider` enum `anthropic` (only value today), `baseUrl` nullable, `encryptedApiKey` NOT NULL (**never returned to clients**), `keyLast4`, `keyFingerprint`, `status` enum `untested | verified | failed` (default untested), `lastTestedAt`, `lastTestMessage`, `enabled` bool default true, timestamps.
- API returns `SafeInferenceProfile` (`apps/web/lib/inference/types.ts:76-89`): `{id, name, provider, baseUrl, keyLast4, keyFingerprint, status, lastTestedAt, lastTestMessage, enabled, createdAt, updatedAt}` via `GET /api/inference-profiles` → `{profiles}` (sanitizer at `lib/db/inference-profiles.ts:26-43`).

### `user_skills` (schema.ts:219-255)
What it is to a user: **a reusable SKILL.md instruction you author; enabled skills are injected into the sandbox**.
- `id` PK, `userId` FK, `name` (slug, unique per user), `description`, `body` (markdown), `enabled` bool default true, `disableModelInvocation` bool default false, `userInvocable` bool default true, `allowedTools` jsonb `string[]`, `source` enum `manual | generated` (default manual), timestamps.
- APIs: `/api/settings/skills`, `/api/settings/skills/generate`, `/api/sessions/[id]/skills`.

---

## 10. Preferences, agents, tool entries, usage

### `user_preferences` (schema.ts:1497-1543)
What it is to a user: **all your settings toggles**. One row per user (unique `userId`).
- `defaultModelId` default `"anthropic/claude-haiku-4.5"`, `defaultSubagentModelId` nullable, `defaultSandboxType` enum `vercel`, `defaultManagedRuntimeProfileId` NOT NULL default `"web-bun-agent-browser"`, `defaultInferenceProfileId` FK set-null, `defaultDiffMode` enum `unified | split`, `autoCommitPush` bool default false, `autoCreatePr` bool default false, `alertsEnabled` bool default true, `alertSoundEnabled` bool default true, `publicUsageEnabled` bool default false, `globalSkillRefs` jsonb `GlobalSkillRef[]`, `modelVariants` jsonb `ModelVariant[]` (= `{id: "variant:..." , name, baseModelId, providerOptions: JsonValue map}`, `lib/model-variants.ts:40-49`), `enabledModelIds` `string[]`, `composioAgentDefaults` jsonb `ComposioAgentDefaults`, timestamps.
- **Canonical client type is `UserPreferencesData`** (`apps/web/lib/db/user-preferences.ts:24-40`) — the normalized 15-field shape returned by `GET /api/settings/preferences` (no id/userId/timestamps). Defaults are synthesized when no row exists.

### `agents` (schema.ts:1552-1627)
What it is to a user: **per-role agent configuration (model, instructions, tools) for main/explorer/executor/design**.
- `id` PK, `userId` FK, `name`, `description` default "", `role` enum `main | explorer | executor | design` (default main), `scope` enum `user_default | repo | session` (default user_default), `sessionId` FK cascade nullable, `repoOwner`/`repoName` nullable.
- Cognition: `modelId` nullable (null = inherit from preferences), `inferenceProfileId` FK set-null, `instructions` nullable (null = built-in prompt), `skillRefs` jsonb `GlobalSkillRef[]`.
- Tools: `builtinToolNames` jsonb `string[] | null` (null = role default policy), `composioToolkitSlugs` `string[]`, `composioProfileId` nullable.
- Runtime: `managedRuntimeProfileId` nullable (null = inherit).
- `toolAuthoringEnabled` bool default false (gates #242 agent-authored tools).
- Unique (userId, role, scope). With zero rows, resolution falls back to today's behavior.
- Settings API returns a projected view, not raw rows: `AgentSettingsResponse = { agents: [{role, modelId, composioToolkitSlugs, composioProfileId, instructions, managedRuntimeProfileId}] }` — always 4 entries, null-filled for missing roles (`apps/web/app/api/settings/agents/route.ts:25-70`).

### `agent_tool_entries` (schema.ts:1635-1653)
What it is to a user: **an approval queue for tools an agent proposed adding to itself**.
- `id` PK, `agentId` FK cascade, `userId` FK, `provider` enum `composio`, `toolkitSlug` NOT NULL, `status` enum `proposed | approved | rejected` (default proposed), provenance `createdByChatId`/`createdByRunId`, `createdAt`, `approvedAt`. API: `/api/agents/tool-entries`.

### `usage_events` (schema.ts:1659-1684)
What it is to a user: **token/cost accounting — one row per assistant turn** (append-only; never rendered raw).
- `id` PK, `userId` FK, `source` enum `web` (default), `agentType` enum `main | subagent`, `provider`, `modelId`, `inferenceRoute` enum `gateway | user`, `inferenceProfileId` FK set-null, `inputTokens`/`cachedInputTokens`/`outputTokens`/`toolCallCount` ints default 0, `createdAt`.
- Clients consume **aggregates only**: `GET /api/usage?from&to` → `{usage: DailyUsage[], insights: UsageInsights, domainLeaderboard: UsageDomainLeaderboard|null}`.
  - `DailyUsage` (`lib/db/usage.ts:56-68`): `{date, source, agentType, provider, modelId, inputTokens, cachedInputTokens, outputTokens, messageCount, toolCallCount}` per (date,source,agentType,provider,modelId) group.
  - `UsageInsights` (`lib/usage/types.ts:49-55`): `{lookbackDays, pr: {trackedPrCount, sessionsWithPrCount, openPrCount, mergedPrCount, closedPrCount, mergeRate}, efficiency: {mainAssistantTurnCount, averageTokensPerMainTurn, largestMainTurnTokens, toolCallsPerMainTurn, cacheReadRatio}, code: {linesAdded, linesRemoved, totalLinesChanged}, topRepositories: [{repoOwner, repoName, sessionCount, trackedPrCount, linesAdded, linesRemoved, totalLinesChanged}]}`.
  - Leaderboard rows: `{userId, username, name, avatarUrl, totalTokens, mostUsedModelId, mostUsedModelTokens}` (`lib/usage/types.ts:34-47`). Public profile types in `lib/db/public-usage-profile.ts` (`PublicUsageProfile`, gated by `publicUsageEnabled`).

---

## 11. Non-DB canonical types the iOS model layer also needs

- **Diff**: `DiffFile` / `DiffResponse` (`apps/web/lib/diff/compute-diff.ts:14-38`). `DiffFile = {path, status: added|modified|deleted|renamed, stagingStatus?: staged|unstaged|partial, additions, deletions, diff (unified text), localDiff?, oldPath?, generated?}`; `DiffResponse = {files, summary:{totalFiles,totalAdditions,totalDeletions}, baseRef?}`. Served by `GET /api/sessions/[id]/diff` and cached into `sessions.cachedDiff` (same shape; optional fields may be absent in old caches).
- **Repos**: `InstallationRepository` (snake_case, §9) — live from GitHub, not DB.
- **Last repo**: derived from sessions, `{owner, repo}` (`lib/db/last-repo.ts:9-29`).
- **Auth/user info**: `SessionUserInfo` (§1).
- **Session create request** (`POST /api/sessions` body, `apps/web/app/api/sessions/route.ts:34-46`): `{title?, repoOwner?, repoName?, branch?, cloneUrl?, isNewBranch?, sandboxType?: "vercel", managedRuntimeProfileId?, autoCommitPush?, autoCreatePr?, vercelProject?: VercelProjectSelection|null}`. Session update (`PATCH /api/sessions/[id]`, route.ts:14-24): `{title?, status?, runtimeMode?, managedRuntimeProfileId?, inferenceProfileId?, linesAdded?, linesRemoved?, prNumber?, prStatus?}`.

---

## 12. Rendered-by-client vs server-internal (summary table)

| Table | Web client renders? | Via |
|---|---|---|
| users | yes (profile/avatar) | auth info endpoints, leaderboard |
| accounts, auth_sessions, verification | NO (server-internal) | — |
| github_installations | yes (settings, repo picker) | /api/github/installations |
| vercel_project_links | yes (session create, repo dashboard) | /api/vercel/*, sessions |
| inference_profiles | yes (settings; sanitized) | /api/inference-profiles |
| user_skills | yes (settings/skills) | /api/settings/skills |
| sessions | yes (core) | /api/sessions[, /:id] |
| chats | yes (core) | /api/sessions/:id/chats |
| chat_messages | yes (core; full UIMessage in `parts`) | chats/:chatId GET + AI SDK stream |
| chat_reads | indirectly (unread flags only) | computed into hasUnread |
| shares | yes (share links) | /api/sessions/:id/chats/:id/share |
| session_events | yes (observability panel) | /api/sessions/:id/observability |
| sandbox_services | yes (dev server/editor panel) | sandbox-services routes, observability |
| sandbox_browser_runs | yes (browser evidence) | browser-runs route, observability |
| managed_runtime_profile_runs | yes (runtime proof) | observability, data-runtime-proof part |
| managed_runtime_saved_profiles | yes (settings/runtime-profiles) | settings routes |
| managed_runtime_profile_drafts | yes (chat approval card) | profile-drafts routes |
| verified_build_runs | yes (chat data part + status) | harness routes, data-verified-build |
| verified_build_events | mostly internal | harness debug |
| background_agents/_triggers/_runs/_events/_outputs | yes (settings + /background-runs) | /api/background-agents*, /api/background-agent-runs |
| background_agent_tool_grants | yes (settings toggles) | background-agents settings |
| background_agent_tool_sessions | NO (internal cache) | — |
| workflow_runs/_steps | yes (observability) | observability route |
| workflow_input_snapshots | NO (audit) | — |
| workflow_goals/_events | yes (observability goals) | observability route |
| composio_tool_profiles | yes (settings/composio) | /api/settings/composio |
| composio_agent_sessions | NO (internal cache) | — |
| repository_composio_settings | yes (repo settings) | settings/repositories route |
| user_preferences | yes (settings/preferences) | /api/settings/preferences |
| agents | yes (settings/agents, projected) | /api/settings/agents |
| agent_tool_entries | yes (approval UI) | /api/agents/tool-entries |
| usage_events | aggregates only | /api/usage, /api/usage/rank |

## Uncertainties

- `WebAgentUITools` (tool part names/IO shapes) derive from `webAgent` in `apps/web/app/config.ts` → `packages/agent` tool definitions; enumerate them in the agent/tools research brief — this brief covers persistence, not tool schemas.
- `ManagedRuntimeProfileCommand` and `ManagedRuntimeProfileDraftData` live in `packages/sandbox/managed-runtime-profiles.ts` and `@open-agents/agent` respectively; shapes not expanded here.
- `verified_build_runs.status` is free-form text from the harness — do not model as a closed Swift enum.
- Drizzle `timestamp` columns use default (non-timezone) mode; production Neon stores UTC. iOS should treat all timestamps as UTC.
