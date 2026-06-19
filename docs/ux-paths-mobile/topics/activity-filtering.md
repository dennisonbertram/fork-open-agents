# Topic: Activity Filtering & Session Selection

Mobile Activity inbox (`/m`) — browsing, filtering by tone, status pills, ordering, selecting a session.

## STORY-ACT-1: First Launch — Empty Inbox Discovery
**Type**: short · **Persona**: Maya, engineer, first time · **Goal**: Understand the Activity screen and get started · **Preconditions**: Newly authenticated, no sessions.
### Steps
1. Tap Activity tab → "No sessions yet. Tap + to start one." with Inbox icon.
2. Hesitate — "Do I need a repo, or can I create on the fly?"
3. Tap center "+" (New) → New session screen.
### Variations
- Return after creating first session → 1 row, "New session"/"Chat" pill.
### Edge Cases
- Same empty copy whether truly empty or all archived.

## STORY-ACT-2: Multi-Tone Filtering
**Type**: short · **Persona**: Priya, backend dev, 4 concurrent tasks · **Goal**: See only what needs attention · **Preconditions**: ~8 sessions, mixed tones.
### Steps
1. Land on Activity → sorted Working (top) → Waiting → idle. Chips: All(6) Working(0) Waiting(2) Done(0).
2. Tap "Waiting" → chip highlights, list narrows to 2 "Needs attention" rows.
3. Tap "All" → full list restored.
### Variations
- Tap "Working" while one streams → single-row list.
- Badge counts update live as sessions stream/complete.
### Edge Cases
- "Working(1)" but session finishes first → tapping shows "No working sessions."

## STORY-ACT-3: Session Row Anatomy
**Type**: medium · **Persona**: Jamal, full-stack, 5 branches · **Goal**: Spot which branches have changes vs await PR review · **Preconditions**: PR + branches + merged + plain chat.
### Steps
1. Rows sorted attention-first.
2. "Add auth validation": PR glyph, title, `acme/api-server · auth-feature · +42/-8`, orange "PR #247" pill, "2h".
3. Tap row → `/m/chat/[latestChatId]`.
4. "Refactor database schema": branch glyph, `acme/db-service · refactor-schema · +156/-89`, "Needs attention".
5. "Quick documentation fix": MessageSquare glyph, "Chat".
### Variations
- Streaming row at top, "Working" pill. Merged PR → green pill. Unread → blue dot + semibold title.
### Edge Cases
- Open PR with diff shows both pill and diff. Branch w/o PR/diff → "New session" (muted).

## STORY-ACT-4: Status Pill Language
**Type**: medium · **Persona**: Alexa, DevOps · **Goal**: Understand each pill to prioritize · **Preconditions**: 6 sessions, varied statuses.
### Steps
1. Read pills top-to-bottom: Working (warning) → "PR #512" open (warning) → "PR #498" merged (success) → "Needs attention" (warning) → "New session" (idle) → "Chat" (idle).
2. Map warning=action, success=done, muted=idle.
3. Tap "Waiting" filter to focus.
### Variations / Edge Cases
- `status=failed` → "Failed" (destructive). Archived → "Archived" (idle). Merged PR may still show a diff.

## STORY-ACT-5: Rapid Context Reload After Sleep
**Type**: medium · **Persona**: David, contractor, overnight runs · **Goal**: See which overnight work succeeded vs needs follow-up.
### Steps
1. Reopen → 5 skeleton rows briefly.
2. Real data: "Done" (PR #899 merged), "Needs attention" (+23), "Failed" (red).
3. Tap the Failed session to read the error.
### Edge Cases
- Slow network keeps skeletons 2-3s. Archived sessions filtered out by default.

## STORY-ACT-6: Filter Chip Counts & Edge States
**Type**: medium · **Persona**: Sofia, PM · **Goal**: Inbox state at a glance; nothing stuck in Working.
### Steps
1. Chips: All(12) Working(0) Waiting(3) Done(2). Notice "Working" is 0.
2. Tap "Done" → 2 green rows. Tap "Waiting" → 2 PRs + 1 "Needs attention". Tap "All" → distribution.
### Variations
- Completing a Waiting session decrements Waiting, increments Done.

## STORY-ACT-7: Unread Signaling & Reply Queue
**Type**: medium · **Persona**: Marcus, incident responder · **Goal**: Spot sessions with new assistant messages / approvals.
### Steps
1. Spot blue unread dots on 2 rows (semibold titles).
2. Tap one → chat opens with an approval bar; review + Approve.
3. Back to Activity; open the second; reply in composer → unread dot clears.
### Edge Cases
- Unread + "Working" → streaming message + approval bar.

## STORY-ACT-8: Long Curation & Archive Sweep
**Type**: long · **Persona**: Nina, platform architect · **Goal**: Archive old/completed infra work; verify nothing in Waiting is truly blocked. (~20 sessions.)
### Steps
1. Auto-sort applied. 2 Working at top.
2. "Waiting" → 4 open PRs (ages 1d/4h/2h/1h); note the oldest likely needs review.
3. Open PR #1023 → review thread.
4. "Done" → 8 old sessions; skim and archive 2-3 (counts decrement).
5. "Idle" → new branches ("New session") and plain chats ("Chat").
### Edge Cases
- "Failed" row mixed into Done → tap to debug. Very old "Archived" hidden by default.

## STORY-ACT-9: Real-Time Polling & Stream Interruption
**Type**: long · **Persona**: Jordan, DevOps, parallel migrations · **Goal**: Catch completions/errors live.
### Steps
1. 3 "Working" rows at top; list auto-revalidates.
2. First completes → "PR #5001" (done), re-sorts down.
3. Second completes; third → "Failed" (red).
4. Tap Failed → read error → create corrected session.
### Edge Cases
- Two complete in one interval → both move together. SWR revalidates on focus when returning from another tab.

## STORY-ACT-10: Empty State After Filter Refinement
**Type**: short · **Persona**: Chen, new user · **Goal**: Understand why the inbox looks empty.
### Steps
1. Tap "Working" with no working sessions → "No working sessions." + Inbox icon.
2. Think "did it crash?"; tap "All" → all 5 return.
3. Realize: filter narrowed to an empty tone, not a crash.
