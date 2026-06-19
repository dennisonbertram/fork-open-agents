# UX Path Catalog — Open Agents Mobile View (`/m`)

Generated: 2026-06-18 · Scope: the dedicated mobile route group only (desktop excluded).
Total stories: **66** · See `discovery.md` for the app map and `topics/*.md` for full stories.

## Summary

| Type | Count |
|------|-------|
| Short (2–5 steps) | 26 |
| Medium (5–15 steps) | 28 |
| Long (15+ steps) | 12 |
| **Total** | **66** |

| Topic | File | Stories |
|-------|------|---------|
| Activity Filtering & Session Selection | `topics/activity-filtering.md` | STORY-ACT-1…10 |
| Chat Thread & Streaming | `topics/chat-thread-streaming.md` | STORY-CHAT-1…8 |
| Tool Approval Workflow | `topics/tool-approval.md` | STORY-APPR-1…10 |
| Message Composition & Send/Stop | `topics/message-composition.md` | STORY-MSG-1…9 |
| New Session Creation | `topics/new-session-creation.md` | STORY-NEW-1…11 |
| Me, Settings & Navigation | `topics/me-settings-navigation.md` | STORY-ME-1…8 |
| Cross-Screen Errors & Edge Cases | `topics/errors-edge-cases.md` | STORY-ERR-1…10 |

## Coverage matrix

| Feature area | Covered by | Notable gaps |
|--------------|-----------|--------------|
| Activity inbox + tone filtering + counts | ACT-1,2,4,6,10 | — |
| Status pill derivation + ordering | ACT-3,4; (lib/status.ts) | — |
| Open a session → chat | ACT-3,7,8; CHAT-1 | — |
| Read thread (bubbles, text, reasoning) | CHAT-1,3,4,8 | — |
| Streaming state (Working/Ready, thinking, auto-scroll) | CHAT-2,3,8; MSG-2 | — |
| Tool approval (Approve/Deny, gating, sequences) | APPR-1…10; CHAT-5; MSG-4 | command args only visible in inline card, not the bar |
| Composer send/stop/disabled/prefill | MSG-1…9; CHAT-7 | attachments (TODO seam) not covered — not wired |
| New session (chat-only) | NEW-1,6 | — |
| New session (repo/branch, advanced) | NEW-3,4,7,10 | no installation switcher (multi-org) — NEW-11 |
| GitHub-not-connected / empty repos | NEW-2,5 | — |
| Me screen + theme (light/dark/system) | ME-1…5,7,8 | — |
| Tab navigation + active state | ME-6 | chat route hides tab bar (verified) |
| Auth guard + ownership | ERR-1,4; ME-5 | — |
| Optimistic-chat retry / 404 | ERR-2,3,10 | 5s retry window edge (ERR-2) |
| Stream error / background-return | ERR-5,7,8 | — |
| List-fetch failure | ERR-6 | error shown as empty state (no banner) — UX gap |

## Story dependency graph

```text
ERR-1 (auth guard) ── gates ──> everything under /m
NEW-1/3/4/6 (create session)
  └── MSG-5 / CHAT-7 (first-message prefill auto-send)
        └── CHAT-2/3 (streaming) ── may pause into ──> APPR-1…10 (approval)
                                                          └── MSG-4 (composer disabled)
ACT-2/3/7 (select session) ──> CHAT-1 (read thread)
ME-2/3 (theme) ── applies across ──> ACT / CHAT / NEW / ME
ERR-2/3/10 (optimistic/404/race) ── wrap ──> CHAT open
```

## Gaps & recommendations (product/UX, surfaced by the swarm)

1. **Activity fetch error reads as "empty"** (ERR-6) — a failed `useSessions` shows the same empty-state copy as zero sessions, with no toast/banner. Consider an explicit error state with a retry.
2. **Multi-org installation switcher missing on New** (NEW-11) — only the first GitHub installation's repos are reachable; users with repos in another org can't select them from `/m/new`.
3. **Composer attachments are a TODO seam** — image/file send is intentionally not wired; flagged in `mobile-composer.tsx`.
4. **Approval bar shows the tool name, not the command** (APPR-1,7) — the full command/args are only visible in the inline thread card; the pinned bar is name-only. Fine, but worth confirming it gives enough context to decide safely.
5. **Optimistic-chat retry window** (ERR-2) — 50×100ms (~5s). A chat that lands at ~5.2s redirects to `/m`; the next poll surfaces it. Acceptable, but note the boundary.
6. **Deferred tabs** — Repos/Loops are intentionally out of the mobile subset.

## How to use this catalog

These stories are intended to drive a future `/ux-walker` run (live browser walk-through) once a **non-production** database is available — they create sessions, send messages, and approve tools, which write real data. Until then they serve as a manual QA script and a spec for the mobile subset.
