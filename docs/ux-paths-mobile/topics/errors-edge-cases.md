# Topic: Cross-Screen Error Handling & Edge Cases

Auth redirects, optimistic-chat retry, notFound, ownership, stream errors, list-fetch failure, deep links, backgrounding.

## STORY-ERR-1: Unauthenticated Deep Link to Chat
**Type**: short · **Persona**: Alex · **Goal**: Open a chat URL while logged out.
### Steps
1. Tap `/m/chat/[uuid]`; `m/layout.tsx` getServerSession() null → redirect("/") before any DB query.
2. Log in; navigate back manually.
### Edge Cases
- Redirect fires before partial UI render.

## STORY-ERR-2: Optimistic Chat ID Never Lands
**Type**: medium · **Persona**: Jamie · **Goal**: Open a fresh chat that fails to persist.
### Steps
1. createSession → push `/m/chat/[v4-uuid]`.
2. getChatByIdWithRetry → isOptimisticChatId true → 50×100ms retries.
3. Still undefined → since optimistic → redirect("/m") (soft, NOT 404).
### Edge Cases
- Lands at 5.2s → just-missed window. Unmount during retries.

## STORY-ERR-3: Non-Existent Chat ID
**Type**: short · **Persona**: Casey · **Goal**: 404 gracefully.
### Steps
1. `/m/chat/[non-optimistic-id]`; isOptimisticChatId false → 1 attempt.
2. undefined → notFound() → Next.js 404.
### Edge Cases
- Valid UUID not in DB → still notFound. Deleted between render and lookup → notFound (correct).

## STORY-ERR-4: Accessing Another User's Chat
**Type**: medium · **Persona**: Pat · **Goal**: Try to view someone else's chat.
### Steps
1. `/m/chat/[kim-uuid]`; chat resolves → sessionRecord loads.
2. `sessionRecord.userId !== session.user.id` → redirect("/m") silently (privacy-preserving).
### Edge Cases
- Session deleted but chat exists → notFound earlier. Stale cache could pass ownership.

## STORY-ERR-5: Chat Stream Errors Mid-Response
**Type**: long · **Persona**: Morgan · **Goal**: Network drops mid-stream.
### Steps
1. Send → "Working"; stream begins.
2. Network drops; fetch aborts → context status "error".
3. effectiveStatus → spinner stops; header pill → "Ready"; partial message kept; composer re-enables.
### Edge Cases
- Error before any assistant message → just "error". Send-before-stream error → toast, hasPendingResponse=false. Safari iOS abort race handled by userStopped.

## STORY-ERR-6: Activity List Fetch Fails
**Type**: short · **Persona**: Riley, offline · **Goal**: Sessions API fails.
### Steps
1. useSessions error; loading false; visible empty → "No sessions yet. Tap + to start one." (indistinguishable from zero sessions; no toast).
2. Can still tap New.
### Edge Cases
- 401 → still empty state, no login redirect. Transient → recovers on 30s poll. fallbackData hides the empty state.

## STORY-ERR-7: Deep Link Cold Start
**Type**: medium · **Persona**: Taylor · **Goal**: Land directly in a chat.
### Steps
1. `/m/chat/[id]` cold start → root layout + auth guard pass → MobileChatPage boots (no (tabs)).
2. Composer ready; TAB BAR ABSENT (pushed outside (tabs)); back → `/m` shows tab bar.
### Edge Cases
- Query params ignored. Optimistic id → retry loop while empty thread renders. Auth expiry → redirect to /.

## STORY-ERR-8: Background & Return to Streaming Chat
**Type**: long · **Persona**: Jordan · **Goal**: Leave for Slack, return after stream.
### Steps
1. Streaming; background the tab → fetch may suspend.
2. Return: (A) resumes → auto-scroll catches up; (B) timed out → "error" → "Ready"; partial kept.
### Edge Cases
- iOS aggressive suspension aborts after ~10min. 2h later → stale cookie → redirect to login on next send.

## STORY-ERR-9: Stale Session After Creation
**Type**: medium · **Persona**: Casey · **Goal**: Created session appears in Activity.
### Steps
1. createSession optimistically updates the SWR list (new session at top).
2. Back to `/m` → optimistic session visible without flicker; real API reconciles in background.
### Edge Cases
- Real fetch returns 0 (bug) → optimistic session vanishes. POST 2xx but no real record → cold-load later fails.

## STORY-ERR-10: notFound vs Redirect Race
**Type**: short · **Persona**: Alex · **Goal**: Chat deleted mid-render.
### Steps
1. `/m/chat/[id]`; parallel fetches.
2. Session deleted → `getSessionByIdCached` undefined → notFound() (wins over ownership redirect).
### Edge Cases
- Ownership passes then session deleted before final check → stale screen until send. Stale cache could show another's chat.
