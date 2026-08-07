# API Brief: Session Lifecycle, Sandbox, Files/Diff, Git/PR

Ground truth for the iOS plan, read from actual route code (June 2026, branch `feat/agents-phase6-authored-tools`). All paths relative to repo root `/Users/dennison/develop/open-agents`.

Scope: `apps/web/app/api/sessions/**` (excluding `chats/**`) and `apps/web/app/api/sandbox/**`, plus the libs they call and the web-client polling patterns.

---

## 0. Cross-cutting facts

### Auth
- Every route requires an authenticated better-auth session cookie. `getServerSession()` (`apps/web/lib/session/get-server-session.ts:17`) reads request headers, first checks a test-auth cookie (only honored when `OPEN_AGENTS_ENABLE_TEST_AUTH === "1"`, `apps/web/lib/session/test-auth.ts:9`), then `auth.api.getSession({ headers })` (better-auth, Vercel OAuth sign-in). **There is no bearer-token / API-key path — an iOS client must carry the better-auth session cookie** (or the deployment must add a token mechanism).
- Standard gate helpers in `apps/web/app/api/sessions/_lib/session-context.ts`:
  - `requireAuthenticatedUser()` → 401 `{error:"Not authenticated"}` (line 65).
  - `requireOwnedSession({userId,sessionId})` → 404 `{error:"Session not found"}` / 403 `{error:"Forbidden"}` (line 80).
  - `requireOwnedSessionWithSandboxGuard(...)` adds a sandbox-state predicate → default 400 `{error:"Sandbox not initialized"}`, customizable status (often 409) (line 106).
- Error shape everywhere: `{ "error": string }` with HTTP status. Git routes map thrown action errors via `gitErrorStatus()` (`apps/web/app/api/sessions/[sessionId]/git/_lib/git-errors.ts:7`): "Not authenticated"→401, "Forbidden"→403, "Session not found"→404, "Sandbox not initialized"→409, `Invalid *`→400, else 500.
- Several mutating routes also run Vercel BotID `checkBotProtection()` (403 `{error:"Access denied"}` if bot) and per-user rate limits (`checkRateLimit` returns a limiting Response — sessions-create 10/min, sandbox-create 20/min, sandbox-delete 10/min, sandbox-extend 3/min, generate-commit-message 10/min, fix-checks 5/min). **BotID may be a risk for a native client** — verify it passes non-browser traffic (`apps/web/lib/botid`).

### Partial OpenAPI contract exists
- `apps/web/lib/api/openapi-spec.ts:82` (`buildOpenApiDocument`) defines a typed OpenAPI 3.0.3 doc generated from the same Zod schemas the routes validate with — currently covering: `/api/settings/skills`, `git/status`, `git/branch`, `git/commit`, `git/pr` (GET+POST), `git/pr/merge`. Generated via `bun run --cwd apps/web openapi:generate` → `openapi.json` → `openapi-types.ts` (911 lines, openapi-typescript) and an `openapi-fetch` client (`lib/api/client.ts`). Extending this spec is the cheapest way to give iOS a typed contract.

### Sandbox model (key concept)
- `SandboxState` = `{ type:"vercel" } & VercelState` where `VercelState` = `{ source?, sandboxName?, sandboxId?(legacy), snapshotId?(legacy), expiresAt?(ms) }` (`packages/sandbox/factory.ts:13`, `packages/sandbox/vercel/state.ts:7`). Stored as jsonb on the session row.
- State predicates (`apps/web/lib/sandbox/utils.ts`):
  - `hasRuntimeSandboxState` = has `expiresAt` + resumable name → "a VM is (or was recently) running" (line 84).
  - `isSandboxActive` = runtime state AND `now < expiresAt - 10s buffer` (line 54).
  - `hasPausedSandboxState` = resumable name but no runtime `expiresAt` (line 47).
  - Persistent sandbox name = `session_<sessionId>` (`getSessionSandboxName`, line 26).
- Sandboxes are Vercel Sandbox Firecracker microVMs. Defaults (`apps/web/lib/sandbox/config.ts`): timeout 5h−30s (hobby: 40min−30s), 4 vCPUs (hobby 1), ports `[3000, 5173, 4321, 8000]` (8000 = code-server), working dir `/vercel/sandbox`, inactivity hibernate after 30 min, extend duration 20 min, expiry buffer 10 s.

### Sandbox lifecycle state machine
- `session.lifecycleState` enum: `provisioning | active | hibernating | hibernated | restoring | archived | failed` (`apps/web/lib/db/schema.ts:306`, `apps/web/lib/sandbox/lifecycle.ts:19`).
- A durable workflow ("lifecycle kick", `apps/web/lib/sandbox/lifecycle-kick.ts:99`) is started after create/extend/restore and on overdue status checks; it runs `evaluateSandboxLifecycle` (`lifecycle.ts:170`) which hibernates (stops) the VM when inactive past `hibernateAfter` or near `sandboxExpiresAt`, skipping if any chat in the session has an `activeStreamId`. Hibernation clears runtime state but keeps `sandboxName` for resume.
- `lifecycleVersion` (int) increments on each lifecycle-significant transition — clients can use it to detect state changes.

### Session DB row (what `GET /api/sessions/[id]` returns under `{session}`)
`apps/web/lib/db/schema.ts:257-343`. Fields: `id, userId, title, status("running"|"completed"|"failed"|"archived", default "running"), repoOwner, repoName, branch, cloneUrl, vercelProjectId/Name/TeamId/TeamSlug, isNewBranch, autoCommitPushOverride(bool|null), autoCreatePrOverride(bool|null), globalSkillRefs(json[]), sandboxState(jsonb SandboxState|null), runtimeMode("classic"|"managed_runtime", default "classic"), managedRuntimeProfileId(default "web-bun-agent-browser"), inferenceProfileId, lifecycleState, lifecycleVersion, lastActivityAt, sandboxExpiresAt, hibernateAfter, lifecycleRunId, lifecycleError, linesAdded, linesRemoved, prNumber, prStatus("open"|"merged"|"closed"|null), snapshotUrl, snapshotCreatedAt, snapshotSizeBytes, cachedDiff(jsonb), cachedDiffUpdatedAt, createdAt, updatedAt`. Timestamps serialize as ISO strings through `Response.json`.

---

## 1. Session CRUD — `/api/sessions`

### GET /api/sessions (`apps/web/app/api/sessions/route.ts:92`)
- Query: `status` = `all`(default) | `active` | `archived` (else 400 `Invalid status filter`); for `archived`: `limit` (1..100, default 50) and `offset` (default 0), 400 on non-numeric.
- 200 responses:
  - all: `{ sessions: SessionWithUnread[] }`
  - active: `{ sessions, archivedCount }`
  - archived: `{ sessions, archivedCount, pagination: { limit, offset, hasMore, nextOffset } }`
- `SessionWithUnread` (list item, NOT full row — `apps/web/lib/db/sessions.ts:214-266`, client type `apps/web/hooks/use-sessions.ts:10`): `id, title, status, repoOwner, repoName, branch, linesAdded, linesRemoved, prNumber, prStatus, createdAt, lastActivityAt (max chat updatedAt), hasUnread (per-user chat-read tracking), hasStreaming (any chat has activeStreamId), latestChatId`.
- Web polling: SWR with dynamic `refreshInterval` — **3 s while any session `hasStreaming`, otherwise 30 s** (`use-sessions.ts:108-117`).

### POST /api/sessions (`route.ts:171`)
- Auth + BotID + rate limit 10/min.
- Body (manually validated, no Zod — `CreateSessionRequest`, line 34): `{ title?, repoOwner?, repoName?, branch?, cloneUrl?, isNewBranch?, sandboxType?("vercel" only), managedRuntimeProfileId?, autoCommitPush?, autoCreatePr?, vercelProject?: {projectId,projectName,teamId?,teamSlug?}|null }`.
- Validation 400s: invalid sandbox type / managed runtime profile / autoCommitPush / autoCreatePr / repo owner / repo name / clone URL (must be GitHub HTTPS URL matching owner+name) / Vercel project. 403 if a Vercel project is selected but no/invalid Vercel token (`Connect Vercel...` / `Reconnect Vercel...`).
- Behavior:
  - Title defaults to a random unused city name (`resolveSessionTitle`, line 64).
  - `isNewBranch: true` → server generates branch `"<initials>/<8-hex>"` from user name/username (line 48); client-passed `branch` is ignored in that case.
  - `autoCommitPush`/`autoCreatePr` default from user preferences; `autoCreatePrOverride` is forced `false` unless autoCommitPush is effective (line 384-387).
  - **Lazy sandbox provisioning**: the route only writes DB rows. Repo-backed sessions get `sandboxState: { type: sandboxType }` + `lifecycleState: "provisioning"`; no-repo ("New Chat") sessions get `sandboxState: null, lifecycleState: null` (line 392-396). **The actual VM is created later by the client calling `POST /api/sandbox`** (see §3) — web does this from `apps/web/app/sessions/[sessionId]/chats/[chatId]/sandbox-create.ts:95`.
  - Also creates an initial chat (`createSessionWithInitialChat` is a single transaction, `lib/db/sessions.ts:79`) with the user's default model/inference profile/Composio selection.
- 200: `{ session: Session, chat: Chat }` (full rows). 500 `Failed to create session` on error.

### GET /api/sessions/[sessionId] (`[sessionId]/route.ts:26`)
- 200 `{ session: <full session row> }`; 401/403/404.

### PATCH /api/sessions/[sessionId] (`[sessionId]/route.ts:49`)
- Body (`UpdateSessionRequest`, line 14): `{ title?, status?("running"|"completed"|"failed"|"archived"), runtimeMode?("classic"|"managed_runtime"), managedRuntimeProfileId?, inferenceProfileId?(string|null), linesAdded?, linesRemoved?, prNumber?, prStatus? }`.
- 400 on invalid runtimeMode / managed-runtime profile (must be built-in id or a saved session profile) / inference profile (must exist + enabled for user).
- **Archive**: `status:"archived"` when not already archived → runs `archiveSession()` (`apps/web/lib/sandbox/archive-session.ts:204`): refreshes git stats, sets `status+lifecycleState=archived`, nulls expiry timers, then stops the sandbox in background via `next/server after()`.
- **Unarchive**: `status:"running"` while archived → 409 `"Sandbox is still being paused..."` if runtime state exists but no snapshot yet; otherwise resets `lifecycleState/lifecycleError` to null.
- 200 `{ session: <updated row> }`.

### DELETE /api/sessions/[sessionId] (`[sessionId]/route.ts:178`)
- Hard-deletes the row (cascades chats etc.). 200 `{ success: true }`. Note: does NOT stop a running sandbox VM explicitly.

---

## 2. Sandbox lifecycle — `/api/sandbox/*` (sessionId passed in body/query, not path)

### POST /api/sandbox — create/resume VM (`apps/web/app/api/sandbox/route.ts:97`)
- Body: `{ repoUrl?, branch? (default "main"), isNewBranch? (default false), sessionId (required), sandboxType? ("vercel") }`.
- Gates: 400 missing sessionId/invalid JSON/invalid type/invalid GitHub URL; 401; BotID 403; rate limit 20/min; ownership 403/404; 403 `getRepoAccessErrorMessage(...)` when GitHub repo access check fails.
- Behavior: verifies repo access (user ∩ GitHub App installation), mints a repo-scoped read-only installation token for clone, connects/creates the persistent named sandbox `session_<id>` (resume + createIfMissing), configures git user (GitHub noreply email), persists fresh `sandboxState` (with `expiresAt`), installs global + user skills, kicks lifecycle workflow.
- **Long-running** (VM boot + clone can take tens of seconds; the web client calls it once after session creation and on resume-from-nothing). 200: `{ createdAt:number, timeout:number(ms), currentBranch?:string, mode:"vercel", timing:{readyMs:number} }`.

### DELETE /api/sandbox — stop VM (`route.ts:300`)
- Body `{ sessionId }`. Idempotent: if nothing operable, 200 `{ success:true, alreadyStopped:true }`. Otherwise stops VM, clears runtime state (keeping `sandboxName`), sets lifecycle `hibernated` (or `provisioning` if nothing resumable). 200 `{ success:true }`.

### GET /api/sandbox/status?sessionId= (`status/route.ts:30`)
- **Cheap DB-only check (no VM connection)** — this is the polling endpoint.
- 200 `SandboxStatusResponse` (exported type, line 17): `{ status:"active"|"no_sandbox", hasSnapshot:boolean, lifecycleVersion:number, lifecycle:{ serverTime:number(ms), state:string|null, lastActivityAt:number|null, hibernateAfter:number|null, sandboxExpiresAt:number|null } }`.
- Side effects: recovers `failed`→`active` lifecycle when runtime is actually live; kicks lifecycle workflow when overdue.
- Web client throttles calls to ≥5 s apart (`session-chat-context.tsx:553-563`, `THROTTLE_MS = 5_000`).

### GET /api/sandbox/reconnect?sessionId= (`reconnect/route.ts:58`)
- **Expensive probe**: connects to the VM and runs `pwd` (15 s timeout). Called on page entry / focus to verify the persisted runtime state is real.
- 200 `ReconnectResponse` (line 26): `{ status:"connected"|"expired"|"not_found"|"no_sandbox", hasSnapshot:boolean, expiresAt?:number(ms, only when connected), lifecycle:{...same shape as status} }`.
- On unavailable errors (404/410/"sandbox is stopped"...) clears runtime state, sets lifecycle `hibernated`, returns `status:"expired"` with `hasSnapshot` indicating resumability. Transient errors return `"connected"` with stale-guarded `expiresAt`.
- Web client flow (`session-chat-context.tsx:483-551`): on `connected` computes `timeout = expiresAt - now`; on `no_sandbox`/`expired` clears local sandbox info and shows Resume (if `hasSnapshot`) or Create.

### POST /api/sandbox/extend (`extend/route.ts:21`)
- Body `{ sessionId }`. Rate limit **3/min**. Guard `isSandboxActive` (else 400 `Sandbox not initialized`). Extends VM timeout by 20 min, persists new `expiresAt`, kicks lifecycle. 200 `{ success:true, expiresAt:number, extendedBy:1200000 }`. 500 on failure.

### POST /api/sandbox/snapshot — "pause" (`snapshot/route.ts:41`)
- Body `{ sessionId }`. Guard `canOperateOnSandbox`. Stops VM, clears runtime state (keeps `sandboxName`), lifecycle `hibernated`. 200 `{ snapshotId: string|null (sandboxName or legacy snapshotUrl), createdAt:number }`. 500 `Failed to pause sandbox: <msg>`.

### PUT /api/sandbox/snapshot — "resume" (`snapshot/route.ts:109`)
- Body `{ sessionId }`. Resumes the named persistent sandbox (`resume:true`), falling back to legacy snapshot restore (`createIfMissing:true`). If already running: 200 `{ success:true, alreadyRunning:true, restoredFrom }`. No resumable state: 404 `No sandbox available for resume`. Sandbox gone: 404 `Saved sandbox is no longer available. Create a new sandbox.` (also wipes resume handle). Success: 200 `{ success:true, restoredFrom, sandboxId? }` + lifecycle set active + workflow kicked. **Long-running** (VM resume).

### POST /api/sandbox/activity (`activity/route.ts:18`)
- Body `{ sessionId }`. Refreshes `lastActivityAt` + `hibernateAfter` (now + 30 min) **only when lifecycleState === "active"**; otherwise 200 `{ success:false, reason:"not-active" }`. Web fires it when the user focuses the chat textarea (`session-chat-content.tsx:1448`). 200 `{ success:true }`.

### POST /api/sessions/[sessionId]/sandbox (`[sessionId]/sandbox/route.ts:20`)
- On-demand sandbox attach for no-repo sessions. Idempotent: if `sandboxState !== null` returns `{ session }` unchanged. Otherwise sets `sandboxState:{type:"vercel"}`, `lifecycleState:"provisioning"`, bumps `lifecycleVersion`, emits `session.sandbox.attached` observability event. 200 `{ session }`. **Client must still call `POST /api/sandbox` afterwards to create the VM** (comment lines 16-18).

---

## 3. Files & diff

### GET /api/sessions/[sessionId]/files (`files/route.ts:119`)
- Guard `hasRuntimeSandboxState` (400 `Sandbox not initialized`). Runs `git ls-files` + untracked, builds deduped file+directory suggestions sorted shallow-first, capped at 5000.
- 200 `FilesResponse = { files: { value:string, display:string, isDirectory:boolean }[] }` (directories end with `/`).
- 409 `Sandbox is unavailable. Please resume sandbox.` when VM probe errors indicate it's gone (this **clears runtime state + hibernates** — standard pattern repeated across files/diff/skills routes). 400 if not a git repo; 500 connect failures.

### GET /api/sessions/[sessionId]/files/content?path= (`files/content/route.ts:60`)
- Path is normalized/validated (no absolute, no `..`, no NUL) else 400 `Invalid file path`. Reads from sandbox working dir.
- 400 directory/non-regular/binary (NUL byte); 413 `File is too large to preview` (> 200,000 bytes); 404 `File not found`; 409 sandbox-unavailable. 200 `WorkspaceFileContentResponse = { path, content, size }` with `Cache-Control: no-store`.

### GET /api/sessions/[sessionId]/diff (`diff/route.ts:25`)
- Guard `hasRuntimeSandboxState`. Computes diff against best base (origin default branch or HEAD) and **caches it on the session row** (`computeAndCacheDiff`).
- 200 `DiffResponse` (`apps/web/lib/diff/compute-diff.ts:29`): `{ files: DiffFile[], summary:{totalFiles,totalAdditions,totalDeletions}, baseRef? }`; `DiffFile` (line 14) = `{ path, status:"added"|"modified"|"deleted"|"renamed", stagingStatus?:"staged"|"unstaged"|"partial", additions, deletions, diff:string, localDiff?:string, oldPath?:string, generated?:boolean }` (generated/lock files have diff content omitted).
- 409 sandbox-unavailable; `DiffComputationError` maps to its own status; 500 otherwise.
- Web: SWR keyed only when sandbox connected, no auto-refresh interval; manual refresh (`apps/web/hooks/use-session-diff.ts:40`). When disconnected the client switches to /diff/cached.

### GET /api/sessions/[sessionId]/diff/cached (`diff/cached/route.ts:17`)
- DB-only. 404 `No cached diff available` if none. 200 `CachedDiffResponse = { data: DiffResponse, cachedAt: ISOstring, isStale: true }`. Works offline/hibernated — important for iOS offline diff view.

### GET /api/sessions/[sessionId]/diff/patch (`diff/patch/route.ts:27`)
- Returns a downloadable unified diff file built from live git state. 200 body = raw `text/x-diff; charset=utf-8` with `Content-Disposition: attachment; filename="..."`. 409 sandbox-unavailable; `DownloadDiffError` custom status; 500.

---

## 4. Git & PR — `/api/sessions/[sessionId]/git/*`

All use `requireGitSession` (401/403/404 before work) and `mapGitActionError` (§0). Zod request schemas in `apps/web/lib/git/http-schemas.ts`. These HTTP routes are a deliberate mirror of the Next server actions (`lib/git/**`, `lib/github/**`) "so the same backend logic is reachable — and black-box testable — over HTTP" (http-schemas.ts:4-10) — the web UI itself mostly calls the server actions directly (`git-panel.tsx:27-39`), so **the HTTP routes are exactly the surface an iOS app should use**.

### GET git/status (`git/status/route.ts:5`)
- 200 `{ status: SessionGitStatus | null }` — `SessionGitStatus` (`apps/web/lib/git/queries/status.ts:11`): `{ branch, isDetachedHead, hasUncommittedChanges, hasUnpushedCommits, stagedCount, unstagedCount, untrackedCount, uncommittedFiles }`. Returns `null` inside 200 on internal git errors (action catches and returns null). 409 if `isSandboxActive` is false.

### POST git/branch (`git/branch/route.ts:11`)
- Body `createBranchRequestSchema`: `{ sessionTitle:string, baseBranch:string(min 1), branchName:string(min 1) }`. 200 `{ branchName }` (`lib/git/actions/branch.ts:16`).

### POST git/commit (`git/commit/route.ts:11`)
- Body `commitChangesRequestSchema`: `{ sessionTitle, baseBranch, branchName, commitTitle?, commitBody? }`.
- 200 `CommitResult` (`lib/github/actions/commit.ts:89`): `{ committed:boolean, pushed:boolean, branchName?, commitMessage?, commitSha?, error? }`. NOTE: the action returns errors *inside the 200 payload* (`error` field) for auth/ownership/sandbox problems rather than throwing — client must check `result.error`. Commits are created as **verified commits via the GitHub API**; if on base branch or detached HEAD a new branch is auto-generated. **Long-running** (push + API).

### POST git/discard (`git/discard/route.ts:11`)
- Body `discardChangesRequestSchema`: `{ filePath?, oldPath? }` (empty body = discard all; `oldPath` for renames; `filePath` required when `oldPath` given — `lib/git/actions/discard.ts:129`). 200 `{ discarded:boolean, hasUncommittedChanges:boolean }`.

### GET git/pr (`git/pr/route.ts:12`)
- 200 `{ branch:string|null, prNumber:number|null, prStatus:"open"|"merged"|"closed"|null }` (`lib/github/queries/pr.ts:109`). When sandbox inactive it answers from the DB row instead of erroring.

### POST git/pr (`git/pr/route.ts:27`)
- Body `openPullRequestRequestSchema`: `{ repoUrl, branchName?, title, body?, baseBranch, headOwner?, isDraft?, shouldAutoMerge? }`.
- 200 (`lib/github/actions/pr.ts:243`): `{ success:boolean, prUrl?, prNumber?, prStatus?, requiresManualCreation?, autoMergeEnabled?, autoMergeError?, error? }`. `requiresManualCreation` + a GitHub compare URL is returned when the API can't open the PR (e.g. permissions). Updates `session.prNumber/prStatus`.

### POST git/pr/generate (`git/pr/generate/route.ts:11`)
- Body `generatePrContentRequestSchema`: `{ sessionTitle, baseBranch, branchName }`. LLM-generates PR title/body from the diff. 200 `GeneratePrContentResult = { title?, body?, branchName?, error? }`. **Long-running** (LLM call).

### POST git/pr/merge (`git/pr/merge/route.ts:11`)
- Body `mergePrRequestSchema`: `{ mergeMethod?("merge"|"squash"|"rebase"), commitTitle?, commitMessage?, deleteBranch?, expectedHeadSha?, force? }` (empty body OK).
- 200 `MergePullRequestResult = { merged:boolean, prNumber:number, mergeCommitSha:string|null, branchDeleted:boolean, branchDeleteError:string|null }` (`pr.ts:30`).
- Behaviors (`pr.ts:461-580`): idempotent if already merged; throws `Pull request is closed`; optimistic-concurrency via `expectedHeadSha` (throws `Pull request has new commits. Refresh and review before merging.`); `force` can bypass ONLY check-failure reasons, never reviews/conflicts; requires user GitHub token with write access.

### POST git/pr/close (`git/pr/close/route.ts:5`)
- No body. 200 `ClosePullRequestResult = { closed:boolean, prNumber:number }`.

### GET git/pr/readiness (`git/pr/readiness/route.ts:5`)
- 200 `MergeReadinessResponse` (`lib/github/queries/pr.ts:24`): `{ canMerge:boolean, reasons:string[], pr:{ number, repo, title, body, baseBranch, headBranch, headSha, additions, deletions, changedFiles, commits }|null, allowedMethods:MergeMethod[], defaultMethod:MergeMethod("squash"), checks:{ requiredTotal, passed, pending, failed }, checkRuns:CheckRun[] }`.
- **This is where CI check runs come from** — there is NO standalone `GET .../checks` route (only `checks/fix` exists; verified by file listing). Web polls readiness every **5 s** while the PR dialog is open and checks are pending (`MERGE_READINESS_POLL_INTERVAL_MS = 5_000`, max 6 transient polls — `apps/web/lib/merge-readiness-polling.ts:8-9`).

### GET git/deployment-url?prNumber=&branch= (`git/deployment-url/route.ts:10`)
- Query `deploymentUrlQuerySchema` (both optional; prNumber positive int). 200 `PrDeploymentResponse = { deploymentUrl:string|null, buildingDeploymentUrl?:string|null, failedDeploymentUrl?:string|null }` (`lib/github/queries/deployment.ts:16`). Resolves the Vercel preview deployment for the session's PR/branch.

### POST /api/sessions/[sessionId]/generate-commit-message (`generate-commit-message/route.ts:11`)
- No body. Rate limit 10/min, BotID. 400 `No active sandbox` if `isSandboxActive` false. Runs `git diff HEAD`, asks claude-haiku-4.5 for a conventional-commit one-liner (≤72 chars). Always 200 `{ message:string }` (falls back to `"chore: update repository changes"`). `maxDuration = 30`.

### POST /api/sessions/[sessionId]/checks/fix (`checks/fix/route.ts:188`)
- Body `{ checkRuns: CheckRun[] }` (the failing runs from readiness; max 10 → 400 `Too many check runs (max 10)`); 400 if session has no linked repo / empty list. Rate limit 5/min.
- For each run with a real id: fetches GitHub check annotations + raw job logs (user's GitHub token), compacts logs via haiku LLM (input cap 180k chars).
- 200 `FixChecksResponse = { prompt:string, snippets:{filename,content}[] }` — designed to be pasted into a chat message as attachments. **Long-running** (LLM + log downloads).

---

## 5. Dev server, code editor, services, browser runs

### /api/sessions/[sessionId]/dev-server (`dev-server/route.ts`)
- All verbs guard `isSandboxActive` with 409 `"Resume the sandbox before running a dev server"`.
- **POST** (line 798): auto-detects the best `package.json` with a `dev` script (framework heuristics: next/vite/astro/react-scripts/remix/nuxt; only ports 3000/5173/4321/8000 supported), installs deps if needed, launches detached with pidfile, persists target choice in sandbox file. 200 `DevServerLaunchResponse = { packagePath, port, url, logPath }` (url is the public sandbox preview domain). 404 `No supported dev script found in package.json files`; 500 with message. Reuses an already-running server idempotently. **Long-running** (install + boot).
- **GET ?lines=** (line 914): tails the dev-server log. 200 = raw `text/plain` body with headers `X-Open-Agents-Log-Lines`, `X-Open-Agents-Log-Truncated`. 404 `No dev server log is available`.
- **DELETE** (line 968): stops it. 200 `DevServerStopResponse = { stopped:boolean, packagePath, port }`.

### /api/sessions/[sessionId]/code-editor (`code-editor/route.ts`)
- code-server (VS Code web) on port 8000, `--auth none`. Guard `isSandboxActive` → 409 `"Resume the sandbox before opening the editor"`.
- **GET** (line 220): 200 `CodeEditorStatusResponse = { running:boolean, url:string|null, port:8000 }`.
- **POST** (line 255): launches (mkdir lock; 409 `Code editor is already launching` / `Port 8000 is already in use by another process`). 200 `CodeEditorLaunchResponse = { url, port }`. The URL is a public `sandbox.domain(port)` preview URL — embeddable in a WKWebView.
- **DELETE** (line 350): 200 `CodeEditorStopResponse = { stopped:boolean }`.

### /api/sessions/[sessionId]/sandbox-services (managed runtime only)
- **GET** (`sandbox-services/route.ts:63`): 200 `{ services: ManagedServiceResponse[] }`; returns `{services:[]}` for classic sessions. `ManagedServiceResponse` (`lib/sandbox/runtime/service-launch.ts:25`): `{ id, kind, status, packagePath, port, url:string|null, logPath:string|null, lastHealthStatus:number|null, failureMessage:string|null }`.
- **POST** (line 88): starts the managed dev server; 409 if runtimeMode ≠ managed_runtime or sandbox not active; 500 + `{error, service}` when service status is `failed`; 200 `{ service }`.
- **DELETE .../sandbox-services/[serviceId]** (`[serviceId]/route.ts:14`): 200 `{ service }`, 404 `Service not found`.
- **GET .../sandbox-services/[serviceId]/logs?lines=** (`[serviceId]/logs/route.ts:25`): raw text/plain + `X-Open-Agents-Log-*` headers; 404; 409 patterns as above.

### /api/sessions/[sessionId]/browser-runs (`browser-runs/route.ts`)
- Managed-runtime browser QA checks. **GET** (line 28): 200 `{ runs: BrowserRunResponse[] }` (empty for classic). **POST** (line 52): body `{ serviceId?, targetUrl?, chatId? }` (targetUrl falls back to the service URL; 400 `Missing target URL`; 404 service). 200 `{ run }`. `BrowserRunResponse` (`lib/sandbox/runtime/browser-runs.ts:21`): `{ id, status, targetUrl, summary:string|null, consoleErrors, networkErrors, steps, artifactRefs, redactionStatus }`. **Long-running** (drives a real browser in the sandbox).

---

## 6. Observability, skills, share

### GET /api/sessions/[sessionId]/observability?chatId=&limit= (`observability/route.ts:35`)
- `limit` bounded 1..500, default 150. 200: `{ runtimeMode, events: SessionEventSnapshot[], profileRuns, workflowRuns (with ISO date strings), workers, directToolUse, services, browserRuns, workflowGoals: [{id,objective,status,blockedReason,evidenceRefs,createdAt,updatedAt,events:[...]}] }`. Managed-runtime-only arrays come back empty for classic. Goal-ledger failures degrade to `workflowGoals: []`.
- Web polls this **every 5 s** via SWR while the observability panel is open (`hooks/use-session-observability.ts:181`).

### GET /api/sessions/[sessionId]/skills?refresh=1 (`skills/route.ts:41`)
- Lists agent skills discovered in the sandbox (for slash-command suggestions). Serves a session cache unless `refresh=1`; cache works even when sandbox paused. 400 `Sandbox not initialized` (no sandboxState, or cache miss without runtime state); 409 unavailable-pattern; 200 `SkillsResponse = { skills: { name, description }[] }`.

### /api/sessions/[sessionId]/share (`share/route.ts`)
- **Deprecated**: POST and DELETE both return **410** `{error:"Session-level sharing is deprecated. Use /api/sessions/:sessionId/chats/:chatId/share."}`. iOS should use the chat-scoped share endpoint (covered by the chats brief).

---

## 7. Managed-runtime subtree — `/api/sessions/[sessionId]/managed-runtime/*`

### GET managed-runtime/profiles (`profiles/route.ts:34`)
- 200 `ManagedRuntimeProfilesResponse = { profiles: ManagedRuntimeProfileOption[] }`; option (line 15) = `{ id, version, displayName, description, setupCommandCount, verificationCommandCount, expectedTools[], optionalTools[], defaultPorts[], source:"built_in"|"session", testStatus?("untested"|"passed"|"failed"), testedAt?:string|null }`. Session-saved profiles listed before built-ins.

### profiles/[profileId] (`profiles/[profileId]/route.ts`)
- **GET** (line 57): 200 `ManagedRuntimeProfileDetailResponse = { profile (full: setup/verification commands etc.), testEvidence?:{status,testFailureMessage,testResults,testedAt}, sourceDraft? }`; 404 `Profile not found` (built-ins are not fetchable here — saved session profiles only).
- **PATCH** (line 90): body `updateProfileSchema` (line 27): `{ displayName, description, setupCommands[≥1: {id,label,description,command,timeoutMs?,required?}], verificationCommands[≥1], expectedTools[], optionalTools[], defaultPorts[] }`. 400 `Invalid managed runtime profile`; 200 detail response.
- **DELETE** (line 139): 200 `{ deletedProfileId, fallbackProfileId:"web-bun-agent-browser" }` (sessions using it fall back to the default profile).

### POST profiles/[profileId]/test (`profiles/[profileId]/test/route.ts`)
- Body optional `{ mode:"verify"|"setup_and_verify" }` (default verify). Guard `hasRuntimeSandboxState` (400 message "Resume the sandbox before testing..."). Runs the profile's commands in the live sandbox (default per-command timeout 120 s), records pass/fail observations. **Long-running.** Response mirrors the draft test below (profile + evidence). 409 sandbox-unavailable pattern.

### managed-runtime/profile-drafts (`profile-drafts/route.ts`)
- Drafts are created by the agent's `setupManagedRuntimeProfile` tool and reviewed by the user.
- **GET ?chatId=&limit=** (line 32): 200 `{ drafts: DraftSnapshot[] }`.
- **POST** (line 66): body `{ chatId?, toolCallId, input: setupManagedRuntimeProfileInputSchema }`; 400 `Invalid managed runtime profile draft`; 200 `{ draft }`.

### profile-drafts/[draftId] (`profile-drafts/[draftId]/route.ts`)
- **GET** (line 18): 200 `{ draft }`; 404 `Profile draft not found`.
- **PATCH** (line 48): body `{ output: setupManagedRuntimeProfileOutputSchema }` (a decision). If `decision === "approved"` the draft is applied as a saved session profile → 200 `{ draft, savedProfileId, appliedToSessionId }`; otherwise 200 `{ draft }`.

### POST profile-drafts/[draftId]/test (`profile-drafts/[draftId]/test/route.ts:48`)
- Body optional `{ mode }` as above. Marks draft `testing`, executes commands, finishes with status `tested` or `needs_changes` + `testResults` (command observations) + `testFailureMessage`. 200 `{ draft }`; 404; 409 sandbox-unavailable; 500 `{ draft?, error:"Failed to test managed runtime profile draft" }`. **Long-running** (runs real setup/verify commands).

---

## 8. Long-running vs instant + web polling summary (for iOS architecture)

| Category | Endpoints | Notes |
|---|---|---|
| Instant (DB-only) | sessions CRUD, sandbox/status, sandbox/activity, diff/cached, observability, profiles list/detail/draft CRUD, git/pr GET (when paused) | Safe to call frequently |
| VM-touching, fast (~1-15 s) | reconnect (probe), files, files/content, diff, diff/patch, git/status, skills, code-editor GET, sandbox-services GET/logs | Need spinner; 409 means "resume sandbox" |
| Long-running (10 s – minutes) | POST /api/sandbox (boot+clone), PUT snapshot (resume), git/commit, git/pr POST, pr/generate, pr/merge, checks/fix, dev-server POST, browser-runs POST, profile tests, generate-commit-message | One-shot request/response — **no SSE/job-polling on these**; the HTTP request itself stays open. iOS needs generous URLSession timeouts & background-safe handling |
| Web polling cadence | sessions list 3 s (streaming) / 30 s; sandbox status throttled ≥5 s on demand; observability 5 s; merge readiness 5 s while pending; activity ping on input focus | Mirror these in iOS |

Sandbox-unavailable contract: any VM-touching route may return **409 `{error:"Sandbox is unavailable. Please resume sandbox."}`** and atomically flips the session to `hibernated` — the client should then offer Resume (`PUT /api/sandbox/snapshot`) and re-fetch.

Session resume decision tree used by web (`session-chat-context.tsx`): on open → `GET /api/sandbox/reconnect`; `connected` → use it; `expired`/`no_sandbox` + `hasSnapshot` → show Resume → `PUT /api/sandbox/snapshot`; no snapshot → create new VM via `POST /api/sandbox` (repo info from the session row: `cloneUrl`, `branch`, `isNewBranch`).

---

## 9. Gotchas / uncertainty

- **BotID**: `checkBotProtection()` on session create, sandbox create/delete/extend, generate-commit-message. Unverified how Vercel BotID treats native-app requests (no browser JS challenge); could block iOS clients — needs a spike.
- **Cookie auth only**: better-auth session cookie; no PAT/bearer support today. CSRF posture of better-auth for non-browser clients not investigated here.
- `commitChanges` returns auth/ownership errors in a 200 body (`error` field) rather than HTTP error codes — inconsistent with the rest.
- `git/status` can return `{status: null}` with 200 on internal errors.
- The `checks` GET route mentioned in older docs does not exist; check runs ship inside `git/pr/readiness`.
- `DELETE /api/sessions/[id]` does not stop a live sandbox VM (only archive does); orphaned VMs rely on Vercel timeout.
- Hobby vs Pro resource profile changes sandbox timeout (40 min vs 5 h) and vCPUs — iOS countdown UI must use server-reported `expiresAt`, never assume.
- Web client uses Next **server actions** for git operations; the HTTP git routes are a parallel surface that is contract-tested but less battle-tested in production UI flows.
- Auto-commit/auto-PR (`autoCommitPushOverride`, `autoCreatePrOverride`) are applied by chat-finish logic (`apps/web/lib/chat-auto-commit.ts`, calls `/api/github/branches`, `/api/generate-pr`, `/api/sessions/{id}/diff`) — the chats agent's brief covers that flow; from this surface they are just booleans set at session create / read on the row.
