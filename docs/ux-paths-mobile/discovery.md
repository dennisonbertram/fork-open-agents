# Mobile View Discovery — Open Agents `/m`

Scope: the dedicated mobile route group (`app/(mobile)/m/*`) and `components/mobile/*`. Desktop app excluded.

## Application type & IA

Next.js tabbed mobile chat client for AI coding agents, with streaming messages and a real-time tool-approval workflow.

- **Tab bar** (`MobileTabBar`, fixed bottom) — three destinations under the `(tabs)` group:
  - **Activity** (`/m`) — inbox of sessions, filtered by status tone
  - **New** (`/m/new`) — prominent center CTA to create a session
  - **Me** (`/m/me`) — profile, theme toggle, sign-out
- **Pushed route** — `/m/chat/[chatId]` lives OUTSIDE `(tabs)`, so it is full-screen (no tab bar), with a sticky header and a pinned composer.
- **Auth guard** — `m/layout.tsx` runs `getServerSession()`; unauthenticated → redirect `/`.

## Per-screen capabilities

### Activity (`/m`)
- Real sessions via `useSessions()` (SWR). Skeleton rows while loading.
- Filter chips (scrollable): **All / Working / Waiting / Done** with badge counts from the full list.
- Row: glyph (PR / branch / chat) · title (+ unread dot) · `owner/repo · branch` · diff stat (`+added` green / `-removed` red) · status pill · relative time.
- Tap → `/m/chat/[latestChatId]`.
- Empty states: "No sessions yet…" / "No {tone} sessions."

### Chat (`/m/chat/[chatId]`)
- Sticky header: back chevron (→ `/m`), title, `repo · branch`, status pill, overflow.
- Thread: right-aligned `MobileUserBubble`; assistant reuses `AssistantMessageGroups` + `ThinkingBlock` + `ToolCall`. Reasoning blocks collapsible.
- Auto-scroll to bottom while near bottom; stops on scroll-up.
- `MobileToolApprovalBar` pins above the composer when approval pending (ShieldAlert, "Approval needed", tool name, Deny/Approve).
- Composer: auto-growing textarea, placeholder "Message…", Send/Stop toggle (≥44px). Disabled while approval pending; Stop (red) while in-flight.
- Prefill: a task from New is carried via `sessionStorage` (`mobile-chat-prefill:<chatId>`) and auto-sent once on mount.

### New session (`/m/new`)
- Task textarea ("What should the agent do?") + suggestion chips.
- Session type toggle: **Chat only** (Globe) | **With repo** (GitBranch).
- Repo mode: installation auto-select, repo list (private 🔒), `BranchSelectorCompact` (existing or new branch).
- Advanced (collapsible): auto commit & push, auto create PR (gated on repo mode / auto-commit).
- CTA "Start session" — disabled in repo mode until a full repo selection exists. Submitting → "Creating…".

### Me (`/m/me`)
- Profile card (initials avatar, name, @username, email).
- Appearance: theme toggle (light / dark / system).
- Sign out (destructive).

## Key states
Loading (skeleton) · Empty · Error (toast) · **Waiting on you** (approval bar + composer disabled + header "Waiting") · **Streaming** (Stop button + header "Working" + auto-scroll) · Idle/Ready · Submitting ("Creating…").

## Tool-approval specifics
`findPendingApproval()` scans the last assistant message via `isToolUIPart()` + shared `extractRenderState()`; first `approvalRequested` part with an `approvalId` → `MobileToolApprovalBar`. Deny → `addToolApprovalResponse({id, approved:false})`; Approve → `{approved:true}`. Composer gated `disabled={!!pendingApproval}`. `activeApprovalId` suppresses inline ToolCall buttons so the bar is the single affordance.

## Status language (`lib/status.ts` `deriveMobileStatus`)
Working (streaming) → PR # (merged/open/closed) → "Needs attention" (branch + diff) → "New session" (branch only) → "Chat" (no repo) → Failed → Done → Archived → Idle. Sort: working → waiting → idle → done → error, then recent first. Tones map to `--warning` / `--success` / `--destructive` / muted (light + dark).

## Auth / test-auth
`getServerSession()` guard. In `NODE_ENV=development` (or `OPEN_AGENTS_ENABLE_TEST_AUTH=1`), cookie `open_agents_test_user_id=dev-managed-runtime-user` authenticates as demo user "Managed Runtime Demo".

## Recommended story topics
1. Activity Filtering & Session Selection
2. Chat Message Thread & Streaming State
3. Tool Approval Workflow
4. Message Composition & Send/Stop
5. New Session Creation (Chat + Repo Modes)
6. Me Screen & Settings
7. Cross-Screen Error Handling & Edge Cases
