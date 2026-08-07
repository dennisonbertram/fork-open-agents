# Web Client Consumption Patterns — Reference Implementation for the iOS App

Scope: how `apps/web` (Next.js client) consumes the backend. This is the behavioral spec an iOS app must mirror: data fetching, chat streaming via AI SDK, polling cadences, optimistic updates, error handling, attachments, and the full catalog of message-part renderers.

All paths relative to repo root `/Users/dennison/develop/open-agents` unless absolute.

---

## 1. Data-fetching stack

- **SWR v2** (`swr": "^2.3.8"`, `apps/web/package.json:76`) for all REST reads. No react-query.
- **AI SDK v6** (`ai ^6.0.165`) + **`@ai-sdk/react` v3** (`^3.0.167`) for chat streaming (root `package.json` catalog).
- **Plain `fetch`** for all mutations (POST/PATCH/DELETE), followed by manual SWR cache `mutate(...)` calls — there is no mutation library.
- **Next.js Server Actions** ("use server") are used as SWR fetchers / imperative calls in a handful of git/GitHub flows (see §9) — these are NOT plain REST endpoints and have no JSON URL an iOS app can call.

### Shared fetcher & error standard (`apps/web/lib/swr.ts`)
- `fetcher<T>(url)` — GET, parse JSON; on non-OK, parse `{ error?: string }` body and throw `FetchError(message, status)` (`lib/swr.ts:5-35`). **Every API error body convention is `{ error: string }`.**
- `fetcherNoStore<T>(url)` — same with `cache: "no-store"`; used for hydration-sensitive endpoints (chats list, observability, GitHub connection status) where stale browser HTTP cache could overwrite fresher SSR state (`lib/swr.ts:41-42`).
- Documented revalidateOnFocus guidelines at `lib/swr.ts:45-50`:
  - auth/session data: `revalidateOnFocus: true`
  - GitHub data (branches/repos/models): default (true)
  - session diff/files: `revalidateOnFocus: false` (requires sandbox connection; avoid spurious errors)

### Global SWR config (`apps/web/app/providers.tsx:60-150`)
- `<SWRConfig value={{ onError: handleError }}>` wraps the app. Handler at `providers.tsx:109-131`: if error is `FetchError` with `status === 401` **and** message `"Not authenticated"` → `authClient.signOut()` (better-auth) then `router.replace("/")`. This is the app-wide session-expiry behavior the iOS app must reproduce (sign out + return to login on 401).
- `<Toaster theme={resolvedTheme} />` (sonner) mounted once here; theme is light/dark/system stored in `localStorage["open-agents-theme"]`.

### Auth state consumer
- `useSession()` (`apps/web/hooks/use-session.ts`) → `useSWR<SessionUserInfo>("/api/auth/info", fetcher, { revalidateOnFocus: true })`. Exposes `isAuthenticated` (`!!data?.user`), `isAdmin`, `hasGitHub`, `hasGitHubAccount`, `hasGitHubInstallations`.
- Auth client is better-auth React client: `apps/web/lib/auth/client.ts` (`createAuthClient` + `inferAdditionalFields`). Sign-out is `authClient.signOut()`.
- GitHub connection health: `useGitHubConnectionStatus` (`hooks/use-github-connection-status.ts`) → `/api/github/connection-status` with `fetcherNoStore`, `dedupingInterval: 30_000`, only when authenticated && hasGitHub. `status === "reconnect_required"` drives a global `GitHubReconnectGate` dialog (mounted in providers.tsx:143).

### Bot protection (matters for any non-browser client)
`apps/web/instrumentation-client.ts` registers Vercel BotID client protection for: `POST /api/chat`, `/api/generate-pr`, `/api/generate-title`, `/api/sessions/*/generate-commit-message`, `/api/sandbox`, `/api/sessions`, `/api/transcribe`. The web client transparently attaches challenge headers via `initBotId`. **An iOS client has no BotID — server-side `checkBotId()` handling for native clients is an open question.**

---

## 2. Chat: useChat configuration (the core of the app)

The single `useChat` call lives in `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-session-chat-runtime.ts`.

### Transport (`use-session-chat-runtime.ts:113-136`)
```ts
new AbortableChatTransport({
  api: "/api/chat",
  body: () => ({ sessionId, chatId, ...(contextLimit !== null ? { context: { contextLimit } } : {}) }),
  prepareReconnectToStreamRequest: ({ id }) => ({ api: `/api/chat/${id}/stream` }),
})
```
- POST `/api/chat` body = AI SDK default fields (id, messages/trigger) **plus** `sessionId`, `chatId`, optional `context.contextLimit` (the selected model's context window, resolved client-side from model options — `session-chat-context.tsx:101-111`).
- Stream resume: GET `/api/chat/{chatId}/stream` — returns **204 when no active stream** (cheap no-op), **200 + UI-message-stream bytes** when live (`use-session-chat-runtime.ts:296-334` comments).
- `AbortableChatTransport` (`apps/web/lib/abortable-chat-transport.ts`) extends `DefaultChatTransport`, wraps every fetch with a transport-level `AbortController` (combined with `AbortSignal.any`) because the AI SDK's `reconnectToStream` does not propagate abort signals. `abort()` kills all in-flight fetches then immediately re-arms a fresh controller.

### Chat instance management (`apps/web/lib/chat-instance-manager.ts`)
- A module-level `Map<chatId, Chat<WebAgentUIMessage>>` keeps the AI SDK `Chat` instance alive across re-renders within a route; `getOrCreateChatInstance` returns `{ instance, alreadyExisted }`. Removed on route unmount via `cleanupChatRouteOnUnmount(chatId)` (`apps/web/lib/chat-route-cleanup.ts`) which aborts transport + removes instance + clears workspace status, but **deliberately does not send a server stop** — generation continues in background when the user navigates away.

### useChat options (`use-session-chat-runtime.ts:138-196`)
- `onData`: handles `data-workspace-status` transient parts → writes to an external `useSyncExternalStore`-based store (`apps/web/lib/workspace-status-store.ts`) keyed by chatId. This renders the "setting up workspace" banner (`WebAgentWorkspaceStatusData = { status: "setting-up", message, title?, logLines?, logUpdatedAt? }`, `app/types.ts:67-73`). Cleared when status becomes ready/error/submitted or first assistant part arrives (`use-session-chat-runtime.ts:253-274`).
- `sendAutomaticallyWhen: shouldAutoSubmit` (custom, `use-session-chat-runtime.ts:57-90`): auto-submits the next request after tool results when ALL non-provider-executed tool parts in the **last step** are terminal (`output-available` | `output-error` | `approval-responded`). NOT terminal: `input-available` (AskUserQuestion waits for the user). This drives the tool-approval round trip.
- `resume: shouldResumeOnMountRef.current` — computed **once at mount**: resume iff SSR provided `initialChatActiveStreamId` and (instance is fresh or status is ready/error) (`use-session-chat-runtime.ts:185-190`).
- `experimental_throttle: 75` ms UI update throttle (`use-session-chat-runtime.ts:29,195`).
- Initial messages come from SSR: the server component `page.tsx` loads DB messages + chat record (with retry loop for optimistic UUIDs: 50 × 100 ms, `page.tsx:43-72`) and passes `initialMessages` + `initialChatActiveStreamId` down.

### Stop (`use-session-chat-runtime.ts:161-179`)
- POST `/api/chat/{chatId}/stop` with body `{ assistantMessage }` — the client sends its current assistant-message snapshot so the server can persist mid-step output before cancelling the workflow. Fire-and-forget (not awaited) so the UI stop is instant. Then `chatInstance.stop()` + transport `abort()`. A `userStoppedRef` guards against auto-recovery instantly reconnecting (the documented "tap stop 3 times on iOS" bug).

### Resume probing (mobile-critical) (`use-session-chat-runtime.ts:296-354`)
If mounted **without** a known active stream but the conversation ends with an unanswered user message, probe `chat.resumeStream()` on a backoff schedule `[0, 1s, 2.5s, 5.5s, 10s]` — covers the race where the workflow registers its `activeStreamId` shortly after start.

### Retry / recovery (`use-session-chat-runtime.ts:208-249` + `hooks/use-stream-recovery.ts` + `stream-recovery-policy.ts`)
- `retryChatStream({ auto?, strategy? })`: "hard" (manual) = `stop()` + transport abort + `clearError()` + `resumeStream()`; "soft" (auto) = clearError + resumeStream only. Auto retries are suppressed when the user explicitly stopped.
- `useStreamRecovery` listens to `visibilitychange`, `window focus`, `online`:
  - status `error` → auto `retryChatStream({ auto: true })`.
  - On visibility regain with status `ready` → **probe** GET `/api/sessions/{sessionId}/chats` (no-store) and if the server says this chat `isStreaming` → soft reconnect (`use-stream-recovery.ts:71-96`). (Browser kills SSE in background tabs; iOS will hit the same with app backgrounding.)
  - Stall detection: in-flight ≥ 4 s with no renderable assistant content → probe. Constants: `STREAM_RECOVERY_STALL_MS = 4_000`, `STREAM_RECOVERY_MIN_INTERVAL_MS = 8_000` (`stream-recovery-policy.ts:3-4`).
- Tab-resume full refresh (`session-chat-content.tsx:1875-1918`): on focus/visible after blur, `Promise.allSettled` of: force sandbox status sync, GET chat snapshot (`/api/sessions/{sid}/chats/{cid}` → `ChatRefreshResponse { messages, isStreaming }`; only `setMessages` if NOT streaming, `session-chat-content.tsx:1851-1873`), refresh chats/git status/diff/files/skills, checkBranchAndPr. Throttled to 3 s.

### Message sending payload shapes (`session-chat-content.tsx:4437-4477`, `2116-2133`)
- Plain: `sendMessage({ text, files?: FileUIPart[] })`.
- With text-snippet attachments: `sendMessage({ parts: [{type:"text",text}, ...FileUIParts, {type:"data-snippet", id, data:{content, filename}}] })`.
- Wrapper `sendMessageWithPendingState` sets optimistic pending state and calls `setChatStreaming(chatId, true)` (optimistic sidebar badge) before send.
- First message in a fresh session: optimistic chat title (first 80 chars) + parallel POST `/api/generate-title` `{ message }` → `{ title }`, persisted via session PATCH (`session-chat-content.tsx:4483-4551`).

### Tool approval & interactive tool outputs
- Approve/deny: `chat.addToolApprovalResponse({ id, approved: true | false, reason? })` (`session-chat-content.tsx:4084-4096`) — AI SDK API; combined with `sendAutomaticallyWhen` this round-trips to the server.
- AskUserQuestion: detected as last assistant message containing `tool-ask_user_question` part in `input-available` state (`session-chat-content.tsx:2821-2849`); the composer morphs into a question wizard (`components/inline-question-input.tsx` — option pills, multi-select, custom text answer, progress dots); answer submitted via `chat.addToolOutput({ tool: "ask_user_question", toolCallId, output: { answers } })`, decline via `output: { declined: true }` (`session-chat-content.tsx:2852-2874`).
- Managed-runtime profile builder tool: user edits/approves a profile draft inline; submits via `addToolOutput({ tool: "setup_managed_runtime_profile", toolCallId, output })` plus follow-up sync of session runtime mode (`session-chat-content.tsx:4097-4132`).
- Message edit operations: DELETE `/api/sessions/{sid}/chats/{cid}/messages/{messageId}` deletes that message and everything after (used for delete and resend-from-here, `session-chat-content.tsx:2198-2358`); resend re-sends preserved text/file/snippet parts. Fork: POST `/api/sessions/{sid}/chats/{sourceChatId}/fork` `{ id, messageId }` (`hooks/use-session-chats.ts:618-630`).
- Synthetic assistant messages: manual commit/PR UI writes a synthetic assistant message containing data parts via POST `/api/sessions/{sid}/chats/{cid}/messages` `{ message }` (`session-chat-content.tsx:1521-1566`).

### Message metadata (`app/types.ts:21-37`)
`WebAgentMessageMetadata` on assistant messages: `selectedModelId`, `modelId`, `inferenceRoute: "gateway"|"user"`, `inferenceProfileId/Name`, `inferenceProvider`, `lastStepUsage`/`totalMessageUsage` (`LanguageModelUsage`), `lastStepCost`/`totalMessageCost` (USD), finish reasons per step. UI renders a `MessageModelPill` on hover and computes context-usage/cost meters from the last assistant metadata (`session-chat-content.tsx:2808-2819`).

---

## 3. Full catalog of message-part renderers (everything iOS must render)

UIMessage type: `WebAgentUIMessage = UIMessage<WebAgentMessageMetadata, WebAgentDataParts, WebAgentUITools>` (`app/types.ts:167-171`).

### Part-level rendering (main loop `session-chat-content.tsx:3813-4281`)
Messages are pre-grouped (`session-chat-content.tsx:1693-1751`): consecutive `reasoning` parts merge into one "reasoning-group"; stable render keys use `toolCallId` when present. Assistant messages wrap their parts in `AssistantMessageGroups` (`components/assistant-message-groups.tsx`) — a collapsible summary bar (`ToolCallsSummaryBar`) showing tool-call count, changed-file chips (from write/edit inputs), live activity label for running subagent tasks, and elapsed-time timer. **Tool calls + reasoning are hidden by default**; expanded by tap, force-expanded while an approval is pending (`assistant-message-groups.tsx:208-215`).

| Part type | Renderer | What it shows |
|---|---|---|
| `text` (user) | inline bubble (`session-chat-content.tsx:3927-3976`) | right-aligned secondary bubble; hover actions: resend-from-here, delete-from-here |
| `text` (assistant) | `Streamdown` markdown (`:3978-3999`) | streaming markdown w/ fade-in animation; custom `a` component `AssistantFileLink` turns file-path links into "open file in workspace viewer" actions; copy + fork buttons; `MessageModelPill` |
| `reasoning` / reasoning-group | `ThinkingBlock` (`components/thinking-block.tsx`) | collapsible "Thinking…" block w/ streaming shimmer |
| `file` (image/*) | inline `<img>` (`:4181-4229`) | rounded image, max-h-64; user images get delete-from-here |
| `data-snippet` | `SnippetChip` (`components/snippet-chip.tsx`) | pasted-text attachment chip `{ content, filename }` |
| `data-commit` | `GitDataPartCard` (`:310-455`) | inline rule-separator card: pending spinner / "Committed & pushed" + short SHA / error; links to commit URL |
| `data-pr` | `GitDataPartCard` (same) | "Creating pull request…" / "Opened PR #n" / "Synced to existing PR #n" / error / skipped; links to PR |
| `data-verified-build` | `VerifiedBuildDataPartCard` (`:457-484`) | shield badge + status + harnessRunId; opens VerifiedBuildPanel side panel |
| `data-runtime-proof` | `RuntimeProofDataPartCard` (`:486+`) | managed-runtime proof summary (worker/service/browser evidence counts, limitations); opens runtime observability panel |
| `data-workspace-status` | NOT a message part renderer — transient banner via `WorkspaceStartupStatus` from the workspace-status store | "Setting up workspace" with log lines |
| `step-start` | not rendered (used only to find last step for auto-submit) | — |
| tool parts | `ToolCall` dispatcher (below) | — |

`shouldRenderGitDataPart`, `isGitDataPart`, `isVerifiedBuildDataPart`, `isRuntimeProofDataPart` helpers live in `apps/web/lib/chat-streaming-state.ts`.

### Tool-part dispatcher (`components/tool-call/tool-call.tsx:60-111`)
Every tool part type with a dedicated renderer (all in `components/tool-call/renderers/`):

| Tool part type | Renderer | UI specifics |
|---|---|---|
| `tool-bash` | `BashRenderer` | mono command summary; expandable stdout/stderr |
| `tool-read` | `ReadRenderer` | "Read" + `FileNamePill` (relative path via cwd); expandable file content |
| `tool-write` | `WriteRenderer` | "Create" + file pill; expandable created content |
| `tool-edit` | `EditRenderer` | "Update" + file pill; **+N/-M line counts**; expandable side-by-side diff via `@pierre/diffs` `MultiFileDiff` (`edit-renderer.tsx:65-82`) |
| `tool-glob` | `GlobRenderer` | pattern + "in path"; expandable matches |
| `tool-grep` | `GrepRenderer` | pattern + path; expandable results |
| `tool-task` | `TaskRenderer` (515 lines) | subagent card: explorer/executor/managed-worker label, task description, live "pending mini tool call" while running (animated), full nested `ToolCall` list when complete, `N tools · X tokens` meta, managed-runtime details (sandbox name, profile, run id), executor-approval warning |
| `tool-todo_write` | `TodoRenderer` | todo checklist; latest todos also pinned in a floating `PinnedTodoPanel` (`components/pinned-todo-panel.tsx`, `getLatestTodos(messages)`) |
| `tool-ask_user_question` | `AskUserQuestionRenderer` | status summary ("Waiting for user input"/"Answered"/declined) + Q→A list; answering happens in the composer (see §2) |
| `tool-web_fetch` | `FetchRenderer` | `METHOD url` summary |
| `tool-skill` | `SkillRenderer` | `/skill-name` + raw args |
| `tool-setup_managed_runtime_profile` | `ManagedRuntimeProfileBuilderRenderer` (678 lines) | interactive profile draft editor with approve/deny, setup/verification command results |
| `dynamic-tool` & any unknown | `DefaultRenderer` (`tool-call.tsx:114-143`) | capitalized tool name + 40-char JSON input + "Done" meta — Composio/MCP tools land here |

### Shared tool chrome
- `ToolLayout` (`components/tool-call/tool-layout.tsx`): icon + name + summary + meta line, status indicator dot (green/yellow/red/spinner), tap-to-expand panel (200 ms transition), error/interrupted headers, and `ApprovalButtons` shown when `state.approvalRequested && state.approvalId`.
- Tool render state derived in shared package `packages/shared/lib/tool-state.ts` `extractRenderState(part, activeApprovalId, isStreaming)` → `{ running, interrupted, error, denied, denialReason, approvalRequested, approvalId, isActiveApproval }`. Tool part states observed: `input-streaming`, `input-available`, `approval-requested`, `approval-responded`, `output-available` (with `preliminary: true` for live task updates), `output-error`, `output-denied`. **`interrupted` = was running when stream stopped** — iOS must keep `isStreaming` plumbed into renderers.

---

## 4. Polling cadences (complete table)

| Data | Hook / site | Endpoint | Interval |
|---|---|---|---|
| Sessions list | `useSessions` (`hooks/use-sessions.ts:108-118`) | GET `/api/sessions` (`?status=active` optional) | **3 s while any session `hasStreaming`, else 30 s** (to catch PR merges via webhooks) |
| Chats in session | `useSessionChats` (`hooks/use-session-chats.ts:50-54, 246-267`) | GET `/api/sessions/{sid}/chats` (no-store) | **1 s while any chat streaming (or optimistic streaming), 8 s idle focused, 15 s unfocused**; `refreshWhenHidden: false`, `revalidateOnFocus: true` |
| Sandbox lifecycle status | inline effect (`session-chat-content.tsx:2716-2738`) + `syncSandboxStatus` (`session-chat-context.tsx:553-654`) | GET `/api/sandbox/status?sessionId=` | **every 15 s**, only when document visible; client-side throttle 5 s; responds with lifecycle `{ state, serverTime, lastActivityAt, hibernateAfter, sandboxExpiresAt }` + `hasSnapshot` |
| Sandbox reconnect probe | `attemptReconnection` (`session-chat-context.tsx:483-551`) | GET `/api/sandbox/reconnect?sessionId=` | once on session entry (skipped for archived); statuses `connected | no_sandbox | expired` |
| Session diff | `useSessionDiff` (`hooks/use-session-diff.ts`) | GET `/api/sessions/{sid}/diff` when sandbox connected; GET `/api/sessions/{sid}/diff/cached` when not (stale, `cachedAt`) | no interval — **event-driven**: refreshed when a `tool-write`/`tool-edit` transitions to `output-available` (`session-chat-content.tsx:2740-2803`), on tab resume, after auto-commit |
| Git status | `useSessionGitStatus` (`hooks/use-session-git-status.ts`) | **server action** `getGitStatus({sessionId})` (`lib/git/queries/status.ts`, "use server") | no interval; `dedupingInterval: 1500`; same event triggers as diff |
| Files (@-mention suggestions) | `useSessionFiles` | GET `/api/sessions/{sid}/files` | on mount/connect only |
| Skills (slash commands) | `useSessionSkills` | GET `/api/sessions/{sid}/skills` (`?refresh=1` to force) | on mount/connect only |
| Observability panel | `useSessionObservability` (`.../hooks/use-session-observability.ts:168-184`) | GET `/api/sessions/{sid}/observability?chatId=` | **5 s** while panel enabled |
| Verified build run | `useVerifiedBuildRun` | GET `/api/harness/runs?sessionId=&chatId=` (no-store) | no interval (revalidate manually) |
| Verified build events | `useVerifiedBuildEvents` (`hooks/use-verified-build-events.ts:70-108`) | **SSE `EventSource`** `/api/harness/runs/{id}/events?after_event_id=` | live; named events: `ready, open_agents.run.accepted, coordinator.plan, workcell.created, gate.running, gate.completed, approval.required, approval.recorded, run.completed, run.failed, run.cancelled/canceled` — **the only EventSource in the app** (chat streaming is fetch-streamed POST, not EventSource) |
| PR/branch deployment | inline SWR (`session-chat-content.tsx:3033-3063`) + `lib/pr-deployment-polling.ts` | GET via **server action** `getDeploymentUrl` (`lib/github/queries/deployment.ts`) | **5 s focused / 30 s background** until a deployment URL exists (or until URL changes after a push); stops at 0 once resolved |
| Background-agent run detail | `BackgroundRunDetail` (`app/background-runs/[runId]/background-run-detail.tsx:326-336`) | GET `/api/background-agent-runs/{runId}` | **2 s while `queued`/`running`, else 0** |
| Background-agent card status | `useAgentStatusPolling` (`app/repos/[owner]/[repo]/agents/agent-card.tsx:61-74`) | GET `/api/background-agents/{agentId}/status` | **4 s while latest run active, else 0** |
| Sandbox activity ping | composer focus (`session-chat-content.tsx:1442-1455`) | POST `/api/sandbox/activity` `{ sessionId }` | throttled to once / 5 min — keeps sandbox from hibernating while user is typing |
| Chat read receipts | `requestMarkChatRead` (`session-chat-content.tsx:1799-1842`) | POST `/api/sessions/{sid}/chats/{cid}/read` | on route entry (force), on focus/visibility (throttled 3 s), only when tab visible+focused |
| Auto-commit follow-up | `useAutoCommitStatus` (`hooks/use-auto-commit-status.ts:6-7`) | (refreshes git status/diff/files) | staggered at **3 s / 8 s / 16 s** after stream end; 30 s hard UI timeout |
| Leaderboard rank | `useLeaderboardRank` | GET `/api/usage/rank` | dedupe 30 s |
| Models/variants/profiles | `useModelOptions` (`hooks/use-model-options.ts`) | GET `/api/models`, `/api/settings/model-variants`, `/api/inference-profiles` | on mount/focus |
| Preferences | `useUserPreferences` (`hooks/use-user-preferences.ts`) | GET/PATCH `/api/settings/preferences` | on mount/focus |
| Managed runtime profiles | inline SWR (`session-chat-content.tsx:1381-1384`) | GET `/api/sessions/{sid}/managed-runtime/profiles` | on mount/focus |

**No WebSockets anywhere.** Realtime = chat UI-message stream (fetch POST stream + GET resume) + one EventSource (harness events) + adaptive SWR polling.

---

## 5. Optimistic-update patterns

All mutations follow: snapshot current SWR cache → optimistic `mutate(..., { revalidate: false })` → fetch → reconcile with server response (or rollback snapshot on failure).

- **Create session** (`hooks/use-sessions.ts:133-200`): POST `/api/sessions` → prepend new session to list cache + seed `/api/sessions/{id}/chats` cache with the created chat. Errors → `toast.error(message)` + throw.
- **Rename / archive / unarchive session** (`use-sessions.ts:202-455`): optimistic field update; PATCH `/api/sessions/{id}` `{ title }` or `{ status: "archived" | "running" }`; rollback to snapshot on failure. `archivedCount` adjusted optimistically.
- **Create chat** (`use-session-chats.ts:490-574`): client generates `crypto.randomUUID()` id, inserts optimistic chat immediately, navigates instantly, then POST `/api/sessions/{sid}/chats` `{ id }` persists it (server page load retries lookup 50×100 ms for this race, `page.tsx:43-72`). Returns `{ chat, persisted: Promise<Chat> }`.
- **Fork chat** (`use-session-chats.ts:576-676`): same optimistic pattern; POST `.../chats/{sourceChatId}/fork` `{ id, messageId }`.
- **Streaming badge overlay** (`use-session-chats.ts:37-111, 767-836`): module-level per-session overlay map persists optimistic `isStreaming`/title across route changes; race-grace 4 s before clearing if the server never confirms; overlay TTL 5 min. `setChatStreaming` also patches the `/api/sessions` summary cache.
- **Session summary derivation** (`use-session-chats.ts:360-402`): chats-list responses push derived `{ hasUnread, hasStreaming, latestChatId }` into the `/api/sessions` cache without revalidation; full revalidate fires when a session transitions streaming→idle.
- **Chat model / Composio tools** (`session-chat-context.tsx:1086-1140`): PATCH `/api/sessions/{sid}/chats/{cid}` `{ modelId, inferenceProfileId }` or `{ composioSelection }`; composio change is optimistic with rollback.
- **Runtime mode** (`session-chat-context.tsx:780-804`): optimistic session record swap; PATCH `/api/sessions/{sid}` `{ runtimeMode }`; rollback on failure.
- **Preferences** (`use-user-preferences.ts:40-58`): PATCH then `mutate(response, { revalidate: false })`.

---

## 6. Errors & toasts

- **Toast library: sonner** (v2), single `<Toaster>` in providers. ~40 call sites.
- Conventions observed:
  - Mutation failure → `toast.error(message)` where message comes from the response `{ error }` field (e.g. `use-sessions.ts:151`).
  - Long operations → `toast.loading(...)` then `toast.success(...)` with same toast id (dev-server start, `hooks/use-dev-server.ts:84-121`).
  - Background completion → `toast("Agent finished", { description, position: "top-center", duration: 8000, action: { label: "Go to chat", onClick } })` (`hooks/use-background-chat-notifications.tsx:96-104`), optionally with sound (`/Submarine.wav`). Driven purely by the sessions-list poll detecting streaming→idle transitions on non-active sessions (`detectCompletedSessions`), gated by preferences `alertsEnabled`/`alertSoundEnabled`. **This is the web's only "push" mechanism — there are no server push notifications; iOS will need either the same poll-driven approach or new APNs infrastructure.**
- Chat stream errors: `chat.error` surfaces in an inline error banner with a Retry button wired to `retryChatStream()`; auto-recovery clears errors silently (§2).
- Many secondary failures are `console.error` + inline UI state rather than toasts (e.g. message delete error shows inline text, `session-chat-content.tsx:2240-2247`).

---

## 7. Composer: attachments, voice, mentions, slash commands

- **Images** (`hooks/use-image-attachments.ts`, `lib/image-utils.ts`): file picker / drag-drop / paste; validated by `isValidImageType` (`ACCEPT_IMAGE_TYPES`); client-side compression to max dimension **1600 px** (`image-utils.ts:18`); stored as **data-URLs** and sent as AI SDK `FileUIPart`s (`{ type:"file", mediaType, url: dataUrl, filename }`) — no separate upload endpoint; images travel inside the chat POST body.
- **Large pasted text** (`hooks/use-text-attachments.ts`, `lib/text-attachment-utils.ts`): paste ≥ **500 chars or ≥ 10 lines** (`isLargeText`) becomes a `TextAttachment` chip (filename inferred), sent as `data-snippet` parts.
- **Voice** (`hooks/use-audio-recording.ts`): MediaRecorder (`audio/webm`→mp4→ogg→wav fallback); on stop, base64 the blob and POST `/api/transcribe` `{ audio: base64, mimeType }` → `{ text }`; transcript is **appended to the input field** (not auto-sent) (`session-chat-content.tsx:1267-1276`). States: idle/recording/processing; permission-denied handled with message.
- **@-file mentions** (`hooks/use-file-suggestions.ts` + `components/file-suggestions-dropdown.tsx`): client-side filter of `useSessionFiles` results based on `@` token at cursor.
- **Slash commands** (`hooks/use-slash-commands.ts` + `SlashCommandDropdown`): `/` at start filters `useSessionSkills` skills; selection inserts `/skill-name` into the text.
- Textarea auto-resizes up to 3 lines (`session-chat-content.tsx:1308-1334`).
- Composer rows also host: model selector (`ModelSelectorCompact`, options from `useModelOptions` combining models+variants+BYOK inference profiles, selection id encodes `modelId` + `inferenceProfileId` via `lib/inference/model-option-id`), Composio tool selector, runtime-mode selector, workflow picker, mic, paperclip, send/stop button.

---

## 8. Pagination conventions

There is essentially **no cursor pagination in the web client**:
- Sessions list: single fetch, full list + `archivedCount` (`/api/sessions`).
- Chats list: full list per session.
- Messages: full message array via SSR / chat snapshot GET — **no message paging**; iOS should expect potentially large message payloads.
- Repo search: `GET /api/github/installations/repos?installation_id=&limit=50&query=&refresh=1` — `limit` + server-side search query, validated client-side with Zod (`hooks/use-installation-repos.ts:45-94`). This limit+query pattern is the closest thing to a list-fetch convention.
- Background runs / events / observability: bounded server-side, fetched whole. Harness events use `after_event_id` SSE resume (the one cursor-ish parameter, `use-verified-build-events.ts:76-79`).

---

## 9. Server Actions used by the client (no REST equivalent — iOS blockers)

These are invoked from client code as imported functions (Next.js "use server" RPC, POSTs to opaque action endpoints with encrypted action ids — not callable from a native app):

- `getGitStatus({sessionId})` — `lib/git/queries/status.ts` (used by `useSessionGitStatus` as an SWR fetcher).
- `checkPullRequest({sessionId})` — `lib/github/queries/pr.ts` (branch/PR hydration, `session-chat-context.tsx:705-753`).
- `getDeploymentUrl({...})` — `lib/github/queries/deployment.ts` (PR deployment polling fetcher).
- Commit/PR/branch/discard actions — `lib/github/actions/commit.ts`, `lib/github/actions/pr.ts` (`MergePullRequestResult` import in chat content), `lib/git/actions/branch.ts`, `lib/git/actions/discard.ts` (git panel, commit dialog, merge dialog).
- Auth/admin actions — `lib/auth/actions.ts`, `lib/admin/actions.ts`.
- Also `listManagedRuntimeProfiles` is imported directly from `@open-agents/sandbox/managed-runtime-profiles` into the client bundle (static data, fine to replicate).

**An iOS app cannot call these; equivalent REST endpoints must be added or the flows re-implemented.** Everything else in this brief is plain `/api/*` JSON.

---

## 10. Misc behaviors iOS must replicate

- **Unread tracking**: `hasUnread` per chat from the chats endpoint; cleared via read-receipt POST; sessions list aggregates `hasUnread`/`hasStreaming` for sidebar badges.
- **Diff viewing**: `@pierre/diffs` (`MultiFileDiff` + web-worker syntax highlighting via `DiffsProvider`, `components/diffs-provider.tsx`) renders both per-edit-tool diffs and the session Diff tab (`diff-tab-view.tsx`, `diff-viewer.tsx`); `DiffResponse` comes from `/api/sessions/{sid}/diff` with a cached fallback variant; user preference `defaultDiffMode: "unified" | "split"`.
- **Markdown**: `streamdown` v2.5 with custom plugins (`lib/streamdown-config`) and streaming/static modes + fade-in animation per chunk.
- **Sandbox lifecycle UI**: derived from `lifecycleTiming.state` ∈ `provisioning | active | hibernating | hibernated | restoring | failed | null`; "sandbox active" requires both client `sandboxInfo` validity and server agreement (`session-chat-content.tsx:2909-2915`). Sandbox creation via `createSandbox` helper (`sandbox-create.ts`, POST `/api/sandbox`) with structured error banner (`SandboxCreateErrorBanner`).
- **Dev server preview**: POST/DELETE `/api/sessions/{sid}/dev-server` (+ logs/browser-check variants), toast-driven (`hooks/use-dev-server.ts`).
- **Fix-failing-checks**: POST `/api/sessions/{sid}/checks/fix` `{ checkRuns }` → `{ prompt, snippets }` → sent as a chat message with `data-snippet` parts (`session-chat-content.tsx:2135-2183`).
- **Theme**: light/dark/system in localStorage; sonner Toaster + diff themes follow it.
- **useChat helpers actually used**: `messages, error, clearError, sendMessage, setMessages, status, addToolApprovalResponse, addToolOutput, resumeStream, stop, clearError` — an iOS chat client needs equivalents of all of these (the Swift port must reimplement the AI SDK UI-message stream protocol: start/delta/tool-input/tool-output/data-part/finish chunks, plus reconnect semantics).
- **Status model**: AI SDK `status` ∈ `submitted | streaming | ready | error`, but the UI computes `effectiveStatus` blending optimistic pending state, server-side `isStreaming` from the chats poll, and `userStopped` (`session-chat-content.tsx:1574-1690`, helpers in `lib/chat-streaming-state.ts`). iOS must mirror this "server says streaming even though my connection is idle" reconciliation to behave correctly after backgrounding.

## Uncertainties

- BotID enforcement against native clients is unverified here (server-side check lives in API routes; behavior without browser challenge headers unknown).
- Exact chat POST wire format beyond `{ sessionId, chatId, context? } + AI SDK fields` (trigger/messageId semantics) is defined by AI SDK v6 `DefaultChatTransport`; verify against `app/api/chat/route.ts` (covered by the backend-API brief).
- `streamdown` rendering details (code blocks, mermaid, etc.) not exhaustively cataloged; plugins at `lib/streamdown-config`.
