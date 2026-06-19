# Topic: Chat Message Thread & Streaming State

Mobile Chat (`/m/chat/[chatId]`) — reading the thread, reasoning blocks, status transitions, auto-scroll.

## STORY-CHAT-1: Open & Read a Long Conversation
**Type**: medium · **Persona**: Alex, debugging tests · **Goal**: Scroll history to find the diagnosis · **Preconditions**: 15+ messages w/ reasoning + tool calls.
### Steps
1. Tap a row → `/m/chat/[chatId]`; sticky header shows title, `repo @ branch`, "Ready" pill.
2. Thread starts at bottom (latest assistant text).
3. Scroll up: own bubbles right (primary); assistant text left; collapsible reasoning blocks.
4. Tap a reasoning block → expands inline.
5. Keep scrolling up without being yanked (stickToBottom=false once >96px from bottom).
6. Scroll back to bottom → auto-follow resumes.
### Edge Cases
- Empty thread → "Start the conversation below." Reasoning collapse state persists across re-renders.

## STORY-CHAT-2: Send & Watch Status Transition
**Type**: short · **Persona**: Jamie, iterating a prompt · **Goal**: Confirm the agent is working.
### Steps
1. Type "Can you explain what went wrong?" → Send (≥44px).
2. Pill → "Working" immediately; Send becomes red Stop.
3. Read history while waiting.
### Edge Cases
- Network error on send → toast "Couldn't send your message — please try again." Prefill from /m/new auto-sends once on mount.

## STORY-CHAT-3: Read a Streaming Response (auto-scroll + thinking)
**Type**: long · **Persona**: Casey, architect reviewing reasoning · **Goal**: Watch the response stream and understand the recommendation.
### Steps
1. Pill → "Working".
2. No renderable content yet → "Thinking…" spinner (aria-live polite).
3. First chunk → indicator disappears, text streams.
4. Near bottom → auto-scroll follows growth (scrollSignature changes).
5. Reasoning block streams (expandable). Tool-call card appears (collapsible, Approve/Deny).
6. Scroll up mid-stream → not pulled back.
7. Stream completes → "Ready".
### Variations
- Stop mid-stream → "Ready" immediately, partial content kept.
### Edge Cases
- Workspace startup status renders below messages during sandbox init. Chat-list streaming flag keeps in-flight true until a renderable part lands.

## STORY-CHAT-4: Expand a Reasoning Block
**Type**: medium · **Persona**: Morgan, prompt engineer · **Goal**: Read intermediate reasoning.
### Steps
1. See collapsed reasoning header.
2. Tap → expands inline (pl-[22px] indent).
3. Live text continues if still streaming.
4. Tap header again → collapse.
### Edge Cases
- Multiple reasoning blocks toggle independently. State resets on remount.

## STORY-CHAT-5: Tool Approval via Pinned Bar (cross-ref Tool Approval topic)
**Type**: medium · **Persona**: Devon, security-conscious · **Goal**: Review the pinned approval and decide.
### Steps
1. Assistant emits a tool in "approval-requested".
2. MobileToolApprovalBar pins above composer: ShieldAlert, "Approval needed", tool name, Deny/Approve.
3. Composer disabled; inline tool buttons suppressed (activeApprovalId).
4. Tap Approve → `addToolApprovalResponse({id, approved:true})`; bar clears; composer re-enables.
### Edge Cases
- Navigate away while pending → approval state resets on return. Network error on approve → toast.

## STORY-CHAT-6: Recover from a Stopped Stream
**Type**: short · **Persona**: Alex, impatient · **Goal**: Abort and resume without losing partial output.
### Steps
1. Tap red Stop → userStopped=true, stopChatStream().
2. Pill → "Ready"; partial message stays; composer re-enables.
3. Read partial; send a new message or retry.
### Edge Cases
- Stop during thinking → indicator disappears, no assistant content. Repeated Stop taps are no-ops.

## STORY-CHAT-7: Empty Chat + Prefill from New
**Type**: short · **Persona**: Jamie, from New screen · **Goal**: First task auto-sends on open.
### Steps
1. "Start session" with "Write a unit test for authentication".
2. Redirect to `/m/chat/[newChatId]`; empty state shown.
3. Prefill read from `mobile-chat-prefill:[chatId]`; if messages empty → auto-send; key cleared.
4. Pill → "Working"; thinking indicator; stream begins.
### Variations
- If chat already has messages → prefill skipped. Navigate away → consumed, not re-sent.

## STORY-CHAT-8: Scroll Back to Bottom While Streaming
**Type**: short · **Persona**: Taylor · **Goal**: Read history mid-stream, then follow latest.
### Steps
1. Scrolled up (stickToBottom=false).
2. Scroll down within 96px → stickToBottom=true.
3. New content → smooth auto-scroll to bottom.
### Edge Cases
- Very fast streaming may batch scroll updates. prefers-reduced-motion may disable smooth scroll.
