# Mobile View (route group `(mobile)/m/*`) — Implementation Plan

Status: planning. Owner: mobile-view epic. Base: `origin/develop @ 87045c55`.

A dedicated, touch-first mobile endpoint that exposes a SUBSET of the app:
chat with agents, create sessions, and an attention-first activity feed. It is a
**separate route group** at `apps/web/app/(mobile)/m/*`. Desktop routes and
components are **not** touched. The only existing file edited is
`apps/web/app/globals.css`, and only to add two additive semantic status tokens
(`--success`, `--warning`) for both `:root` and `.dark`.

## Scope (IA subset)

- Tabs: **Activity** (`/m`), **New** (center, `/m/new`), **Me** (`/m/me`).
- **Chat** (`/m/chat/[chatId]`) is a pushed full-screen route, not a tab.
- Repos / Loops / Agents sub-groups are **deferred** (optional). Activity may
  show repo grouping labels but does not deep-link into repo dashboards.
- Status language everywhere: **Working / Waiting on you / Done / Error**, one
  consistent visual treatment. `Error` maps to `--destructive`.

## ONE design system

Mobile reuses the EXISTING tokens in `globals.css` (`--background`,
`--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`,
`--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius-*`) and
the EXISTING `components/ui/*` primitives (`Button`, `Badge`, `Card`, `Input`,
`Textarea`, `Switch`, `Drawer`, `ScrollArea`, `Separator`, `Skeleton`, `Avatar`,
`Empty`, `Tabs`), `cn()` from `lib/utils`, `lucide-react`, and
`font-sans`/`font-mono`. Primary actions use `--primary`. No second token set,
no Pencil-mock blue accent. The Pencil mocks are LAYOUT/IA reference only.

### Token additions (minimal — both themes)

Only `--success` / `--success-foreground` and `--warning` /
`--warning-foreground` are added (they are missing — success/warning are
currently hardcoded emerald/amber Tailwind classes scattered across components).
`Error` reuses `--destructive`. These are additive to `:root` and `.dark` and to
the `@theme inline` color map so `bg-success` / `text-warning` utilities resolve.

## Foundation

1. `globals.css` — add status tokens (see token additions).
2. `app/(mobile)/m/layout.tsx` — server-component auth guard + mobile shell that
   renders the bottom tab bar. Inherits root `<Providers>` (do NOT re-wrap).
3. Stub pages so `/m`, `/m/new`, `/m/chat/[chatId]`, `/m/me` resolve.
4. `components/mobile/lib/status.ts` — shared status derivation + sort util.
5. `components/mobile/lib/types.ts` — mobile-local PascalCase types.
6. `components/mobile/me/theme-toggle.tsx` — theme toggle using `useTheme()`.

## Data wiring (all reuse existing hooks/endpoints)

- Activity → `useSessions()` (`/api/sessions`). Group with `buildRepoGroups`.
  Status derived from `SessionWithUnread` fields (no extra call). Sort
  attention-first client-side.
- Chat → server page resolves `sessionId` via `getChatById(chatId)`, loads
  `getChatMessages`, wraps in `SessionChatProvider`; client consumes
  `useSessionChatRuntimeContext()` for messages/status/sendMessage/
  addToolApprovalResponse/stopChatStream. Reuse `ToolCall`, `ThinkingBlock`,
  `AssistantMessageGroups`, `WorkspaceStartupStatus`.
- New → `useSession`, `useUserPreferences`, `useInstallationRepos` (+ inline
  `/api/github/installations`), `BranchSelectorCompact`, `useRepoDefaults`,
  `useSessions().createSession`. Navigate to `/m/chat/{chat.id}` on success.
- Me → `useSession` + theme toggle + sign-out.

See the structured plan companion (componentClusters, pages, testPlan, risks)
for exact file paths, props contracts, and TODO seams.

## TODO seams (explicitly marked, not faked)

- Image/snippet attachments in the mobile composer: ship text send first; attach
  button is a marked TODO seam (`parts`-based send) — do not fake.
- Vercel project sync section in New: optional, non-blocking; deferred behind an
  Advanced disclosure with a TODO seam if Vercel-auth user.
- Repo/Loops/Agents deep navigation: deferred.

## Verification

- `bun run ci` (format/lint/typecheck/tests) in `apps/web`.
- Authenticated local UI smoke at `/m`, `/m/new`, `/m/chat/[id]`, `/m/me` in
  both light and dark, with a tool-approval round-trip on a live session.
