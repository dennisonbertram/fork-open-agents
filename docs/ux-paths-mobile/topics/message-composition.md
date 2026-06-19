# Topic: Message Composition & Send/Stop

Mobile chat composer — auto-growing textarea ("Message…"), Enter-to-send, Send/Stop toggle, disabled gating.

## STORY-MSG-1: Type a Task & Send via Enter
**Type**: short · **Persona**: Alex, founder on a coffee run · **Goal**: Quick keyboard send.
### Steps
1. Tap textarea ("Message…") → min-h 44px.
2. Type a request → grows via field-sizing-content.
3. Press Enter (no Shift) → submit(); textarea cleared immediately, then async send.
4. Right-aligned bubble appears; Stop (red) replaces Send.
5. Finish → header "Ready"; Send returns.
### Edge Cases
- Whitespace-only → trim()→ empty → no send. Shift/Ctrl/Cmd+Enter inserts newline / ignored.

## STORY-MSG-2: Stop a Long Generation
**Type**: medium · **Persona**: Jordan, awaiting a migration script · **Goal**: Abort an in-flight generation.
### Steps
1. Streaming → header "Working"; red Stop (44×44).
2. Tap Stop → userStopped=true, stopChatStream(); pill "Ready"; Send returns.
3. Partial output frozen; composer re-enables.
### Edge Cases
- Stop with approval bar present → Stop works, bar stays. userStopped resets on chatId change.

## STORY-MSG-3: Auto-Grow Multi-Line Message
**Type**: short · **Persona**: Casey, PM leaving feedback · **Goal**: Type multi-line naturally.
### Steps
1. Shift+Enter for newlines → grows to max-h-36, then scrolls within.
2. Enter (no Shift) → sends; collapses to 44px.
### Edge Cases
- Paste 50 lines → scrollable. IME / multibyte handled.

## STORY-MSG-4: Approval Pending → Composer Disables
**Type**: medium · **Persona**: Morgan, security-conscious · **Goal**: Review before allowing the agent to proceed.
### Steps
1. Approval-requested → bar pins; textarea disabled (`disabled={!!pendingApproval}`).
2. Cannot type/submit until resolved; Approve → re-enables.
### Edge Cases
- Multiple approvals: next one detected after the first resolves. Approve failure → toast, bar stays.

## STORY-MSG-5: First-Message Prefill from New
**Type**: medium · **Persona**: Sam, starting a session · **Goal**: Send a task then continue without retyping.
### Steps
1. New form stores `mobile-chat-prefill:${chatId}`.
2. On chat mount, if messages empty → programmatic sendMessage({text}); textarea NOT visually prefilled.
3. Header "Working"; continue conversation after the response.
### Variations
- Return after first message → prefillHandledRef skips re-send.

## STORY-MSG-6: Send Fails → Toast; Textarea Already Cleared
**Type**: medium · **Persona**: Taylor, flaky connection · **Goal**: Understand a failed send.
### Steps
1. Type + Send → textarea cleared on submit; hasPendingResponse=true.
2. sendMessage rejects → catch: hasPendingResponse=false; toast "Couldn't send your message — please try again."; header "Ready".
3. Message text is lost (was cleared); retype to retry.
### Edge Cases
- Send blocked while pendingApproval → no toast (UI block, not error).

## STORY-MSG-7: Rapid Typing vs Approval Bar Render
**Type**: long · **Persona**: Riley, multitasking · **Goal**: Send right after a tool-call message lands.
### Steps
1. Tool-call arrives → pendingApproval recomputes → textarea disabled.
2. User typing/Enter in the render window → submit() guards `!value || disabled || isInFlight`.
3. Most likely: textarea already HTML-disabled → no send. Bar appears moments later.
### Edge Cases
- Slow device delays the disabled state; the submit() guard still blocks on disabled/isInFlight.

## STORY-MSG-8: Multi-Line Code Snippet & Max-Height Scroll
**Type**: short · **Persona**: Alex, technical question · **Goal**: Preserve formatting.
### Steps
1. Shift+Enter through several lines → grows to max-h-36 then scrolls.
2. Enter → sends; collapses.
### Edge Cases
- Landscape on a small phone feels cramped; vertical scroll essential.

## STORY-MSG-9: Send During Background Chat-List Sync
**Type**: long · **Persona**: Jordan · **Goal**: Send without sync issues while the list refreshes.
### Steps
1. Send → effectiveIsInFlight false → hasPendingResponse true; await send.
2. `useSessionChats` SWR updates in background; `shouldUseChatListStreaming` re-evaluated.
3. On resolve, status updates; Stop appears if streaming; Activity reflects the new message.
### Edge Cases
- Offline → send fails (toast). Approval after send → composer locks.
