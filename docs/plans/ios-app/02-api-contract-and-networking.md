# 02 — API Contract and Networking

Part of the iOS app build plan. Siblings: `00-overview.md`, `01-product-and-ux.md`,
`03-architecture.md`, `04-auth.md`, `05-streaming-chat-engine.md`, `06-testing-strategy.md`,
`07-observability.md`, `08-ci-cd-release.md`, `09-step-by-step-build-guide.md`.

Ground truth comes from the research briefs in `docs/plans/ios-app/research/`
(01, 02, 03, 04, 05, 08, 11) and from the repo files cited inline. This document defines:

1. The complete endpoint inventory the iOS app consumes (§1).
2. The server-side OpenAPI contract-expansion workstream (§2).
3. The `swift-openapi-generator` setup in `ios/Packages/OpenAgentsAPI` (§3).
4. The networking layer: middleware, errors, retries, timeouts, environments (§4).
5. Pagination, caching, and conditional-request strategy (§5).

Canonical stack (restated, not re-decided): Swift 6.2 strict concurrency, SwiftUI +
`@Observable` MVVM, iOS 26.0 minimum, GRDB persistence, XcodeGen,
`swift-openapi-generator` **1.12.2** with the URLSession transport and `ClientMiddleware`
auth injection, Swift Testing, GitHub Actions `macos-26` runners.

---

## 0. Conventions used in this document

### 0.1 Endpoint classes

Every endpoint is assigned a class. Classes drive the timeout/retry policy in §4.4–§4.5
and the caching policy in §5.

| Class | Meaning | Latency expectation |
|---|---|---|
| `F` | Fast JSON, DB-only on the server | < 1 s |
| `V` | VM-touching JSON (connects to the Vercel Sandbox) | 1–15 s; may 409 "Sandbox is unavailable" |
| `L` | Long-running one-shot JSON (VM boot, git push, LLM call) | 10 s – minutes; the HTTP request stays open |
| `S` | SSE stream (`text/event-stream`) | open-ended |
| `P` | Public, no auth | < 1 s |
| `R` | Raw non-JSON body (`text/plain`, `text/x-diff`, `text/markdown`) | varies |

### 0.2 Auth values

- **session** — better-auth session. On iOS this is the `Authorization: Bearer <token>`
  header produced by the better-auth `bearer()` plugin (see `04-auth.md`). The server
  also accepts the browser cookie; the iOS app uses bearer exclusively.
- **none** — public endpoint.

### 0.3 Error envelope

Unless noted, every non-2xx response body is `{ "error": string }`. Exceptions:

- `GET /api/chat/{chatId}/stream` returns auth errors as **plain text**, not JSON
  (`apps/web/app/api/chat/[chatId]/stream/route.ts`).
- `POST /api/chat` adds `errorKind` / `fieldErrors` / `requestId` on some 4xx/5xx
  (research brief 01 §2.1).
- `/api/repos/{owner}/{repo}/dashboard` adds `errorKind` on 500.
- Harness routes (not consumed in v1) use `{ error: { code, message, request_id } }`.

### 0.4 Generated-client vs hand-rolled

Most endpoints are called through the generated `OpenAgentsAPI` Swift client (§3). The
following are **hand-rolled** on raw `URLSession` because their payloads are streams,
raw text, or dynamically-shaped JSON the OpenAPI type system cannot express:

| Endpoint | Why hand-rolled |
|---|---|
| `POST /api/chat` | SSE response (UI Message Stream); see `05-streaming-chat-engine.md` |
| `GET /api/chat/{chatId}/stream` | SSE resume + 204 semantics |
| `GET /api/sessions/{sessionId}/chats/{chatId}` | `messages` array is the dynamic `UIMessage` part system; decoded by the hand-written ChatKit models (`05-streaming-chat-engine.md`), not by generated types |
| `POST /api/chat/{chatId}/stop`, `POST .../messages` | request bodies embed a full `UIMessage` snapshot |
| `GET /api/sessions/{sessionId}/diff/patch` | raw `text/x-diff` download |
| `GET /api/sessions/{sessionId}/dev-server` (logs) | raw `text/plain` + custom headers |
| `GET /api/shared/{shareId}/markdown` | raw `text/markdown` |

Hand-rolled calls still go through the same middleware-equivalent layer (auth header,
request ID, logging) via a shared `RawHTTPClient` in `OpenAgentsKit`
(`03-architecture.md`).

---

## 1. Endpoint inventory

Every endpoint the iOS app consumes, grouped by feature. Screen names reference
`01-product-and-ux.md`. "Sandbox-unavailable 409" means the route may return
`409 {"error":"Sandbox is unavailable. Please resume sandbox."}` and the client must
offer Resume (`PUT /api/sandbox/snapshot`).

### 1.1 Auth and identity

Full flow specification lives in `04-auth.md`; listed here for inventory completeness.

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| POST | `/api/auth/sign-in/social` | F | none | better-auth social sign-in body (`provider: "vercel"` or `"apple"`, `callbackURL`) | `{ url, redirect }` (authorize URL for `ASWebAuthenticationSession`) | 400 | Sign-in |
| GET | `/api/auth/get-session` | F | session | — | better-auth session object (used to validate the bearer token) | 401 | App launch |
| GET | `/api/auth/info` | F | session | — | `SessionUserInfo` (`user`, `isAdmin`, `hasGitHub`, `hasGitHubAccount`, `hasGitHubInstallations`) | 401 | App launch, Settings > Profile |
| POST | `/api/auth/sign-out` | F | session | — | `{ success }` | 401 | Settings |
| POST | `/api/auth/link-social` | F | session | `{ provider: "github", callbackURL }` | `{ url }` (GitHub authorize URL) | 401 | Onboarding / Settings > Connections |
| POST | `/api/auth/delete-user` | F | session | better-auth account-deletion body | `{ success }` | 401 | Settings > Account (guideline 5.1.1(v)) |

### 1.2 Chat and streaming

Wire protocol details (chunk vocabulary, replay semantics, `[DONE]` terminator) are in
`05-streaming-chat-engine.md`; this table is the HTTP contract.

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| POST | `/api/chat` | S | session | `{ id, messages: UIMessage[] (full history), trigger, sessionId, chatId }` (no Zod server-side; be strict) | SSE `text/event-stream`, headers `x-vercel-ai-ui-message-stream: v1`, `x-workflow-run-id`, `x-request-id` | 400 invalid/ids/archived, 401, 403 bot/owner, 404, 409 duplicate workflow, 422 workflow input, 502 verified-build | Chat |
| GET | `/api/chat/{chatId}/stream` | S | session | — | SSE full replay from chunk 0 then live; **204 = nothing to resume** | 401/403/404 (plain text) | Chat (resume on foreground) |
| POST | `/api/chat/{chatId}/stop` | F | session | `{ assistantMessage?: UIMessage }` (in-progress snapshot, persisted before cancel) | `{ success: true }` | 401, 403, 404, 500 | Chat (stop button) |
| POST | `/api/generate-title` | L | session | `{ message: string }` | `{ title }` (≤ 60 chars) | 400, 401, 403 bot, 429 (10/min), 500 | Chat (first message in new session) |
| POST | `/api/transcribe` | L | session | `{ audio: base64, mimeType? }` | `{ text }` | 400, 401, 403, 413 (> 10 MiB), 429 (5/min), 500 | Chat composer (voice) |

### 1.3 Sessions

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| GET | `/api/sessions?status=all\|active\|archived&limit=&offset=` | F | session | query only; `limit` 1–100 default 50, `offset` default 0 (archived only) | `{ sessions: SessionSummary[] }`; active adds `archivedCount`; archived adds `pagination: { limit, offset, hasMore, nextOffset }` | 400 invalid filter, 401 | Sessions List, Archive |
| POST | `/api/sessions` | F | session | `CreateSessionRequest`: `{ title?, repoOwner?, repoName?, branch?, cloneUrl?, isNewBranch?, sandboxType?: "vercel", managedRuntimeProfileId?, autoCommitPush?, autoCreatePr?, vercelProject? }` | `{ session: Session, chat: Chat }` | 400 (many validation messages), 401, 403 bot / Vercel token, 429 (10/min), 500 | New Session |
| GET | `/api/sessions/{sessionId}` | F | session | — | `{ session: Session }` (full row) | 401, 403, 404 | Session detail hydrate |
| PATCH | `/api/sessions/{sessionId}` | F | session | `{ title?, status?, runtimeMode?, managedRuntimeProfileId?, inferenceProfileId? }` | `{ session }` | 400, 401, 403, 404, 409 archive race | Rename, Archive/Unarchive |
| DELETE | `/api/sessions/{sessionId}` | F | session | — | `{ success: true }` | 401, 403, 404 | Session context menu |

`SessionSummary` = `{ id, title, status, repoOwner, repoName, branch, linesAdded,
linesRemoved, prNumber, prStatus, createdAt, lastActivityAt, hasUnread, hasStreaming,
latestChatId }` (`apps/web/lib/db/sessions.ts`).

### 1.4 Chats within a session

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| GET | `/api/sessions/{sessionId}/chats` | F | session | — | `{ chats: ChatSummary[], defaultModelId }` (`ChatSummary` = chat row + `hasUnread` + `isStreaming`) | 401, 403, 404 | Chat tabs / sidebar |
| POST | `/api/sessions/{sessionId}/chats` | F | session | `{ id?: string }` (client-supplied UUID, idempotent) | `{ chat }` | 400, 401, 403, 404, 409 `Chat ID conflict` | New chat tab |
| GET | `/api/sessions/{sessionId}/chats/{chatId}` | F | session | — | `ChatRefreshResponse`: `{ chat: { id, modelId, inferenceProfileId, composioSelection, activeStreamId }, isStreaming, messages: UIMessage[] }` (hand-rolled decode, §0.4) | 401, 403, 404 | Chat (snapshot on open / foreground) |
| PATCH | `/api/sessions/{sessionId}/chats/{chatId}` | F | session | `{ title?, modelId?, inferenceProfileId?, composioSelection? }` (≥ 1 field) | `{ chat }` | 400 (several), 401, 403, 404 | Model picker, Composio picker |
| DELETE | `/api/sessions/{sessionId}/chats/{chatId}` | F | session | — | `{ success: true }` | 400 last-chat, 401, 403, 404 | Chat tab context menu |
| POST | `/api/sessions/{sessionId}/chats/{chatId}/messages` | F | session | `{ message: UIMessage }` (`role: "assistant"`) | `{ success: true, status: "inserted"\|"updated" }` | 400, 401, 403, 404, 409 scope | Chat (synthetic commit/PR messages, tool-result persistence) |
| DELETE | `/api/sessions/{sessionId}/chats/{chatId}/messages/{messageId}` | F | session | — | `{ success: true, deletedMessageIds: string[] }` | 400 not-user-message, 401, 403, 404, 409 streaming | Chat (edit / resend-from-here) |
| POST | `/api/sessions/{sessionId}/chats/{chatId}/fork` | F | session | `{ messageId, id? }` (assistant message) | `{ chat }` | 400, 401, 403, 404, 409 | Chat (fork action) |
| POST | `/api/sessions/{sessionId}/chats/{chatId}/read` | F | session | — | `{ success: true }` | 401, 403, 404 | Chat (read receipt on open/focus) |
| GET | `/api/sessions/{sessionId}/chats/{chatId}/share` | F | session | — | `{ shareId: string\|null }` | 401, 403, 404 | Share sheet |
| POST | `/api/sessions/{sessionId}/chats/{chatId}/share` | F | session | — | `{ shareId }` (idempotent) | 401, 403, 404, 500 | Share sheet |
| DELETE | `/api/sessions/{sessionId}/chats/{chatId}/share` | F | session | — | `{ success: true }` | 401, 403, 404 | Share sheet (revoke) |

### 1.5 Public share consumption

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| GET | `/api/shared/{shareId}/status` | P | none | — | `{ isStreaming: boolean }` | 404 | Shared-chat viewer (deep link) |
| GET | `/api/shared/{shareId}/markdown` | P, R | none | `Accept: text/markdown` optional | full chat as markdown/plain text | 404 (plain text) | Shared-chat viewer, share-as-text |

### 1.6 Sandbox lifecycle

`sessionId` travels in body/query, not the path, for `/api/sandbox/*`.

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| POST | `/api/sandbox` | L | session | `{ sessionId, repoUrl?, branch?, isNewBranch?, sandboxType? }` | `{ createdAt, timeout (ms), currentBranch?, mode: "vercel", timing: { readyMs } }` | 400, 401, 403 bot/repo-access, 404, 429 (20/min), 500 | Chat (create sandbox banner) |
| DELETE | `/api/sandbox` | V | session | `{ sessionId }` | `{ success: true, alreadyStopped? }` | 401, 403, 404, 429 (10/min) | Sandbox controls (stop) |
| GET | `/api/sandbox/status?sessionId=` | F | session | — | `SandboxStatusResponse`: `{ status: "active"\|"no_sandbox", hasSnapshot, lifecycleVersion, lifecycle: { serverTime, state, lastActivityAt, hibernateAfter, sandboxExpiresAt } }` | 400, 401, 403, 404 | Chat (poll, ≥ 5 s throttle) |
| GET | `/api/sandbox/reconnect?sessionId=` | V | session | — | `ReconnectResponse`: `{ status: "connected"\|"expired"\|"not_found"\|"no_sandbox", hasSnapshot, expiresAt?, lifecycle }` | 400, 401, 403, 404 | Chat (once on session entry) |
| POST | `/api/sandbox/extend` | V | session | `{ sessionId }` | `{ success: true, expiresAt, extendedBy: 1200000 }` | 400 not active, 401, 403, 404, 429 (3/min), 500 | Sandbox countdown UI |
| POST | `/api/sandbox/snapshot` | V | session | `{ sessionId }` | `{ snapshotId, createdAt }` (pause) | 400, 401, 403, 404, 500 | Sandbox controls (pause) |
| PUT | `/api/sandbox/snapshot` | L | session | `{ sessionId }` | `{ success: true, restoredFrom, sandboxId?, alreadyRunning? }` (resume) | 401, 403, 404 `No sandbox available for resume` / gone, 500 | Resume banner |
| POST | `/api/sandbox/activity` | F | session | `{ sessionId }` | `{ success: true }` or `{ success: false, reason: "not-active" }` | 401, 403, 404 | Chat composer focus (throttle 5 min) |
| POST | `/api/sessions/{sessionId}/sandbox` | F | session | — | `{ session }` (attach sandbox state to a no-repo session; client must still POST `/api/sandbox`) | 401, 403, 404 | "Add sandbox" action in plain chat |

### 1.7 Files and diff

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| GET | `/api/sessions/{sessionId}/files` | V | session | — | `{ files: [{ value, display, isDirectory }] }` (≤ 5000) | 400, 401, 403, 404, 409 sandbox-unavailable, 500 | Chat composer @-mentions, Files browser |
| GET | `/api/sessions/{sessionId}/files/content?path=` | V | session | query `path` (relative, validated) | `{ path, content, size }` (`Cache-Control: no-store`) | 400 invalid/binary/dir, 401, 403, 404, 409, 413 (> 200 000 bytes) | File viewer |
| GET | `/api/sessions/{sessionId}/diff` | V | session | — | `DiffResponse`: `{ files: DiffFile[], summary: { totalFiles, totalAdditions, totalDeletions }, baseRef? }` | 401, 403, 404, 409, 500 | Diff tab (live) |
| GET | `/api/sessions/{sessionId}/diff/cached` | F | session | — | `{ data: DiffResponse, cachedAt, isStale: true }` | 401, 403, 404 `No cached diff available` | Diff tab (hibernated/offline) |
| GET | `/api/sessions/{sessionId}/diff/patch` | V, R | session | — | raw `text/x-diff` attachment | 401, 403, 404, 409, 500 | Diff tab (export) |

`DiffFile` = `{ path, status: "added"|"modified"|"deleted"|"renamed", stagingStatus?,
additions, deletions, diff, localDiff?, oldPath?, generated? }`
(`apps/web/lib/diff/compute-diff.ts`).

### 1.8 Git and PR

All under `/api/sessions/{sessionId}/git/*` unless noted. These HTTP routes mirror the
web's server actions and are the designed surface for non-browser clients
(`apps/web/lib/git/http-schemas.ts`).

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| GET | `git/status` | V | session | — | `{ status: SessionGitStatus \| null }` | 401, 403, 404, 409 | Git panel |
| POST | `git/branch` | V | session | `{ sessionTitle, baseBranch, branchName }` | `{ branchName }` | 400, 401, 403, 404, 409 | Git panel (new branch) |
| POST | `git/commit` | L | session | `{ sessionTitle, baseBranch, branchName, commitTitle?, commitBody? }` | `CommitResult`: `{ committed, pushed, branchName?, commitMessage?, commitSha?, error? }` — **check `error` inside the 200 body** | 400, 401, 403, 404, 409, 500 | Commit sheet |
| POST | `git/discard` | V | session | `{ filePath?, oldPath? }` (empty = discard all) | `{ discarded, hasUncommittedChanges }` | 400, 401, 403, 404, 409 | Diff tab (discard) |
| GET | `git/pr` | F/V | session | — | `{ branch, prNumber, prStatus }` (answers from DB when sandbox paused) | 401, 403, 404 | Git panel, PR sheet |
| POST | `git/pr` | L | session | `{ repoUrl, branchName?, title, body?, baseBranch, headOwner?, isDraft?, shouldAutoMerge? }` | `{ success, prUrl?, prNumber?, prStatus?, requiresManualCreation?, autoMergeEnabled?, autoMergeError?, error? }` | 400, 401, 403, 404, 409, 500 | PR sheet (create) |
| POST | `git/pr/generate` | L | session | `{ sessionTitle, baseBranch, branchName }` | `{ title?, body?, branchName?, error? }` | 400, 401, 403, 404, 409, 500 | PR sheet (AI draft) |
| POST | `git/pr/merge` | L | session | `{ mergeMethod?, commitTitle?, commitMessage?, deleteBranch?, expectedHeadSha?, force? }` | `{ merged, prNumber, mergeCommitSha, branchDeleted, branchDeleteError }` | 400, 401, 403, 404, 409, 500 | Merge dialog |
| POST | `git/pr/close` | V | session | — | `{ closed, prNumber }` | 401, 403, 404, 500 | PR sheet |
| GET | `git/pr/readiness` | V | session | — | `MergeReadinessResponse`: `{ canMerge, reasons[], pr, allowedMethods[], defaultMethod, checks: { requiredTotal, passed, pending, failed }, checkRuns[] }` | 401, 403, 404 | Merge dialog (poll 5 s while pending) |
| GET | `git/deployment-url?prNumber=&branch=` | F | session | query optional | `{ deploymentUrl, buildingDeploymentUrl?, failedDeploymentUrl? }` | 400, 401, 403, 404 | PR sheet (preview link, poll 5 s/30 s) |
| POST | `/api/sessions/{sessionId}/generate-commit-message` | L | session | — | `{ message }` (always 200, fallback message on failure) | 400 no sandbox, 401, 403 bot, 404, 429 (10/min) | Commit sheet (AI message) |
| POST | `/api/sessions/{sessionId}/checks/fix` | L | session | `{ checkRuns: CheckRun[] }` (≤ 10) | `{ prompt, snippets: [{ filename, content }] }` | 400, 401, 403, 404, 429 (5/min) | Merge dialog ("Fix failing checks") |
| POST | `/api/generate-pr` | L | session | `{ sessionId, sessionTitle, baseBranch, branchName, createBranchOnly? }` | `{ title, body, branchName }` or `{ branchName }` | 400 (several), 401, 403 bot/owner, 404, 429 (5/min) | PR sheet (AI draft, legacy path) |

### 1.9 Repos, GitHub, Vercel

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| GET | `/api/github/installations` | F | session | — | `[{ installationId, accountLogin, accountType, repositorySelection, installationUrl }]` | 401, 500 | Repo picker (step 1) |
| GET | `/api/github/installations/repos?installation_id=&query=&limit=` | F | session | query; `limit` 1–100 default 50 | `[{ name, full_name, description, private, clone_url, updated_at, language }]` | 400, 401, 403, 500 | Repo picker (step 2, search) |
| GET | `/api/github/branches?owner=&repo=&limit=&query=` | F | session | query; works for public repos without GitHub link | `{ branches: string[], defaultBranch }` | 400, 401, 500 | Branch picker |
| GET | `/api/github/connection-status` | F | session | — (side effect: live installation sync) | `{ status: "not_connected"\|"connected"\|"reconnect_required", reason, hasInstallations, syncedInstallationsCount }` | 401 | Onboarding, Settings > Connections (poll after install round-trip) |
| GET | `/api/github/user` | F | session | — | `{ login, name, avatar_url }` | 401 `GitHub not connected`, 500 | Settings > Connections |
| GET | `/api/github/orgs/install-status` | F | session | — | `ConnectionStatusResponse` (personal + org install states, `tokenExpired?`) | 401, 500, 502 | Settings > Connections (org rows) |
| GET | `/api/github/app/install?next=&target_id=&reconnect=` | — | session (browser) | opened in `ASWebAuthenticationSession`, not fetched | 302 chain to github.com | — | Connections (App install; see `04-auth.md`) |
| GET | `/api/repos/{owner}/{repo}/dashboard` | F | session | — | `{ prSummary, issueSummary, actionsSummary, agents, runs, readiness, repoReadiness }` (per-window `ok:false` + `errorKind` on partial failure) | 401, 500 | Repo Dashboard |
| GET | `/api/vercel/repo-projects?repoOwner=&repoName=` | F | session | query required | `{ projects: [{ projectId, projectName, teamId, teamSlug }], selectedProjectId }` | 400, 401, 403 connect/reconnect Vercel, 500 | New Session (Vercel project picker) |
| GET | `/api/models` | P | none | — | `{ models: AvailableModel[] }` (`Cache-Control: private, no-store`) | 500 | Model picker |

### 1.10 Settings

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| GET | `/api/settings/preferences` | F | session | — | `{ preferences: UserPreferencesData }` | 401 | Settings > Preferences |
| PATCH | `/api/settings/preferences` | F | session | partial `UserPreferencesData` (per-field validation) | `{ preferences }` | 400 field-specific, 401, 500 | Settings > Preferences |
| GET | `/api/settings/agents` | F | session | — | `{ agents: [{ role, modelId, composioToolkitSlugs, composioProfileId, instructions, managedRuntimeProfileId }] }` (4 roles) | 401 | Settings > Agents |
| PATCH | `/api/settings/agents` | F | session | `{ role, modelId?, composioToolkitSlugs?, composioProfileId?, instructions?, managedRuntimeProfileId? }` — **full-row replace: omitted fields reset to null** | `{ agent }` | 400 (+`details`), 401 | Settings > Agents |
| DELETE | `/api/settings/agents` | F | session | `{ role }` (JSON body on DELETE) | `{ ok: true }` | 400, 401 | Settings > Agents (reset) |
| GET | `/api/agents/tool-entries?agentId=` | F | session | query required | `{ entries: AgentToolEntry[] }` | 400, 401 | Settings > Agents (approval queue) |
| POST | `/api/agents/tool-entries` | F | session | `{ action: "approve"\|"reject", entryId }` | `{ ok: true, action }` | 400, 401, 404 | Settings > Agents (approval queue) |
| GET | `/api/settings/skills` | F | session | — | `{ skills: UserSkill[] }` | 401 | Settings > Skills |
| POST | `/api/settings/skills` | F | session | `createUserSkillInputSchema` | 201 `{ skill }` | 400, 401, 409 duplicate name | Settings > Skills |
| PATCH | `/api/settings/skills` | F | session | `{ id, ...partial }` | `{ skill }` | 400, 401, 404, 409 | Settings > Skills |
| DELETE | `/api/settings/skills` | F | session | `{ id }` (JSON body on DELETE) | `{ success: true }` | 400, 401, 404 | Settings > Skills |
| POST | `/api/settings/skills/generate` | L | session | `{ prompt: string (1–4000) }` | `{ skill: { name, description, body } }` (draft only) | 400, 401, 403 bot, 429 (10/min, `Retry-After`), 500, 502 | Settings > Skills (AI draft) |
| GET | `/api/settings/model-variants` | F | session | — | `{ modelVariants: ModelVariant[] }` | 401 | Model picker, Settings > Models |
| POST | `/api/settings/model-variants` | F | session | `{ name, baseModelId, providerOptions? }` (≤ 16 KB) | `{ modelVariants }` | 400, 401 | Settings > Models |
| PATCH | `/api/settings/model-variants` | F | session | `{ id, name?, baseModelId?, providerOptions? }` | `{ modelVariants }` | 400, 401, 403 built-in, 404 | Settings > Models |
| DELETE | `/api/settings/model-variants` | F | session | `{ id }` (JSON body) | `{ modelVariants }` | 401, 403, 404 | Settings > Models |
| GET | `/api/settings/runtime-profiles` | F | session | — | `{ profiles: RuntimeProfileOption[] }` | 401 | Settings > Runtime Profiles |
| POST | `/api/settings/runtime-profiles` | F | session | full profile body (`createOrUpdateProfileSchema`) | 201 `{ profile }` | 400, 401 | Settings > Runtime Profiles |
| PATCH | `/api/settings/runtime-profiles/{profileId}` | F | session | full profile body (not partial) | `{ profile }` | 400, 401, 404 | Settings > Runtime Profiles |
| DELETE | `/api/settings/runtime-profiles/{profileId}` | F | session | — | `{ deletedProfileId }` | 401, 404 | Settings > Runtime Profiles |
| GET | `/api/settings/composio?repoOwner=&repoName=` | F | session | optional query | `{ status, profiles, profileOptions, repositorySettings, defaults }` | 401 | Settings > Composio |
| POST | `/api/settings/composio` | F | session | `composioToolProfileInputSchema` | 201 `{ profile }` | 400, 401 | Settings > Composio |
| PATCH | `/api/settings/composio` | F | session | `{ defaults? }` and/or `{ profileId, profile }` | `{ defaults?, profile? }` | 400, 401, 404 | Settings > Composio |
| DELETE | `/api/settings/composio` | F | session | `{ profileId }` (JSON body) | `{ success: true }` | 401, 404 | Settings > Composio |
| GET | `/api/settings/repositories/{repoOwner}/{repoName}/composio` | F | session | — | `{ profiles, profileOptions, repositorySettings, repoOwner, repoName }` | 401 | Repo Dashboard > Tools policy |
| PATCH | `/api/settings/repositories/{repoOwner}/{repoName}/composio` | F | session | `repositoryComposioSettingsInputSchema` | same shape as GET | 400, 401 | Repo Dashboard > Tools policy |
| GET | `/api/composio/status?live=1` | F | session | optional query | `{ status: ComposioServiceStatus }` (never errors) | — | Settings > Composio |
| GET | `/api/composio/toolkits` | F | session | — | `{ toolkits: [{ slug, name, description, logo, categories, managedAuth, noAuth }] }` | 502 | Settings > Composio (catalog) |
| POST | `/api/composio/connect` | F | session | `{ toolkitSlug?, authConfigId?, alias?, callbackUrl? }` | `{ id, redirectUrl }` — open `redirectUrl` in browser session; pass `callbackUrl: "openagents://composio-callback"` | 400 | Settings > Composio (connect) |
| GET | `/api/composio/connected-accounts` | F | session | — | `{ accounts: [{ id, toolkitSlug, status, alias }] }` (best-effort, never 500) | — | Settings > Composio |
| GET | `/api/inference-profiles` | F | session | — | `{ profiles: SafeInferenceProfile[] }` (key never round-trips) | 401 | Settings > Models (BYOK) |
| POST | `/api/inference-profiles` | F | session | `{ name, provider?, baseUrl?, apiKey, enabled? }` | 201 `{ profile }` | 400 friendly messages, 401 | Settings > Models (BYOK) |
| PATCH | `/api/inference-profiles` | F | session | `{ profileId, name?, baseUrl?, apiKey?, enabled? }` | `{ profile }` | 400, 401, 404 | Settings > Models (BYOK) |
| DELETE | `/api/inference-profiles` | F | session | `{ profileId }` (JSON body) | `{ success: true }` | 401, 404 | Settings > Models (BYOK) |
| POST | `/api/inference-profiles/{profileId}/test` | L | session | `{ modelId? }` | always 200 `{ profile, result: { status: "passed"\|"failed", message } }` | 400, 401, 404 | Settings > Models (test key) |

### 1.11 Usage

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| GET | `/api/usage?from=YYYY-MM-DD&to=YYYY-MM-DD` | F | session | both-or-neither query params | `{ usage: DailyUsage[], insights: UsageInsights, domainLeaderboard }` | 400, 401 | Usage screen |
| GET | `/api/usage/rank` | F | session | — | `{ rank, total, domain }` or JSON `null` (200) | 401, 500 | Usage screen (rank chip) |

### 1.12 Background agents

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| GET | `/api/background-agents` | F | session | — | `{ agents: BackgroundAgentWithTriggers[] }` | 401 | Background Agents list |
| POST | `/api/background-agents` | F | session | `createBackgroundAgentSchema` (strict) | 201 `{ agent }` | 400, 401 | Agent editor |
| PATCH | `/api/background-agents/{agentId}` | F | session | partial update schema (`triggers` replaces all) | `{ agent }` | 400, 401, 404 | Agent editor, enable/disable |
| DELETE | `/api/background-agents/{agentId}` | F | session | — | `{ success: true }` | 401, 404 | Agent editor |
| GET | `/api/background-agents/{agentId}/status` | F | session | — | `{ latestRunId, latestRunStatus, latestOutputUrl }` | 401 | Agent card (poll 4 s while active) |
| POST | `/api/background-agents/{agentId}/test` | F | session | — (honors `x-request-id`) | `BackgroundDispatchResult`: `{ enabled, matched, created, duplicates, runIds }` | 400, 401, 403 disabled, 404 | Agent card (Test) |
| GET | `/api/background-agents/readiness?repoOwner=&repoName=&permission=` | F | session | optional query | `{ enabled, ready, missing[], checks[] }` (+ `repoAccess`) | 400, 401 | Background Agents banner |
| GET | `/api/background-agent-runs?repoOwner=&repoName=&limit=` | F | session | `limit` 1–200 default 50 | `{ runs: BackgroundAgentRun[] }` | 401 | Runs list |
| GET | `/api/background-agent-runs/{runId}` | F | session | — | `{ run, agent, events (≤ 200), outputs (≤ 50) }` | 401, 404 | Run Detail (poll 2 s while queued/running) |

### 1.13 Session observability and skills

| Method | Path | Class | Auth | Request | Response 200 | Errors | Screen |
|---|---|---|---|---|---|---|---|
| GET | `/api/sessions/{sessionId}/observability?chatId=&limit=` | F | session | `limit` 1–500 default 150 | `{ runtimeMode, events, profileRuns, workflowRuns, workers, directToolUse, services, browserRuns, workflowGoals }` | 401, 403, 404 | Observability panel (poll 5 s while open) |
| GET | `/api/sessions/{sessionId}/skills?refresh=1` | V | session | optional query | `{ skills: [{ name, description }] }` (session-cached) | 400, 401, 403, 404, 409 | Chat composer slash commands |
| GET | `/api/sessions/{sessionId}/managed-runtime/profiles` | F | session | — | `{ profiles: ManagedRuntimeProfileOption[] }` | 401, 403, 404 | Runtime mode selector |

### 1.14 Deliberately NOT consumed in v1

| Surface | Reason |
|---|---|
| `/api/harness/*` (Verified Build) | env-gated experimental; start affordance not wired even on web (research brief 05 §2.3). Render `data-verified-build` chat parts read-only only. |
| `/api/workflows/catalog` | all 4 catalog entries `enabled: false`; picker inert on web |
| `/api/github/create-repo` | 501 stub |
| `/api/vercel/projects/{idOrName}/env` | deliberate 404 stub (security) |
| `/api/github/webhook`, `/api/background-agents/cron`, `/api/background-agents/webhook/*` | machine-to-machine |
| `/api/sessions/{sessionId}/dev-server`, `code-editor`, `sandbox-services`, `browser-runs` | deferred to a post-v1 phase per `01-product-and-ux.md`; contracts documented in research brief 02 §5 |
| `/api/sessions/{sessionId}/chats/{chatId}/debug-bundle` | web/debug tooling; revisit for support flows |

---

## 2. Server-side OpenAPI expansion workstream

### 2.1 Current state (verified)

- Builder: `apps/web/lib/api/openapi-spec.ts` — `buildOpenApiDocument()` returns OpenAPI
  3.0.3 from the same Zod v4 schemas the routes validate with, serialized via
  `z.toJSONSchema(schema, { target: "openapi-3.0", io })`.
- Artifacts: `apps/web/openapi.json` (committed) and `apps/web/lib/api/openapi-types.ts`
  (generated by `openapi-typescript`).
- Scripts (`apps/web/package.json`): `openapi:generate`, `openapi:types`, `openapi:check`.
- Drift gates: `apps/web/scripts/check-openapi.ts` (string-compares
  `JSON.stringify(buildOpenApiDocument(), null, 2) + "\n"` against the committed file)
  and `apps/web/lib/api/openapi-spec.test.ts` (deep-equals committed JSON vs the built
  doc; enforces unique `operationId`s and a documented 401 per operation). The test runs
  inside `bun run ci`.
- Coverage today: **6 paths / 10 operations** (skills CRUD, `git/status`, `git/branch`,
  `git/commit`, `git/pr` GET+POST, `git/pr/merge`).

### 2.2 Swift-codegen blockers and their fixes

All fixes happen **inside `buildOpenApiDocument()`** (or helpers it calls in
`apps/web/lib/api/openapi-spec.ts`). Because `check-openapi.ts`, the unit test, and
`generate-openapi.ts` all call the same function, changing the builder and regenerating
the artifacts keeps every gate green automatically. Never hand-edit `openapi.json`.

#### Blocker 1 — `additionalProperties: false` (49 occurrences in `apps/web/openapi.json`)

Zod object schemas serialize with `additionalProperties: false`. swift-openapi-generator
maps such objects to closed structs that **fail to decode** when the server adds a new
field — every additive backend change would break shipped iOS builds. Fix: strip the
`false` values recursively at serialization time. Keep `additionalProperties` when it is
a schema object (that is how `z.record(...)` expresses typed maps).

Add to `openapi-spec.ts`:

```ts
function stripClosedObjects(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripClosedObjects);
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "additionalProperties" && value === false) {
        continue; // open the object for forward compatibility
      }
      out[key] = stripClosedObjects(value);
    }
    return out;
  }
  return node;
}

function j(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  return stripClosedObjects(
    z.toJSONSchema(schema, { target: "openapi-3.0", io }),
  ) as JsonSchema;
}
```

Acceptance check: `grep -c '"additionalProperties": false' apps/web/openapi.json`
returns `0` after regeneration.

#### Blocker 2 — no `components.schemas` (everything inlined)

The committed spec has no `components` section; the `{ error: string }` envelope alone is
repeated ~30 times. swift-openapi-generator generates anonymous nested types
(`Operations.listSkills.Output.Ok.Body.jsonPayload`) for every inline schema, which makes
the Swift surface unusable at this scale. Fix: a per-build registry that hoists named
schemas and emits `$ref`s.

```ts
type SchemaRegistry = Map<string, JsonSchema>;

function makeRef(registry: SchemaRegistry) {
  return function ref(
    name: string,
    schema: z.ZodType,
    io: "input" | "output" = "output",
  ): JsonSchema {
    const existing = registry.get(name);
    const built = j(schema, io);
    if (existing && JSON.stringify(existing) !== JSON.stringify(built)) {
      throw new Error(`OpenAPI schema name collision: ${name}`);
    }
    registry.set(name, built);
    return { $ref: `#/components/schemas/${name}` };
  };
}

export function buildOpenApiDocument() {
  const registry: SchemaRegistry = new Map();
  const ref = makeRef(registry);
  // ... build paths using ref("ErrorResponse", errorSchema) etc.
  return {
    openapi: "3.0.3",
    info: { /* unchanged */ },
    servers: [{ url: "/" }],
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    paths: { /* ... */ },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
        },
      },
      schemas: Object.fromEntries(
        [...registry.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
  };
}
```

**Stable naming convention** (these become Swift type names under
`Components.Schemas.*`; never rename without a migration note in the PR):

| Schema name | Source |
|---|---|
| `ErrorResponse` | `{ error: string }` envelope |
| `Session`, `SessionSummary`, `SessionListResponse`, `CreateSessionRequest`, `UpdateSessionRequest` | sessions routes |
| `Chat`, `ChatSummary`, `ChatListResponse` | chats routes |
| `SandboxStatusResponse`, `SandboxReconnectResponse`, `SandboxCreateRequest`, `SandboxCreateResponse`, `SandboxSnapshotResponse`, `SandboxResumeResponse` | sandbox routes |
| `DiffResponse`, `DiffFile`, `DiffSummary`, `CachedDiffResponse`, `FilesResponse`, `FileEntry`, `FileContentResponse` | files/diff routes |
| `SessionGitStatus`, `CommitResult`, `OpenPullRequestResult`, `MergePullRequestResult`, `MergeReadinessResponse`, `CheckRun`, `PrStatusResponse`, `PrDeploymentResponse`, `DiscardResult`, `GeneratePrContentResult` | git routes |
| `UserSkill`, `UserPreferences`, `AgentSettingsRow`, `AgentToolEntry`, `ModelVariant`, `RuntimeProfileOption`, `ManagedRuntimeProfile`, `SafeInferenceProfile`, `ComposioServiceStatus`, `ComposioToolProfile`, `ComposioAgentDefaults` | settings routes |
| `AvailableModel`, `ModelsResponse` | `/api/models` |
| `GitHubInstallation`, `InstallationRepository`, `BranchesResponse`, `GitHubConnectionStatus`, `GitHubUser`, `OrgsInstallStatusResponse`, `RepoDashboardResponse`, `VercelRepoProjectsResponse` | github/vercel routes |
| `DailyUsage`, `UsageInsights`, `UsageResponse`, `UsageRankResponse` | usage routes |
| `BackgroundAgent`, `BackgroundAgentTrigger`, `BackgroundAgentRun`, `BackgroundAgentEvent`, `BackgroundAgentOutput`, `BackgroundAgentRunDetailResponse`, `BackgroundDispatchResult`, `BackgroundAgentReadiness` | background-agent routes |
| `UIMessage` | `{ type: "object", properties: { id: {type:"string"}, role: {type:"string"}, parts: { type:"array", items:{type:"object"} }, metadata: {type:"object"} }, required: ["id","role","parts"] }` — deliberately loose; ChatKit owns the real decode (§0.4) |

#### Blocker 3 — missing `format: date-time` on timestamp strings

Every timestamp the server returns is an ISO-8601 string with fractional seconds
(Drizzle `Date` → `Response.json`), but the spec types them as bare `z.string()` so
Swift gets `String` instead of `Foundation.Date`. Fix: in every **response** schema in
`openapi-spec.ts`, declare timestamps as `z.iso.datetime()` (Zod 4 serializes this to
`{ "type": "string", "format": "date-time" }`). Fields to convert wherever they appear:
`createdAt`, `updatedAt`, `lastActivityAt`, `lastAssistantMessageAt`, `cachedAt`,
`testedAt`, `approvedAt`, `startedAt`, `finishedAt`, `expiresAt` (when ISO — note
sandbox lifecycle uses **epoch milliseconds numbers** for `serverTime`,
`sandboxExpiresAt`, `hibernateAfter`, `lastActivityAt` inside `lifecycle`; keep those
`z.number()` and document the unit in the field `description`).

On the Swift side, configure the date transcoder for fractional seconds (the default
ISO-8601 transcoder rejects `2026-06-09T12:34:56.789Z`):

```swift
let client = Client(
  serverURL: environment.baseURL,
  configuration: Configuration(dateTranscoder: .iso8601WithFractionalSeconds),
  transport: URLSessionTransport(configuration: .init(session: apiSession)),
  middlewares: middlewares
)
```

#### Blocker 4 — three untyped mutation responses

`commitChanges`, `openPullRequest`, and `mergePullRequest` responses are
`z.record(z.string(), z.unknown())` (`openapi-spec.ts:188-191, 226-229, 245-248`) →
untyped dictionaries in Swift. Replace with real shapes (`CommitResult`,
`OpenPullRequestResult`, `MergePullRequestResult` per §1.8), mirroring
`apps/web/lib/github/actions/commit.ts` and `apps/web/lib/github/actions/pr.ts`.

#### Blocker 5 — no `securitySchemes`

Add `bearerAuth` + `cookieAuth` and global `security` as shown in Blocker 2. This is what
lets the generated client and the auth middleware agree that every operation is
authenticated (the spec-level statement; enforcement stays server-side).

### 2.3 Route-addition batches

Each batch is one PR-sized GitHub issue (per `docs/process/feature-ticket-format.md`).
For each route: import the route's real Zod request schema where one exists
(`apps/web/lib/git/http-schemas.ts`, `apps/web/lib/skills/skill-types.ts`,
`apps/web/lib/composio/types.ts`, `apps/web/lib/background-agents/types.ts`); where the
route validates manually (sessions, sandbox), first extract a Zod schema into a
colocated `apps/web/lib/<domain>/http-schemas.ts` and make the route validate with it
(behavior-first TDD: failing contract test, then schema, then spec entry). Response
schemas are declared in `openapi-spec.ts` and registered via `ref(...)`.

| Batch | Paths added | New operations (operationIds) |
|---|---|---|
| **A — hygiene** | none (Blockers 1–5 only) | 0 new; spec rewrite + regenerated artifacts |
| **B — sessions & chats** | `/api/sessions`, `/api/sessions/{sessionId}`, `/api/sessions/{sessionId}/chats`, `/api/sessions/{sessionId}/chats/{chatId}`, `.../messages`, `.../messages/{messageId}`, `.../fork`, `.../read`, `.../share` | `listSessions`, `createSession`, `getSession`, `updateSession`, `deleteSession`, `listChats`, `createChat`, `getChat`, `updateChat`, `deleteChat`, `persistAssistantMessage`, `deleteMessageCascade`, `forkChat`, `markChatRead`, `getChatShare`, `createChatShare`, `deleteChatShare` |
| **C — sandbox** | `/api/sandbox`, `/api/sandbox/status`, `/api/sandbox/reconnect`, `/api/sandbox/extend`, `/api/sandbox/snapshot`, `/api/sandbox/activity`, `/api/sessions/{sessionId}/sandbox` | `createSandbox`, `stopSandbox`, `getSandboxStatus`, `reconnectSandbox`, `extendSandbox`, `pauseSandbox`, `resumeSandbox`, `pingSandboxActivity`, `attachSessionSandbox` |
| **D — files, diff, remaining git** | `/files`, `/files/content`, `/diff`, `/diff/cached`, `git/discard`, `git/pr/generate`, `git/pr/close`, `git/pr/readiness`, `git/deployment-url`, `/generate-commit-message`, `/checks/fix`, `/api/generate-pr` | `listSessionFiles`, `getSessionFileContent`, `getSessionDiff`, `getCachedSessionDiff`, `discardChanges`, `generatePrContent`, `closePullRequest`, `getMergeReadiness`, `getDeploymentUrl`, `generateCommitMessage`, `fixFailingChecks`, `generatePr` |
| **E — settings & models** | `/api/settings/preferences`, `/agents`, `/api/agents/tool-entries`, `/model-variants`, `/runtime-profiles` (+`/{profileId}`), `/api/settings/composio`, `/api/settings/repositories/{repoOwner}/{repoName}/composio`, `/api/composio/{status,toolkits,connect,connected-accounts}`, `/api/inference-profiles` (+`/{profileId}/test`), `/api/models`, `/api/usage`, `/api/usage/rank`, `/api/generate-title`, `/api/transcribe` | `getPreferences`, `updatePreferences`, `listAgents`, `updateAgent`, `resetAgent`, `listToolEntries`, `reviewToolEntry`, `listModelVariants`, `createModelVariant`, `updateModelVariant`, `deleteModelVariant`, `listRuntimeProfiles`, `createRuntimeProfile`, `updateRuntimeProfile`, `deleteRuntimeProfile`, `getComposioSettings`, `createComposioProfile`, `updateComposioSettings`, `deleteComposioProfile`, `getRepoComposioSettings`, `updateRepoComposioSettings`, `getComposioStatus`, `listComposioToolkits`, `connectComposio`, `listComposioConnectedAccounts`, `listInferenceProfiles`, `createInferenceProfile`, `updateInferenceProfile`, `deleteInferenceProfile`, `testInferenceProfile`, `listModels`, `getUsage`, `getUsageRank`, `generateTitle`, `transcribeAudio` |
| **F — GitHub, repos, Vercel, background agents** | `/api/github/{installations,installations/repos,branches,connection-status,user,orgs/install-status}`, `/api/repos/{owner}/{repo}/dashboard`, `/api/vercel/repo-projects`, `/api/background-agents` (+`/{agentId}`, `/status`, `/test`, `/readiness`), `/api/background-agent-runs` (+`/{runId}`), `/api/sessions/{sessionId}/observability`, `/api/sessions/{sessionId}/skills`, `/api/sessions/{sessionId}/managed-runtime/profiles`, `/api/shared/{shareId}/status` | `listInstallations`, `listInstallationRepos`, `listBranches`, `getGitHubConnectionStatus`, `getGitHubUser`, `getOrgsInstallStatus`, `getRepoDashboard`, `listVercelRepoProjects`, `listBackgroundAgents`, `createBackgroundAgent`, `updateBackgroundAgent`, `deleteBackgroundAgent`, `getBackgroundAgentStatus`, `testBackgroundAgent`, `getBackgroundAgentReadiness`, `listBackgroundAgentRuns`, `getBackgroundAgentRun`, `getSessionObservability`, `listSessionSkills`, `listSessionRuntimeProfiles`, `getSharedChatStatus` |

Streaming endpoints (`POST /api/chat`, `GET /api/chat/{chatId}/stream`,
`POST /api/chat/{chatId}/stop`) are **documented in the spec as operations with
`text/event-stream` / loose JSON bodies for discoverability, but excluded from Swift
codegen** via the generator config filter (§3.2) — the hand-rolled ChatKit client owns
them.

### 2.4 Keeping `scripts/check-openapi.ts` green — exact procedure per batch

For every spec change (same PR, in order):

```bash
# 1. Edit apps/web/lib/api/openapi-spec.ts (and any new lib/<domain>/http-schemas.ts)
# 2. Regenerate both artifacts:
bun run --cwd apps/web openapi:generate
bun run --cwd apps/web openapi:types
# 3. Verify the drift gates locally:
bun run --cwd apps/web openapi:check          # exits 0, prints "✓ openapi.json is in sync"
bun test apps/web/lib/api/openapi-spec.test.ts
# 4. Full gate:
bun --bun run ci
# 5. Commit openapi-spec.ts + openapi.json + openapi-types.ts together.
```

Rules that keep the gates green by construction:

- All transformations (stripping, hoisting, sorting `components.schemas`
  alphabetically) live inside `buildOpenApiDocument()` so the generator, the checker,
  and the unit test always see identical output.
- `openapi-spec.test.ts` requires a unique `operationId` and a documented `401` on every
  operation — copy the existing pattern; public endpoints (`/api/models`,
  `/api/shared/{shareId}/status`) still declare `security: []` per-operation and omit the
  401 only if the test is amended to allow an explicit allowlist (preferred: add
  `const publicOperationIds = new Set(["listModels", "getSharedChatStatus"])` to the
  test in Batch A).
- Adding `components` and `security` to the document changes `openapi.json` wholesale —
  Batch A must regenerate and commit both artifacts in the same PR as the builder change.

### 2.5 Server-side companion tasks (same workstream, tracked as issues)

| Task | Why |
|---|---|
| BotID exemption or verification for native clients on `POST /api/chat`, `/api/sessions`, `/api/sandbox`, `/api/generate-title`, `/api/generate-pr`, `/api/transcribe`, `/api/sessions/*/generate-commit-message`, `/api/settings/skills/generate` | `checkBotProtection()` may 403 non-browser traffic; spike first, then either pass-through for bearer-authenticated requests or scoped exemption. Cross-ref `04-auth.md`. |
| better-auth `bearer()` plugin + `trustedOrigins: ["openagents://"]` | iOS auth transport (owned by `04-auth.md`; the spec's `bearerAuth` scheme depends on it) |
| `GET /api/chat/{chatId}/stream` `?startIndex=` support | optional bandwidth optimization; full replay is the v1 contract (`05-streaming-chat-engine.md`) |
| Contract-test expansion (`apps/web/tests/contract/`) for every batch | each batch lands with black-box shape tests using the existing `CONTRACT_BASE_URL` + test-auth cookie harness |
| `usage_events.source` enum gains `"ios"` | attribution for native-originated turns (migration via `bun run --cwd apps/web db:generate`) |

---

## 3. `swift-openapi-generator` setup in `ios/Packages/OpenAgentsAPI`

### 3.1 Package layout (checked-in generated sources — no build plugin)

We use **CLI-based generation with committed sources**, not the SwiftPM build plugin:
deterministic builds, reviewable diffs, no codegen at app-build time, and a CI drift
check that mirrors the web's `openapi:check`.

```
ios/
  Packages/
    OpenAgentsAPI/
      Package.swift
      openapi.json                      # vendored copy of apps/web/openapi.json
      openapi-generator-config.yaml
      Sources/
        OpenAgentsAPI/
          Generated/
            Types.swift                 # generated — do not edit
            Client.swift                # generated — do not edit
          OpenAgentsAPI.swift           # hand-written: factory + re-exports
      Tests/
        OpenAgentsAPITests/
          GeneratedClientSmokeTests.swift
  Tools/
    openapi-generator/
      Package.swift                     # pins the generator CLI at 1.12.2
  scripts/
    generate-openapi-client.sh
    check-openapi-client.sh
```

`ios/Packages/OpenAgentsAPI/Package.swift`:

```swift
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "OpenAgentsAPI",
  platforms: [.iOS(.v26)],
  products: [
    .library(name: "OpenAgentsAPI", targets: ["OpenAgentsAPI"]),
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.8.2"),
    .package(url: "https://github.com/apple/swift-openapi-urlsession", exact: "1.1.0"),
  ],
  targets: [
    .target(
      name: "OpenAgentsAPI",
      dependencies: [
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
      ]
    ),
    .testTarget(name: "OpenAgentsAPITests", dependencies: ["OpenAgentsAPI"]),
  ]
)
```

`ios/Tools/openapi-generator/Package.swift` (pins the CLI; nothing else depends on it):

```swift
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "openapi-generator-tools",
  platforms: [.macOS(.v14)],
  dependencies: [
    .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.12.2"),
  ]
)
```

### 3.2 `openapi-generator-config.yaml` contents

`ios/Packages/OpenAgentsAPI/openapi-generator-config.yaml`:

```yaml
generate:
  - types
  - client
accessModifier: public
namingStrategy: idiomatic
filter:
  # Exclude streaming/dynamic endpoints owned by the hand-rolled ChatKit client (§0.4).
  # Everything not excluded is generated. Operations listed here exist in the spec for
  # documentation but must not produce Swift symbols.
  operations: []   # populated by the generation script with the full include list
```

Note on `filter`: swift-openapi-generator filters are **include** lists. The generation
script (§3.3) computes the include list as "every operationId in the spec **except**
`postChat`, `resumeChatStream`, `stopChat`, `getChat`" (the four hand-rolled
operations) and rewrites the `filter.operations` array before invoking the generator, so
new server operations are picked up automatically. If maintaining the dynamic list
proves noisy, the fallback is: include everything (delete the `filter` key) and simply
never call the four generated methods — decide in implementation, prefer the filter.

### 3.3 Generation script

`ios/scripts/generate-openapi-client.sh` (executable, `chmod +x`):

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="$REPO_ROOT/ios/Packages/OpenAgentsAPI"
TOOLS="$REPO_ROOT/ios/Tools/openapi-generator"

# 1. Vendor the spec from the web app (single source of truth).
cp "$REPO_ROOT/apps/web/openapi.json" "$PKG/openapi.json"

# 2. Rebuild the operation include-list (all operationIds minus hand-rolled ones).
bun run "$REPO_ROOT/ios/scripts/update-openapi-filter.ts"   # rewrites filter.operations in the yaml

# 3. Generate into the committed Generated/ directory.
swift run --package-path "$TOOLS" swift-openapi-generator generate \
  "$PKG/openapi.json" \
  --config "$PKG/openapi-generator-config.yaml" \
  --output-directory "$PKG/Sources/OpenAgentsAPI/Generated"

# 4. Compile check.
swift build --package-path "$PKG"
echo "✓ OpenAgentsAPI regenerated"
```

`ios/scripts/update-openapi-filter.ts` is a ~30-line Bun script: parse
`apps/web/openapi.json`, collect every `operationId`, subtract
`["postChat", "resumeChatStream", "stopChat", "getChat"]`, write the sorted list into the
`filter.operations` key of `openapi-generator-config.yaml`.

Run after every backend contract batch lands; commit `openapi.json`,
`openapi-generator-config.yaml`, and `Sources/OpenAgentsAPI/Generated/*` together.

### 3.4 CI drift check (mirrors `apps/web/scripts/check-openapi.ts`)

`ios/scripts/check-openapi-client.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# 1. Vendored spec must match the web artifact byte-for-byte.
diff -q "$REPO_ROOT/apps/web/openapi.json" \
        "$REPO_ROOT/ios/Packages/OpenAgentsAPI/openapi.json" \
  || { echo "openapi.json drift: run ios/scripts/generate-openapi-client.sh"; exit 1; }

# 2. Regenerating must be a no-op against the committed sources.
"$REPO_ROOT/ios/scripts/generate-openapi-client.sh"
git -C "$REPO_ROOT" diff --exit-code -- ios/Packages/OpenAgentsAPI \
  || { echo "Generated client drift: commit the regenerated sources"; exit 1; }
echo "✓ OpenAgentsAPI is in sync with apps/web/openapi.json"
```

Wired into the iOS GitHub Actions workflow (`08-ci-cd-release.md`) as a job step on
`macos-26` before tests. A backend PR that changes `apps/web/openapi.json` does **not**
fail iOS CI on its own (different artifact directories); the iOS regeneration is a
follow-up commit — the check guarantees the two can never silently diverge once
regenerated, and a scheduled weekly run of the check on `main`/`develop` flags pending
regenerations.

### 3.5 Client construction (hand-written factory)

`Sources/OpenAgentsAPI/OpenAgentsAPI.swift`:

```swift
import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

public enum OpenAgentsAPIFactory {
  public static func makeClient(
    serverURL: URL,
    session: URLSession,
    middlewares: [any ClientMiddleware]
  ) -> Client {
    Client(
      serverURL: serverURL,
      configuration: Configuration(dateTranscoder: .iso8601WithFractionalSeconds),
      transport: URLSessionTransport(configuration: .init(session: session)),
      middlewares: middlewares
    )
  }
}
```

---

## 4. The networking layer

Lives in `ios/Packages/OpenAgentsKit/Sources/Networking/` (`03-architecture.md` defines
the package). The generated client, the hand-rolled `RawHTTPClient`, and the SSE client
(`05-streaming-chat-engine.md`) all share the same middleware semantics, error taxonomy,
and environment configuration.

### 4.1 `ClientMiddleware` chain (order matters)

Registered on the generated client in this order (outermost first):

| # | Middleware | Responsibility |
|---|---|---|
| 1 | `RequestIDMiddleware` | Sets `x-request-id: ios-<UUIDv4 lowercase>` on every request (matches the server's accepted pattern `/^[A-Za-z0-9._:/=-]{8,128}$/`, `apps/web/lib/harness/request-id.ts`). Stores the ID in task-local context for log correlation (`07-observability.md`). |
| 2 | `AuthMiddleware` | Injects `Authorization: Bearer <token>` from the Keychain-backed `TokenStore` actor. After every response, reads the `set-auth-token` response header (better-auth bearer-plugin rotation) and atomically persists the new token before the response is returned to the caller. On 401 with body `{"error":"Not authenticated"}`: clears local session state and emits `.sessionExpired` (app signs out and returns to Sign-in — mirrors `apps/web/app/providers.tsx` global SWR 401 handler). See `04-auth.md` for the token lifecycle. |
| 3 | `EnvironmentHeadersMiddleware` | Preview environment only: injects `x-vercel-protection-bypass: <secret>` (value entered in the debug environment picker, §4.6). No-op in production/localhost. |
| 4 | `LoggingMiddleware` | `os.Logger` (subsystem `com.openagents.ios`, category `network`): method, path template, status, duration, request ID. Never logs bodies or the bearer token (`07-observability.md` redaction rules). |
| 5 | `RetryMiddleware` | Implements §4.4. Innermost so retries re-enter logging but not auth re-injection ordering issues (the token read happens per-attempt via middleware 2 being *outside*— note: because retry is innermost, each attempt reuses the already-injected header; acceptable because rotation only happens on responses, and a 401 is never retried). |

The hand-rolled `RawHTTPClient` (SSE + raw-body endpoints) applies middlewares 1–4
manually (same types, invoked directly); retries for streams are connection-level
reconnects owned by the chat engine, not `RetryMiddleware`.

### 4.2 Error taxonomy

Single public error type in `OpenAgentsKit`; every repository method throws it. All
mapping happens in one `APIErrorMapper` so the taxonomy cannot fork.

```swift
public enum APIError: Error, Sendable {
  // Transport
  case offline                       // URLError .notConnectedToInternet / .networkConnectionLost
  case timeout                       // URLError .timedOut
  case transport(URLError)           // any other URLError
  // HTTP, mapped from status + { error: string } envelope
  case notAuthenticated              // 401 — triggers sign-out path (middleware 2)
  case forbidden(message: String)    // 403 — includes BotID "Access denied"
  case notFound(message: String)     // 404
  case validation(message: String, fieldErrors: [String: [String]]?) // 400, 422
  case conflict(kind: ConflictKind, message: String)                 // 409
  case rateLimited(retryAfter: TimeInterval?)                        // 429
  case payloadTooLarge(message: String)                              // 413
  case gone(message: String)                                         // 410
  case server(status: Int, message: String, requestID: String?)     // 5xx
  // Decoding / contract
  case decoding(operationID: String, underlying: any Error)
  // Streaming (thrown by ChatKit; included for one taxonomy)
  case streamInterrupted(reason: StreamInterruptReason)
}

public enum ConflictKind: Sendable {
  case sandboxUnavailable     // body message == "Sandbox is unavailable. Please resume sandbox."
  case duplicateWorkflow      // "Another workflow is already running for this chat"
  case chatIDConflict         // "Chat ID conflict"
  case messageWhileStreaming  // "Cannot delete messages while a response is streaming"
  case other                  // any other 409
}
```

Mapping rules (exact):

- Parse the body as `{ error: string }`; if parsing fails, use the HTTP status text.
- `409` → match the `error` string against the table above to pick `ConflictKind`.
  `.sandboxUnavailable` drives the global "Resume sandbox" affordance
  (`01-product-and-ux.md`).
- `429` → read `Retry-After` header (seconds) when present
  (`apps/web/lib/rate-limit.ts` sets it on skills/generate; other limiters may not —
  `retryAfter` is optional).
- `403` with `error == "Access denied"` is the BotID signature — surface a distinct
  user-facing message and log a `botid_blocked` event (`07-observability.md`) so the
  server-side exemption task (§2.5) gets real-world signal.
- In-200 errors: `CommitResult.error`, `OpenPullRequestResult.error`,
  `GeneratePrContentResult.error`, and `git/status`'s `{ status: null }` are **data, not
  thrown errors** — repositories surface them as result-state, never as `APIError`.

### 4.3 Timeout policy

Two `URLSession` instances, both with `waitsForConnectivity = true`:

| Session | Used by classes | `timeoutIntervalForRequest` (idle/inter-byte) | `timeoutIntervalForResource` (total) |
|---|---|---|---|
| `apiSession` | F, V, P, R | 30 s | 120 s |
| `longRunningSession` | L | 60 s | **600 s** (sandbox boot + clone, git push, LLM calls keep the request open for minutes) |
| `sseSession` (in ChatKit) | S | **300 s** idle (agent steps can be silent while tools run) | 3600 s |

Per-request overrides: `POST /api/sandbox` and `PUT /api/sandbox/snapshot` use the
long-running session with the full 600 s resource timeout; `POST /api/transcribe` uses
120 s. The generated client routes class-L operations to `longRunningSession` via a
second `Client` instance (`apiClient` / `longRunningClient`) built from the same
middleware array — the repository layer picks the client per operation using the class
column in §1.

SSE specifics: `timeoutIntervalForRequest` resets on every received byte, so 300 s only
fires after a genuinely silent 5 minutes; recovery is then the resume path
(`GET /api/chat/{chatId}/stream`), not a blind retry (`05-streaming-chat-engine.md`).

### 4.4 Retry/backoff policy per endpoint class

| Class | Retry policy |
|---|---|
| F, P (GET only) | Up to 3 attempts. Retry on: `URLError` connection failures, 502/503/504, 429 (honoring `Retry-After` when present). Backoff: 0.5 s, 1 s, 2 s + full jitter (`Double.random(in: 0...delay)` added). Never retry 4xx other than 429. |
| F (mutations: POST/PATCH/DELETE) | **No automatic retry** after bytes are sent (server state may have changed). Retry once only when the failure is provably pre-send (`URLError.cannotConnectToHost`, `.dnsLookupFailed`, `.notConnectedToInternet`). Idempotent-by-design mutations (`POST .../chats` with client UUID, `POST .../read`, `POST /api/sandbox/activity`) may opt into the GET policy via a per-operation allowlist in `RetryMiddleware`. |
| V | Same as F for GETs, but a 409 `.sandboxUnavailable` is **never retried** — it is a state transition (offer Resume). |
| L | **Never retried automatically.** Failures surface to the user with an explicit retry button. Rationale: replaying `git/commit` or `POST /api/sandbox` can double-execute expensive/visible work. |
| S | No transport retry. Reconnection = the documented resume flow with the web's probe schedule (0 s, 1 s, 2.5 s, 5.5 s, 10 s) on foreground/network-regain (`05-streaming-chat-engine.md`). |
| R | Same as the GET policy (all R endpoints are GETs). |

Rate-limit budget awareness: the client must respect the server's per-user limits
(sessions create 10/min, sandbox create 20/min, sandbox delete 10/min, extend 3/min,
generate-commit-message 10/min, checks/fix 5/min, generate-pr 5/min, generate-title
10/min, transcribe 5/min, skills/generate 10/min). UI actions that hit these endpoints
are debounced at the view-model layer; a 429 disables the triggering control for
`retryAfter ?? 60` seconds.

### 4.5 Polling cadences (mirror of the web client)

The repository layer schedules polls with these exact cadences (research brief 11 §4),
suspending all timers when the app is backgrounded (`scenePhase != .active`):

| Data | Endpoint | Cadence |
|---|---|---|
| Sessions list | `GET /api/sessions` | 3 s while any session `hasStreaming`, else 30 s |
| Chats in session | `GET /api/sessions/{sid}/chats` | 1 s while any chat streaming, 8 s foreground idle, paused when scene inactive |
| Sandbox status | `GET /api/sandbox/status` | 15 s while session visible; client-side throttle ≥ 5 s |
| Observability panel | `GET .../observability` | 5 s while panel open |
| Merge readiness | `GET git/pr/readiness` | 5 s while merge sheet open and checks pending (max 6 transient-failure polls) |
| Deployment URL | `GET git/deployment-url` | 5 s foreground until resolved |
| Background run detail | `GET /api/background-agent-runs/{runId}` | 2 s while `queued`/`running`, else stop |
| Background agent card | `GET /api/background-agents/{id}/status` | 4 s while latest run active, else stop |
| Activity ping | `POST /api/sandbox/activity` | on composer focus, throttled to once / 5 min |
| Read receipt | `POST .../read` | on chat open + on foreground, throttled 3 s |

### 4.6 Environment configuration

Single source of truth: `ios/App/Sources/Core/AppEnvironment.swift`.

```swift
public enum AppEnvironment: String, CaseIterable, Sendable {
  case production
  case preview
  case localhost

  public var baseURL: URL {
    switch self {
    case .production:
      // The Vercel production domain of apps/web. Set once during M1 of
      // 09-step-by-step-build-guide.md (read it from the Vercel project:
      // `vercel project ls` / project settings) and never hardcode elsewhere.
      return URL(string: Self.productionBaseURLString)!
    case .preview:
      return UserDefaults.standard.url(forKey: "api.preview.baseURL")
        ?? URL(string: Self.productionBaseURLString)!
    case .localhost:
      return URL(string: "http://localhost:3000")!
    }
  }
  public static let productionBaseURLString = "https://PRODUCTION-DOMAIN" // TODO(M1): replace; build fails via assert in DEBUG if unchanged
}
```

Rules:

- **Release builds are pinned to `.production`.** The environment picker (current
  environment, preview URL field, preview bypass-secret field) is compiled only under
  `#if DEBUG` and lives in Settings > Developer. Selection persists in `UserDefaults`
  key `api.environment.override`; changing it tears down and rebuilds the client stack
  (clients are owned by a `NetworkingContainer` `@Observable` object).
- **Localhost**: `http://localhost:3000` requires an ATS exception scoped to localhost in
  `ios/App/project.yml` target settings:
  `NSAppTransportSecurity > NSAllowsLocalNetworking = YES` (Debug configuration only).
  The dev server runs via `bun run web` from the repo root.
- **Preview**: arbitrary `https://*.vercel.app` URL pasted into the picker; requests add
  `x-vercel-protection-bypass` (middleware 3) using the secret pasted alongside.
  Preview deployments use isolated Neon database branches, so test data never touches
  production.
- The auth deep-link callback (`openagents://`) is environment-independent; the bearer
  token store is **namespaced per environment** (Keychain account =
  `session-token.<environment>.<baseURL-host>`) so switching environments never leaks
  tokens across backends.

---

## 5. Pagination, caching, and conditional requests

### 5.1 Pagination — what exists, what to do

The backend has almost no pagination; the iOS app must not invent client-side cursors
that the server cannot honor.

| Endpoint class | Server behavior | iOS strategy |
|---|---|---|
| `GET /api/sessions?status=archived` | real `limit`/`offset` + `pagination: { hasMore, nextOffset }` | infinite scroll on the Archive screen: request `limit=50`, append pages while `hasMore`, keyed by `nextOffset` |
| `GET /api/github/installations/repos` | `limit` (1–100) + server-side `query` substring search | search-as-you-type with 300 ms debounce, `limit=50`; no client paging |
| `GET /api/background-agent-runs` | `limit` 1–200, no offset | fetch `limit=50`; "Load more" re-fetches with a larger limit (server has no cursor) |
| Messages in a chat | **no paging** — full `UIMessage[]` array | fetch whole; persist to GRDB; render lazily (`03-architecture.md`). Budget for multi-MB payloads on long chats. |
| Everything else (sessions all/active, chats, diffs, events, observability) | full list, server-bounded | fetch whole, diff into GRDB |

### 5.2 Caching strategy per endpoint class

HTTP-level caching is **disabled** for API calls: the server sends `Cache-Control:
no-store`/`private, no-store` on the sensitive endpoints and no validators (`ETag`,
`Last-Modified`) anywhere — confirmed across research briefs 01–05. Both `URLSession`
instances set `requestCachePolicy = .reloadIgnoringLocalCacheData` and
`urlCache = nil`. All caching is application-level in GRDB (stale-while-revalidate),
owned by the repository layer:

| Data | Store | TTL / refresh trigger |
|---|---|---|
| Sessions, chats, messages | GRDB tables (canonical offline copy) | poll cadences in §4.5; reconciled by `id` |
| Cached diff | GRDB, from `GET .../diff/cached` (`{ data, cachedAt, isStale }`) | shown with a staleness banner when sandbox is hibernated/offline; replaced by live `GET .../diff` when connected |
| Models catalog (`/api/models`) | GRDB, single row | refresh on app launch + 1 h TTL (server itself revalidates models.dev hourly) |
| Composio toolkits | GRDB | 1 h TTL (server sets `revalidate = 3600`) |
| Preferences, agents, skills, variants, inference profiles | GRDB | refresh on screen appear + after every mutation (write-through: PATCH response replaces the cached row) |
| GitHub installations/repos/branches | memory cache (NSCache) only | 30 s dedupe window, mirroring web's `dedupingInterval`; never persisted (privacy + freshness) |
| Avatars, toolkit logos | `URLCache` via a third plain `imageSession` (these are public CDN URLs with real cache headers) | HTTP-driven |

Write-through rule: every mutation response that returns the updated entity
(`{ session }`, `{ chat }`, `{ preferences }`, `{ profile }`, `{ modelVariants }`)
replaces the GRDB row(s) directly — no follow-up GET. Mutations that return only
`{ success: true }` (delete message, read receipt, share revoke) trigger a targeted
re-fetch of the affected list.

Optimistic updates replicate the web patterns (research brief 11 §5): snapshot GRDB
state → apply optimistic write → fire request → reconcile or roll back on `APIError`.
v1 scope: create chat (client UUID), rename/archive session, chat model change,
read receipts. Everything else waits for the server response.

### 5.3 Conditional requests and change detection

With no HTTP validators, change detection uses **application-level version fields** the
API already exposes:

| Signal | Field | Use |
|---|---|---|
| Sandbox lifecycle changed | `lifecycleVersion` (in `SandboxStatusResponse`) | skip UI reconciliation when unchanged between polls |
| Chat is streaming server-side | `isStreaming` / `activeStreamId` (chats list, chat snapshot) | drives the "server says streaming, my socket is idle" reconnect (`05-streaming-chat-engine.md`) |
| Session list changed | `lastActivityAt`, `hasStreaming`, `hasUnread` per `SessionSummary` | cheap diff before touching GRDB |
| Diff staleness | `cachedAt` + `isStale` on `/diff/cached` | staleness banner |
| Server clock skew | `lifecycle.serverTime` (epoch ms) | compute sandbox countdowns as `sandboxExpiresAt - serverTime` deltas applied to local monotonic time — never trust the device clock against server epochs |

Future server enhancement (tracked, not v1): emit `ETag` on `GET /api/sessions`,
`GET .../chats`, and the chat snapshot, and honor `If-None-Match` → `304`. The mobile
polling profile (1–3 s cadences over cellular) is the first consumer that would
materially benefit; file it as a backend issue once v1 polling telemetry
(`07-observability.md`) quantifies the payload waste.

### 5.4 Offline behavior summary

- Reads: every screen renders from GRDB first; network refresh updates in place.
  Sessions, chats, messages, cached diff, models, preferences are fully readable
  offline.
- Writes: **no offline mutation queue in v1.** Mutations require connectivity and fail
  fast with `.offline` plus a non-blocking banner; the composer preserves the drafted
  message text locally so nothing is lost (`01-product-and-ux.md`).
- Streaming: on connectivity regain, the resume flow re-attaches
  (`GET /api/chat/{chatId}/stream` full replay → idempotent chunk application).

---

## 6. Acceptance checklist for this workstream

- [ ] Batch A merged: `apps/web/openapi.json` has 0 `additionalProperties: false`, a
      populated `components.schemas`, `securitySchemes`, `format: date-time` on ISO
      timestamps, typed commit/PR/merge responses; `bun run --cwd apps/web openapi:check`
      and `bun --bun run ci` green.
- [ ] Batches B–F merged with contract tests; spec covers every generated-client
      endpoint in §1 (hand-rolled endpoints documented or explicitly excluded).
- [ ] `ios/Packages/OpenAgentsAPI` builds from the vendored spec with
      swift-openapi-generator 1.12.2; generated sources committed.
- [ ] `ios/scripts/check-openapi-client.sh` wired into iOS CI and passing.
- [ ] `NetworkingContainer` ships the two-session client stack with the five-middleware
      chain, `APIError` taxonomy, and environment picker; unit-tested per
      `06-testing-strategy.md` (mocked transport, error-mapping table tests, retry-policy
      tests with injected clock).
- [ ] BotID spike resolved (server exemption or verified pass-through) before chat send
      is enabled against production.
