# Mobile View (`/m`)

A dedicated, mobile-optimized endpoint for Open Agents that exposes a **subset**
of the product — enough to stay in the loop with running agents on a phone —
without touching the desktop UI. Built on branch `feat/mobile-view` (off
`origin/develop`).

## Goals & constraints

- **One design system.** Reuse the existing tokens in `apps/web/app/globals.css`,
  the `components/ui/*` primitives, the `cn()` util, `lucide-react`, and the
  `font-sans`/`font-mono` families. The Pencil mockups (`open-agents-mobile.pen`)
  are layout/IA reference only — their blue accent is **not** used; primary
  actions use `--primary`. The only additive tokens are semantic status colors
  (`--success`, `--warning`, and their `-foreground`) defined for **both** `:root`
  and `.dark`; "error" maps to the existing `--destructive`.
- **Its own endpoint.** A route group `app/(mobile)/m/*` renders the mobile
  screens. Desktop routes/components are untouched (the only existing file edited
  is `globals.css`, additively).
- **Real data.** Screens reuse the existing data hooks, server data, and the chat
  runtime context — no fabricated data.
- **System-aware theming.** Reuses the existing `useTheme()` from
  `app/providers.tsx` (light/dark/system + `localStorage` + the no-flash init
  script in `app/layout.tsx`). Everything is token-based so light and dark both
  work.
- **Touch ergonomics.** ≥44px targets, thumb-reachable primary actions, bottom tab
  bar + sheets, no horizontal overflow, safe-area insets.

## Information architecture

Bottom tab bar with three destinations plus a pushed chat route:

| Route | Screen | Purpose |
| --- | --- | --- |
| `/m` | Activity / Inbox | Attention-first list of sessions/chats |
| `/m/new` | New session | Create a session + first chat |
| `/m/chat/[chatId]` | Chat | Converse with the agent; **tool approvals** |
| `/m/me` | Me | Account + theme toggle |

Status language used everywhere a session/chat appears: **Working · Waiting on you
(needs approval) · Done · Error**, derived once in `components/mobile/lib/status.ts`.
Repos/Loops/Agents deep navigation is intentionally deferred.

## File map

```
apps/web/app/(mobile)/m/
  layout.tsx                 Mobile shell: max-width container, safe-area, tab bar
  page.tsx                   Activity (server: auth)
  new/page.tsx               New session (server: auth)
  me/page.tsx                Me (server: auth + user)
  chat/[chatId]/page.tsx     Chat (server: resolve chatId→session, boot provider)

apps/web/components/mobile/
  shell/   mobile-tab-bar · mobile-status-pill · mobile-screen-header
  activity/mobile-activity-screen · mobile-session-row · mobile-activity-filter-chips
  chat/    mobile-chat-screen · mobile-chat-header · mobile-message-thread
           mobile-user-bubble · mobile-composer · mobile-tool-approval-bar
           mobile-pending-approval.test
  new/     mobile-new-session-screen · mobile-create-session-payload(+test)
           mobile-suggestion-chips
  me/      mobile-me-screen · theme-toggle
  lib/     types · status (deriveMobileStatus, sort, filter, toneToClass)
```

## Data wiring (real)

- **Activity** — `useSessions()` for the live list; `deriveMobileStatus()` maps each
  session to a tone and sorts attention-first; filter chips narrow by tone. Rows
  link to `/m/chat/[id]`.
- **Chat** — `app/(mobile)/m/chat/[chatId]/page.tsx` (server) resolves `chatId →
  sessionId` (retry-aware for optimistic IDs), checks ownership, loads messages via
  `getChatMessages`, and boots `SessionChatProvider`. `MobileChatScreen` consumes
  `useSessionChatRuntimeContext()` for `messages`/`status`/`sendMessage`/
  `addToolApprovalResponse`/`stopChatStream`, and reuses the desktop renderers
  (`AssistantMessageGroups`, `ThinkingBlock`, `ToolCall`, `WorkspaceStartupStatus`).
  Streaming-status handling mirrors the desktop `userStopped`/`hasPendingResponse`
  guard.
- **Tool approval** — `findPendingApproval()` scans the last assistant message for a
  tool part with `approvalRequested` (detected via `isToolUIPart` + the shared
  `extractRenderState`). The pinned `MobileToolApprovalBar` Approve/Deny call the
  real `addToolApprovalResponse`; `activeApprovalId` suppresses the inline buttons so
  there is a single affordance.
- **New** — `useInstallationRepos()` + `BranchSelectorCompact` + `useRepoDefaults()`;
  `buildCreateSessionInput()` builds the payload; `createSession()` (from
  `useSessions`) creates it; the task is handed to the chat screen via a per-chat
  `sessionStorage` key (`mobile-chat-prefill:<chatId>`) and sent as the first
  message on mount.
- **Me** — `useTheme()` toggle (light/dark/system) + the authenticated user.

## Theming

`globals.css` gains, additively:

```css
@theme inline { --color-success: var(--success); --color-success-foreground: …;
                --color-warning: var(--warning); --color-warning-foreground: …; }
:root  { --success: oklch(0.6 0.15 145);  --warning: oklch(0.75 0.16 70); … }
.dark  { --success: oklch(0.72 0.15 145); --warning: oklch(0.8 0.16 70);  … }
```

Status text on tinted surfaces uses `text-success`/`text-warning` (the legible
color token), never the near-white `*-foreground` variant — that was a light-mode
contrast bug caught in review.

## Review findings & resolutions

An Opus review (cross-checked with GPT-5.4) ran against the implementation. All
actionable findings were fixed (commit `eaee672c`):

| Severity | Finding | Resolution |
| --- | --- | --- |
| Critical | Approval bar never fired — `findPendingApproval` matched a `tool-invocation` type the runtime never emits | Detect via `isToolUIPart` + shared `extractRenderState`/`getToolName`; **test rewritten with real tool-part shapes** |
| High | New-session task stashed but never read | Per-chat `sessionStorage` key, sent as first message on mount |
| High | Repo-mode submit with no repo created a plain chat | CTA + `handleSubmit` gated on a resolved `repoSelection` |
| Medium | Optimistic chat 404'd before retry | Initial `chatId` resolution is retry-aware for optimistic IDs |
| Medium | Auto-scroll only tracked `messages.length` | Content-signature dependency + near-bottom guard |
| Low | Runtime handlers swallowed rejections | `await` + `try/catch` + toast |
| Low | `*-foreground` tokens used as standalone text | Use `text-success`/`text-warning` |
| Info (dismissed) | Status precedence ranks branch/PR above terminal state | Faithful port of desktop `getSessionStatusLabel` — not a mobile regression |

## Testing

- Unit: `mobile-pending-approval.test.ts` (approval detection on real shapes),
  `mobile-create-session-payload.test.ts` (payload construction). `bun test
  components/mobile/` → 18 pass.
- Gates: `turbo typecheck --filter=web` (4/4), `bun run check` (0/0).
- Routes compile and the auth guard works (`/m`, `/m/new`, `/m/chat/[id]` → `307`
  unauthenticated).

## Follow-ups

- Authenticated end-to-end browser smoke (light + dark) — pending an interactive
  Vercel sign-in (headless automation can't complete OAuth).
- Composer attachments (image/file `parts`-based send) — text send ships first.
- Optional later: Repos/Loops tabs, richer empty/error states, pull-to-refresh.

## Build note

This was built with a planning→implementation→review workflow (Opus plan/review,
Sonnet implementation). The implementation agents initially wrote into the wrong
git worktree (they inherit the session's cwd, not the target worktree), so the
artifacts were relocated onto a clean `feat/mobile-view` and re-verified, and the
review fixes were applied directly.
