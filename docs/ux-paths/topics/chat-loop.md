# UX Paths — Core chat loop (send, stream, stop, fork, share, delete)

Scope: `POST /api/chat`, the chat stream/stop reconnection pair, chat CRUD under
`/api/sessions/{sessionId}/chats/**`, message upsert/delete, fork, share, and the
public `/api/shared/{shareId}/**` read surface.

**Auth for curl runs**: start the server with `OPEN_AGENTS_ENABLE_TEST_AUTH=1`, call
`GET /api/dev/managed-runtime-demo` once, capture the `Set-Cookie`
(`open_agents_test_user_id=dev-managed-runtime-user`) and replay it on every request
below. Steps assume that cookie is attached unless the story says otherwise.

**Cross-cutting redundancy notes** (do not resolve silently):

- Chat streaming state is readable from **three** places:
  `GET /api/sessions/{sessionId}/chats/{chatId}` (`isStreaming` + `chat.activeStreamId`),
  `GET /api/chat/{chatId}/stream` (204 vs. stream), and
  `GET /api/shared/{shareId}/status` (`{isStreaming}`) for shared chats.
- Reconnecting to a live run can be done by `GET /api/chat/{chatId}/stream` **or** by
  re-`POST /api/chat` with the same body — the POST route's `reconcileExistingActiveStream`
  returns `action: "resume"` and replays the same readable.
- Assistant messages can be persisted by **three** paths:
  `POST /api/sessions/{sessionId}/chats/{chatId}/messages`,
  `POST /api/chat/{chatId}/stop` with an `assistantMessage` body, and implicitly by
  `POST /api/chat` (`persistAssistantMessagesWithToolResults` on the inbound array).
- The chat list is returned by `GET /api/sessions/{sessionId}/chats` and each chat's
  detail again by `GET /api/sessions/{sessionId}/chats/{chatId}`; `defaultModelId` is
  also available from `GET /api/settings/preferences`.
- Titles: `POST /api/generate-title` (standalone) vs. `PATCH .../chats/{chatId}` with
  `{title}` vs. auto-titling inside the chat workflow — three ways a title gets set.
- Session-level share is a dead duplicate of chat share: `POST|DELETE
  /api/sessions/{sessionId}/share` always returns `410 Gone`.

---

## STORY-chat-loop-01: First message in a brand-new session

**Type**: short
**Persona**: Maya, a backend engineer trying the product for the first time
**Goal**: Create a session and get one assistant reply.
**Preconditions**: Authenticated test cookie only; no prior session.
**Ideal path**: 2 calls — session creation already mints the first chat, so create + send is the floor.
**Alternate paths**: A chat can also be created separately via `POST /api/sessions/{sessionId}/chats`; a title can be pre-generated via `POST /api/generate-title` instead of letting the workflow name the chat.

### Steps
1. `POST /api/sessions` — body: `{"title":"Fix flaky auth test","sandboxType":"none"}` → expect 200 `{session:{id,status:"running",...}, chat:{id,title:"New chat",modelId}}`
2. `POST /api/chat` — body: `{"sessionId":"<sessionId>","chatId":"<chatId>","messages":[{"id":"5f7d1c2e-0a11-4a2f-9a63-4c1b2f0a9e10","role":"user","parts":[{"type":"text","text":"Why does apps/web/lib/auth/config.ts throw on a missing BETTER_AUTH_SECRET?"}]}]}` → expect 200 `text/event-stream` UI-message stream, headers `x-workflow-run-id`, `x-request-id`

### Variations
- Pass `sandboxType:"vercel"` with `repoOwner`/`repoName` to get a repo-backed session.
- Send the same request twice quickly to exercise the resume/409 reconciliation (see STORY-06).

### Edge Cases
- Missing auth cookie on step 2 → `401 {"error":"Not authenticated"}`
- `{"messages":[]}` → `400 {"error":"messages must be a non-empty array"}`
- Body missing `chatId` → `400 {"error":"sessionId and chatId are required"}`
- Non-JSON body → `400 {"error":"Invalid JSON body"}`
- `sessionId` of another user's session → `403 {"error":"Unauthorized"}`
- Unknown `sessionId` → `404 {"error":"Session not found"}`
- `chatId` that belongs to a different session → `404 {"error":"Chat not found"}`
- Session previously archived (`PATCH /api/sessions/{id}` `{"status":"archived"}`) then send → `400 {"error":"Session is archived"}`

---

## STORY-chat-loop-02: Reload the tab mid-answer and reattach to the live stream

**Type**: short
**Persona**: Maya, whose browser crashed while the agent was answering
**Goal**: Get the in-flight response back without re-sending the prompt.
**Preconditions**: STORY-01 step 2 issued and the run still active (disconnect the curl before the stream ends, e.g. `curl --max-time 3`).
**Ideal path**: 2 calls — one state read to learn a run is live, one to attach to it.
**Alternate paths**: Re-`POST /api/chat` with the identical body resumes the same run (`x-workflow-run-id` matches) instead of starting a second — a full duplicate of the reconnect route. `GET /api/shared/{shareId}/status` exposes the same `isStreaming` bit publicly once shared.

### Steps
1. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect 200 `{chat:{id,modelId,inferenceProfileId,composioSelection,activeStreamId},isStreaming:true,messages:[...]}`
2. `GET /api/chat/{chatId}/stream` → expect 200 UI-message stream (`text/event-stream`)

### Variations
- After the run finishes, repeat step 2 → `204` with empty body, and `activeStreamId` is cleared as a side effect.
- Corrupt state check: if the workflow record is gone, step 2 still returns `204` (stale id swallowed).

### Edge Cases
- No auth cookie → `401`, body is the plain text `Not authenticated` (this route uses `format:"text"`, not JSON)
- `GET /api/chat/does-not-exist/stream` → `404` plain text `Chat not found`
- Another user's chat id → `403` plain text `Forbidden`

---

## STORY-chat-loop-03: Stop a runaway answer and keep the partial output

**Type**: short
**Persona**: Devin, who realizes 20 seconds in that he asked the wrong question
**Goal**: Cancel the run without losing the text already produced.
**Preconditions**: An active run exists for `{chatId}` (STORY-01 step 2).
**Ideal path**: 1 call — stop should cancel and persist the partial snapshot in one shot, which it does.
**Alternate paths**: The partial assistant message could instead be persisted with `POST /api/sessions/{sessionId}/chats/{chatId}/messages` and then stopped with an empty body — two calls to the same end state.

### Steps
1. `POST /api/chat/{chatId}/stop` — body: `{"assistantMessage":{"id":"9c2b41ab-8f0e-4d5a-9f34-77b0c1a5e321","role":"assistant","parts":[{"type":"text","text":"Looking at lib/auth/config.ts — the secret is read at module load, so"}]}}` → expect 200 `{"success":true}`
2. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect 200 with `isStreaming:false`, `chat.activeStreamId:null`, and the partial assistant message present in `messages`

### Variations
- Stop with no body at all (`-d ''`) → still 200 `{"success":true}`; nothing persisted.
- Stop when nothing is running → 200 `{"success":true}` (idempotent no-op, returns before touching the workflow).

### Edge Cases
- No auth cookie → `401 {"error":"Not authenticated"}`
- Unknown chat id → `404 {"error":"Chat not found"}`
- Another user's chat → `403 {"error":"Forbidden"}`
- `assistantMessage` missing `parts` array → ignored silently (still 200) — validation failure is not surfaced
- Workflow cancel throws → `500 {"error":"Failed to cancel workflow run"}`

---

## STORY-chat-loop-04: Retry a bad prompt by deleting it and re-asking

**Type**: medium
**Persona**: Devin, who mistyped a file path in his question
**Goal**: Remove the bad user turn plus everything after it, then ask again cleanly.
**Preconditions**: STORY-03 completed — chat has a user message and a (partial) assistant message, nothing streaming.
**Ideal path**: 3 calls — read to find the message id, delete-and-truncate, re-send.
**Alternate paths**: Forking through the prior assistant message (STORY-05) reaches a similar "branch from here" outcome without destroying history — two different routes for "redo from this point".

### Steps
1. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect 200; capture the target user `message.id`
2. `DELETE /api/sessions/{sessionId}/chats/{chatId}/messages/{messageId}` → expect 200 `{"success":true,"deletedMessageIds":["<userId>","<assistantId>"]}`
3. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect 200 with those ids absent from `messages`
4. `POST /api/chat` — body: `{"sessionId":"...","chatId":"...","messages":[{"id":"b41f9d70-2c33-4f80-8b31-6ad0f2c19a55","role":"user","parts":[{"type":"text","text":"Why does apps/web/lib/auth/config.ts throw when BETTER_AUTH_SECRET is unset?"}]}]}` → expect 200 stream with a fresh `x-workflow-run-id`
5. `POST /api/sessions/{sessionId}/chats/{chatId}/read` → expect 200 `{"success":true}`

### Variations
- Delete the very first user message → truncates the whole transcript; the chat row survives.
- If a previous run died without clearing `activeStreamId`, step 2 detects the terminal run, clears the stale id, and proceeds instead of 409-ing.

### Edge Cases
- Delete while a run is genuinely `running`/`pending` → `409 {"error":"Cannot delete messages while a response is streaming"}`
- Target an assistant message id → `400 {"error":"Only user messages can be deleted"}`
- Unknown message id → `404 {"error":"Message not found"}`
- No auth cookie → `401 {"error":"Not authenticated"}`
- Another user's session → `403 {"error":"Forbidden"}`

---

## STORY-chat-loop-05: Fork a chat to explore a second approach

**Type**: medium
**Persona**: Priya, comparing two refactor strategies from the same context
**Goal**: Branch the conversation at a specific assistant answer and continue differently.
**Preconditions**: A chat with at least one completed assistant message (STORY-01/04).
**Ideal path**: 2 calls — fork through a message id, then send on the new chat.
**Alternate paths**: Creating a fresh chat with `POST /api/sessions/{sessionId}/chats` and re-pasting history reaches the same place manually; deleting-and-re-asking (STORY-04) is the destructive sibling.

### Steps
1. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect 200; capture an assistant `message.id`
2. `POST /api/sessions/{sessionId}/chats/{chatId}/fork` — body: `{"messageId":"<assistantMessageId>","id":"c8f1a5b2-7e44-4d90-a1c6-93be0d2f7710"}` → expect 200 `{"chat":{"id":"c8f1a5b2-...","title":"Fork of <source title>","modelId":...,"inferenceProfileId":...,"composioSelection":...}}`
3. `GET /api/sessions/{sessionId}/chats/{forkedChatId}` → expect 200; `messages` contains history up to and including the fork point
4. `POST /api/chat` — body: `{"sessionId":"...","chatId":"<forkedChatId>","messages":[<copied history>,{"id":"1a9c33d4-5f60-4b2e-9d18-2f7c4e6a08bb","role":"user","parts":[{"type":"text","text":"Try the adapter approach instead of the wrapper."}]}]}` → expect 200 stream
5. `GET /api/sessions/{sessionId}/chats` → expect 200 `{chats:[...both chats...],defaultModelId}`

### Variations
- Omit `id` in step 2 → server generates a UUID for the fork.
- Fork the fork: repeat step 2 against `{forkedChatId}`.

### Edge Cases
- Missing/blank `messageId` → `400 {"error":"A messageId is required"}`
- `id` already in use by any chat → `409 {"error":"Chat ID conflict"}`
- `id` present but empty string → `400 {"error":"Invalid chat id"}`
- Fork through a **user** message → `400 {"error":"Only assistant messages can be forked"}`
- Message id not in this chat → `404 {"error":"Message not found"}`
- Malformed JSON → `400 {"error":"Invalid JSON body"}`
- No auth cookie → `401 {"error":"Not authenticated"}`

---

## STORY-chat-loop-06: Two tabs race the same chat

**Type**: short
**Persona**: Priya, who left the session open on her laptop and desktop
**Goal**: Confirm only one workflow ever owns a chat.
**Preconditions**: A chat with no active run.
**Ideal path**: 2 calls — the second send is the whole test.
**Alternate paths**: none found (the `activeStreamId` CAS claim is the single guard, shared by `/api/chat`, stop, stream, message-delete, and strip-reasoning).

### Steps
1. `POST /api/chat` — body: `{"sessionId":"...","chatId":"...","messages":[{"id":"7d0b2e91-4c15-4a77-b0aa-51e9d3c6f204","role":"user","parts":[{"type":"text","text":"Run the test suite and summarize failures."}]}]}` → expect 200 stream, capture `x-workflow-run-id`
2. Immediately, `POST /api/chat` with the **same** body → expect either 200 stream whose `x-workflow-run-id` equals step 1 (resume), or `409 {"error":"Another workflow is already running for this chat"}`

### Variations
- Send a *different* second message while the first is live → same 409/resume branch; the new text is not queued.
- Call `POST /api/chat/{chatId}/stop` between the two sends → step 2 starts a genuinely new run.

### Edge Cases
- 409 body is exactly `{"error":"Another workflow is already running for this chat"}` in both the reconcile and the post-`start()` claim-loss branches.
- Auth failure at step 2 → `401` before any reconciliation runs.

---

## STORY-chat-loop-07: Multi-turn debugging session with tool results

**Type**: long
**Persona**: Marcus, an SRE walking an agent through a real bug over several turns
**Goal**: Hold a real conversation — multiple prompts, tool output persisted between turns, a model switch mid-thread, a stop, and a resume.
**Preconditions**: A repo-backed session (STORY-01 variation with `repoOwner`/`repoName`).
**Ideal path**: ~12 calls — 4 user turns × (send + read-back) plus one model switch, one stop, one reconnect. The extra read-backs exist only because the stream body must be re-fetched as structured messages.
**Alternate paths**: Every "read the transcript" step could equally use the debug bundle (`GET .../debug-bundle`) or the observability feed (`GET /api/sessions/{sessionId}/observability?chatId=...`), both of which re-serve the same messages.

### Steps
1. `GET /api/sessions/{sessionId}/chats` → expect 200 `{chats,defaultModelId}`
2. `POST /api/chat` — body: `{"sessionId":"...","chatId":"...","messages":[{"id":"a1","role":"user","parts":[{"type":"text","text":"The /api/health endpoint 500s in preview. Start by reading app/api/health/route.ts."}]}]}` → expect 200 stream
3. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect 200; assistant message with `tool-*` parts persisted, `isStreaming:false`
4. `POST /api/chat` — messages array = full history from step 3 plus `{"id":"a2","role":"user","parts":[{"type":"text","text":"Yes, run `bun test apps/web/app/api/health` and paste the failure."}]}` → expect 200 stream
5. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect 200; tool results from the bash call persisted
6. `PATCH /api/sessions/{sessionId}/chats/{chatId}` — body: `{"modelId":"anthropic/claude-opus-4.6"}` → expect 200 `{"chat":{...,"modelId":"anthropic/claude-opus-4.6"}}`
7. `POST /api/chat` — history + `{"id":"a3","role":"user","parts":[{"type":"text","text":"Propose a fix and apply it to the route file."}]}` → expect 200 stream; capture `x-workflow-run-id`
8. `POST /api/chat/{chatId}/stop` — body: `{"assistantMessage":{"id":"a4","role":"assistant","parts":[{"type":"text","text":"Editing app/api/health/route.ts to guard the DB probe"}]}}` → expect 200 `{"success":true}`
9. `GET /api/chat/{chatId}/stream` → expect `204` (run cancelled, id cleared)
10. `POST /api/chat` — history + `{"id":"a5","role":"user","parts":[{"type":"text","text":"Actually just add a timeout instead of removing the DB probe."}]}` → expect 200 stream
11. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect 200 full transcript
12. `PATCH /api/sessions/{sessionId}/chats/{chatId}` — body: `{"title":"Health endpoint 500 in preview"}` → expect 200 `{"chat":{...,"title":"Health endpoint 500 in preview"}}`
13. `POST /api/sessions/{sessionId}/chats/{chatId}/read` → expect 200 `{"success":true}`
14. `GET /api/sessions/{sessionId}/diff` → expect 200 `DiffResponse` showing the edited file (409 if the sandbox is not active)

### Variations
- Instead of step 12, `POST /api/generate-title` with `{"message":"The /api/health endpoint 500s in preview"}` → 200 `{"title":"..."}` and then PATCH it — a second route to the same field.
- Swap step 6 for `{"inferenceProfileId":"<profileId>"}` to route the same thread through a custom endpoint.

### Edge Cases
- `PATCH` with an empty body `{}` → `400 {"error":"At least one field is required"}`
- `PATCH` with `{"composioSelection":{"mainProfileId":123}}` → `400 {"error":"Invalid composioSelection"}`
- `PATCH` naming a Composio profile not allowed for the session's repo → `400` with the policy error
- `PATCH` on a deleted chat → `404 {"error":"Chat not found"}`
- Sending in step 10 while step 7's run is still live → `409 {"error":"Another workflow is already running for this chat"}`

---

## STORY-chat-loop-08: Recover from a provider that rejects reasoning history

**Type**: short
**Persona**: Marcus, who switched to a model that refuses replayed thinking blocks
**Goal**: Strip reasoning from the transcript and continue on the new model.
**Preconditions**: A chat containing assistant messages with reasoning parts, no active run (STORY-07).
**Ideal path**: 3 calls — switch model, strip, resend.
**Alternate paths**: Switching back to the original model (`PATCH .../chats/{chatId}` with the old `modelId`) is the documented second recovery for the same failure.

### Steps
1. `PATCH /api/sessions/{sessionId}/chats/{chatId}` — body: `{"modelId":"anthropic/claude-haiku-4.5"}` → expect 200 `{"chat":{...}}`
2. `POST /api/sessions/{sessionId}/chats/{chatId}/strip-reasoning` → expect 200 `{"updatedMessages":[...]}`
3. `POST /api/chat` — body: history (now reasoning-free) + a new user turn → expect 200 stream

### Variations
- Call strip-reasoning twice → second call returns 200 with `updatedMessages` unchanged (idempotent).

### Edge Cases
- Strip while a run is `running`/`pending` → `409 {"error":"Cannot edit this chat while a response is streaming"}`
- Stale `activeStreamId` pointing at a vanished run → strip proceeds normally (200)
- No auth cookie → `401 {"error":"Not authenticated"}`
- Chat belonging to a different session → `404 {"error":"Chat not found"}`

---

## STORY-chat-loop-09: Share a finished conversation publicly, then revoke it

**Type**: medium
**Persona**: Priya, sending a debugging transcript to a teammate who has no account
**Goal**: Publish a read-only link, verify it works logged out, then take it down.
**Preconditions**: A chat with a completed transcript (STORY-07).
**Ideal path**: 2 calls — create the share, hand over the URL. Verification and revocation add the rest.
**Alternate paths**: `POST|DELETE /api/sessions/{sessionId}/share` targets the same intent at session granularity but is deprecated and always returns `410 Gone`. The public markdown route re-serves the same message data already available at `GET /api/sessions/{sessionId}/chats/{chatId}`, and `GET /api/shared/{shareId}/status` re-serves the `isStreaming` bit from that same endpoint.

### Steps
1. `GET /api/sessions/{sessionId}/chats/{chatId}/share` → expect 200 `{"shareId":null}`
2. `POST /api/sessions/{sessionId}/chats/{chatId}/share` → expect 200 `{"shareId":"<12-char nanoid>"}`
3. `POST /api/sessions/{sessionId}/chats/{chatId}/share` again → expect 200 with the **same** `shareId` (idempotent)
4. `GET /api/shared/{shareId}/markdown` **with no cookie**, header `Accept: text/markdown` → expect 200 `text/markdown` with frontmatter and the transcript body
5. `GET /api/shared/{shareId}/status` **with no cookie** → expect 200 `{"isStreaming":false}`
6. `GET /api/sessions/{sessionId}/chats/{chatId}/share` → expect 200 `{"shareId":"<same id>"}`
7. `DELETE /api/sessions/{sessionId}/chats/{chatId}/share` → expect 200 `{"success":true}`
8. `GET /api/shared/{shareId}/markdown` with no cookie → expect `404` plain text `Not found`
9. `GET /api/shared/{shareId}/status` with no cookie → expect `404 {"error":"Not found"}`

### Variations
- Share a chat that is still streaming, then step 5 returns `{"isStreaming":true}`.
- Request `?format=text` on step 4 instead of the `Accept` header.
- Shared markdown redacts env-file content (`redactSharedEnvContent`) — share a chat whose transcript printed a `.env` and confirm the values are masked.

### Edge Cases
- `POST .../share` with no auth cookie → `401 {"error":"Not authenticated"}`
- `POST .../share` on another user's session → `403 {"error":"Forbidden"}`
- `GET /api/shared/never-existed/markdown` → `404` plain text `Not found`
- `POST /api/sessions/{sessionId}/share` (session-level, deprecated) → `410`
- `DELETE .../share` when no share exists → 200 `{"success":true}` (idempotent, no 404)

---

## STORY-chat-loop-10: Multi-chat workspace — create, rename, prune

**Type**: medium
**Persona**: Marcus, running three parallel threads in one session
**Goal**: Manage several chats in a session and delete the ones he's done with.
**Preconditions**: One session with its default chat (STORY-01).
**Ideal path**: 6 calls — 2 creates, 2 renames, 1 delete, 1 list to confirm.
**Alternate paths**: `POST .../chats` with an `id` that already exists in the same session behaves as a GET (idempotent fetch), duplicating `GET .../chats/{chatId}`.

### Steps
1. `POST /api/sessions/{sessionId}/chats` — body: `{"id":"3d9a7c11-6b02-4e55-8f21-0c4a9e7b1d33"}` → expect 200 `{"chat":{"id":"3d9a7c11-...","title":"New chat",...}}`
2. `POST /api/sessions/{sessionId}/chats` — body: `{}` → expect 200 `{"chat":{...}}` with a server-generated nanoid
3. `POST /api/sessions/{sessionId}/chats` — body: `{"id":"3d9a7c11-6b02-4e55-8f21-0c4a9e7b1d33"}` (repeat of 1) → expect 200 with the same chat, not a duplicate
4. `PATCH /api/sessions/{sessionId}/chats/3d9a7c11-...` — body: `{"title":"Migration rollback plan"}` → expect 200 `{"chat":{...,"title":"Migration rollback plan"}}`
5. `GET /api/sessions/{sessionId}/chats` → expect 200 with 3 chats
6. `DELETE /api/sessions/{sessionId}/chats/3d9a7c11-...` → expect 200 `{"success":true}`
7. `GET /api/sessions/{sessionId}/chats` → expect 200 with 2 chats

### Variations
- Delete down to one chat, then try to delete the last one (see edge cases).
- Mark each chat read with `POST .../chats/{chatId}/read` after visiting.

### Edge Cases
- `POST .../chats` with `{"id":""}` → `400 {"error":"Invalid chat id"}`
- `POST .../chats` with an `id` owned by a **different** session → `409 {"error":"Chat ID conflict"}`
- `DELETE` the only remaining chat → `400 {"error":"Cannot delete the only chat in a session"}`
- `DELETE` an already-deleted chat → `404 {"error":"Chat not found"}`
- No auth cookie on any step → `401 {"error":"Not authenticated"}`
- Another user's `sessionId` → `403 {"error":"Forbidden"}`

---

## STORY-chat-loop-11: Client-side assistant message persistence after a dropped connection

**Type**: short
**Persona**: Devin on hotel wifi, whose stream died mid-answer
**Goal**: Push the locally buffered assistant message to the server so the transcript isn't missing a turn.
**Preconditions**: A chat where the client holds a partial assistant message the server never wrote.
**Ideal path**: 1 call — a direct upsert.
**Alternate paths**: `POST /api/chat/{chatId}/stop` with `{assistantMessage}` persists the same message (insert-only) as a side effect of cancelling; `POST /api/chat` also persists inbound assistant messages with tool results. Three routes write the same row.

### Steps
1. `POST /api/sessions/{sessionId}/chats/{chatId}/messages` — body: `{"message":{"id":"e7c4a90b-1d52-4c88-a3f6-2b90de451c07","role":"assistant","parts":[{"type":"text","text":"The migration failed because the unique index already exists on user_email."}]}}` → expect 200 `{"success":true,"status":"inserted"}`
2. Repeat the identical call → expect 200 `{"success":true,"status":"updated"}`
3. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect 200 with that message in `messages`

### Variations
- Include `tool-*` parts in `parts` to exercise tool-result persistence.

### Edge Cases
- `{"message":{"id":"...","role":"user","parts":[]}}` → `400 {"error":"A valid assistant message is required"}`
- `parts` not an array → `400 {"error":"A valid assistant message is required"}`
- Non-JSON body → `400 {"error":"Invalid JSON body"}`
- Message id already owned by a different chat or a different role → `409 {"error":"Message ID already belongs to a different chat or role"}`
- No auth cookie → `401 {"error":"Not authenticated"}`

---

## STORY-chat-loop-12: Full lifecycle — send, share, fork, archive, delete the session

**Type**: long
**Persona**: Priya, wrapping up a piece of work end to end
**Goal**: Take one session from first message to permanently deleted, touching every chat-loop surface.
**Preconditions**: Authenticated test cookie only.
**Ideal path**: ~16 calls — the create/send/stop/fork/share/archive/delete chain with one read-back per state change.
**Alternate paths**: Archiving (`PATCH /api/sessions/{id}` `{"status":"archived"}`) and deleting (`DELETE /api/sessions/{id}`) are two different terminal states reachable for the same "I'm done" intent; the archived list is served by `GET /api/sessions?status=archived`.

### Steps
1. `POST /api/sessions` — body: `{"title":"Rate limiter for /api/chat","sandboxType":"none"}` → expect 200 `{session,chat}`
2. `POST /api/chat` — body: `{"sessionId":"...","chatId":"...","messages":[{"id":"m1","role":"user","parts":[{"type":"text","text":"Sketch a token-bucket rate limiter for the chat route."}]}]}` → expect 200 stream
3. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect 200 transcript
4. `POST /api/chat` — history + `{"id":"m2","role":"user","parts":[{"type":"text","text":"Now show the Redis-backed variant."}]}` → expect 200 stream
5. `POST /api/chat/{chatId}/stop` — body: `{}` → expect 200 `{"success":true}`
6. `GET /api/chat/{chatId}/stream` → expect `204`
7. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect 200; capture an assistant `message.id`
8. `POST /api/sessions/{sessionId}/chats/{chatId}/fork` — body: `{"messageId":"<assistantMessageId>"}` → expect 200 `{"chat":{...,"title":"Fork of ..."}}`
9. `POST /api/chat` — send on the forked chat → expect 200 stream
10. `POST /api/sessions/{sessionId}/chats/{chatId}/share` → expect 200 `{"shareId":"..."}`
11. `GET /api/shared/{shareId}/markdown` with no cookie → expect 200 `text/markdown`
12. `POST /api/sessions/{sessionId}/chats/{chatId}/read` → expect 200 `{"success":true}`
13. `DELETE /api/sessions/{sessionId}/chats/{forkedChatId}` → expect 200 `{"success":true}`
14. `PATCH /api/sessions/{sessionId}` — body: `{"status":"archived"}` → expect 200 `{"session":{...,"status":"archived"}}`
15. `POST /api/chat` on the archived session → expect `400 {"error":"Session is archived"}`
16. `GET /api/sessions?status=archived&limit=20&offset=0` → expect 200 `{sessions,archivedCount,pagination}`
17. `PATCH /api/sessions/{sessionId}` — body: `{"status":"running"}` → expect 200 (unarchive)
18. `DELETE /api/sessions/{sessionId}` → expect 200 `{"success":true}`
19. `GET /api/sessions/{sessionId}` → expect `404 {"error":"Session not found"}`
20. `GET /api/shared/{shareId}/markdown` with no cookie → expect `404` plain text `Not found` (share dies with the chat)

### Variations
- Skip archiving and delete directly — step 18 works from `running`.
- Revoke the share explicitly (`DELETE .../share`) before deleting, to separate the two teardown paths.

### Edge Cases
- `PATCH /api/sessions/{id}` with `{"status":"bogus"}` → `400`
- `DELETE /api/sessions/{id}` twice → second returns `404 {"error":"Session not found"}`
- `GET /api/sessions?status=nonsense` → `400 {"error":"Invalid status filter"}`
- `GET /api/sessions?limit=-1` (archived) → `400 {"error":"Invalid archived limit"}`
- Any step without the auth cookie → `401 {"error":"Not authenticated"}`

---

## Routes exercised

- `POST /api/chat`
- `POST /api/chat/{chatId}/stop`
- `GET /api/chat/{chatId}/stream`
- `GET|POST /api/sessions`
- `GET|PATCH|DELETE /api/sessions/{sessionId}`
- `GET|POST /api/sessions/{sessionId}/chats`
- `GET|PATCH|DELETE /api/sessions/{sessionId}/chats/{chatId}`
- `POST /api/sessions/{sessionId}/chats/{chatId}/messages`
- `DELETE /api/sessions/{sessionId}/chats/{chatId}/messages/{messageId}`
- `POST /api/sessions/{sessionId}/chats/{chatId}/fork`
- `GET|POST|DELETE /api/sessions/{sessionId}/chats/{chatId}/share`
- `POST /api/sessions/{sessionId}/chats/{chatId}/read`
- `POST /api/sessions/{sessionId}/chats/{chatId}/strip-reasoning`
- `POST /api/sessions/{sessionId}/share` (deprecated, 410)
- `GET /api/sessions/{sessionId}/diff`
- `POST /api/generate-title`
- `GET /api/shared/{shareId}/markdown`
- `GET /api/shared/{shareId}/status`
- `GET /api/dev/managed-runtime-demo` (auth bootstrap)
