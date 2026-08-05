# UX Paths — GTM Coordinator Suite

API surface covered (all under `apps/web/app/api/gtm/**`, all `requireAuthenticatedUser`):

- `GET /api/gtm/brief`
- `GET /api/gtm/diagnosis`
- `POST /api/gtm/research/runs`
- `POST /api/gtm/calls/prep`
- `POST /api/gtm/calls/debrief`
- `POST /api/gtm/outbound/drafts`
- `PATCH /api/gtm/approvals/{approvalId}`
- `GET /api/gtm/activation/signals`, `POST /api/gtm/activation/signals`
- `GET /api/gtm/weekly-review`, `POST /api/gtm/weekly-review`

Cross-topic redundancy noted in the stories: `/api/gtm/brief` and `/api/account/status`
are two windowed snapshot endpoints with the same query contract; `/api/gtm/diagnosis`
and `/api/account/diagnosis` are two diagnosis endpoints differing only in the allowed
`source` enum. Four separate producers (outbound drafts, activation watcher, call
debrief, weekly review) all mint approvals that are only decidable through the single
`PATCH /api/gtm/approvals/{approvalId}` route, and each producer also returns the
approval ids inline — so approval ids are readable from at least five places.

All requests below assume a browser session cookie (`-b cookies.txt`). Every route
returns `401` from `requireAuthenticatedUser` when the cookie is missing.

---

## STORY-gtm-01: Founder checks the morning GTM brief

**Type**: short
**Persona**: Solo founder running sales themselves
**Goal**: See what changed in GTM over the last day before standup
**Preconditions**: Authenticated session. Snapshot is DB-backed and returns an empty-but-valid shape for a fresh account, so no seed data required.
**Ideal path**: 1 call — a windowed snapshot is a single read.
**Alternate paths**: `GET /api/account/status?window=24h` returns the parallel platform-side snapshot with the same `window` query contract; the two are separate routes with overlapping purpose (redundancy signal).

### Steps
1. `GET /api/gtm/brief?window=24h` → expect `200` snapshot object (account work, product shipments, inbound, distribution, audience sections)
2. `GET /api/gtm/brief` (no query, defaults) → expect `200` same snapshot shape

### Variations
- `?window=1h` (minimum) and `?window=168h` (maximum) both `200`.

### Edge Cases
- No session cookie → `401`.
- `?window=169h` → `400` `{error:"Invalid window", errorKind:"invalid_window", supportedFormat:"1h through 168h"}` (`MAX_WINDOW_HOURS` check).
- `?window=24` (missing `h`) → `400` `invalid_window`.
- `?window=0h` → `400` `invalid_window` (hours must be > 0).

---

## STORY-gtm-02: Drill into one GTM work item from the brief

**Type**: short
**Persona**: Founder triaging a stalled account
**Goal**: Get the detailed diagnosis behind a single brief row
**Preconditions**: STORY-gtm-01 ran and returned at least one item id; otherwise use a known account id.
**Ideal path**: 2 calls — brief to find the id, diagnosis to expand it.
**Alternate paths**: `GET /api/account/diagnosis?source=session&id=...` is a second diagnosis endpoint with identical query shape and a different `source` enum (`session|chat_workflow|background_agent|agent_loop`) — same data-shaping concern split across two routes.

### Steps
1. `GET /api/gtm/brief?window=72h` → expect `200`, pick an id from `accountWork`
2. `GET /api/gtm/diagnosis?source=account_work&id=<idFromStep1>&limit=25` → expect `200` diagnosis object

### Variations
- `source=product_shipments`, `inbound`, `distribution`, `audience` — all `200` for owned ids.
- Omit `limit` → `200` (limit is optional).

### Edge Cases
- No session cookie → `401`.
- `source=crm` → `400` `{error:"Invalid source", supportedSources:[...]}`.
- Missing `id` → `400` `{error:"Missing id"}`.
- `limit=0` or `limit=101` or `limit=abc` → `400` `errorKind:"invalid_diagnosis_limit"`, `supportedRange:"1 through 100"`.
- `id=00000000-0000-0000-0000-000000000000` (not owned / nonexistent) → `404` `{error:"GTM item not found"}`.

---

## STORY-gtm-03: Research an inbound account and get a cited brief

**Type**: short
**Persona**: Founder prepping on a company that just signed up
**Goal**: Turn raw findings into a brief where only cited claims survive
**Preconditions**: Authenticated session. No account record needed — `accountName` works without `accountId`.
**Ideal path**: 1 call — the brief is derived server-side from the claims payload.
**Alternate paths**: none found (research runs have no GET listing route; the resulting run is only visible again through `GET /api/gtm/brief` / `GET /api/gtm/diagnosis`).

### Steps
1. `POST /api/gtm/research/runs` — body:
   ```json
   {
     "accountName": "Northwind Logistics",
     "contactName": "Priya Raman",
     "claims": [
       { "text": "Migrated their dispatch service to Next.js in Q1", "evidenceRefs": [{ "kind": "url", "ref": "https://northwind.example/blog/dispatch-rewrite" }] },
       { "text": "Hiring two platform engineers in Berlin", "evidenceRefs": [{ "kind": "url", "ref": "https://northwind.example/careers" }] },
       { "text": "Their CTO is unhappy with their current CI vendor", "privateFact": true },
       { "text": "Probably spending six figures on tooling" }
     ],
     "openQuestions": ["Who owns the CI budget?"],
     "nextSteps": ["Ask Priya for a 20-minute technical call"]
   }
   ```
   → expect `201` `{runId, brief:{citedFacts, unknownClaims, openQuestions, nextSteps, signalCandidates}, signalIds}`; the last two claims land in `unknownClaims` with reasons `private_fact_unverified` and `missing_required_citation`

### Variations
- Send `accountId` + `contactId` instead of names to attach the run to existing records.
- Empty `claims: []` → `201` with an empty brief.

### Edge Cases
- No session cookie → `401`.
- Malformed JSON body → `400` `errorKind:"invalid_research_input"`.
- `claims: [{"note":"no text field"}]` → `400` "Research claims must include string text fields." `invalid_research_input`.
- `accountId` belonging to another user → `403` `errorKind:"cross_user_reference"`.

---

## STORY-gtm-04: Prep for a discovery call

**Type**: short
**Persona**: Founder 30 minutes before a customer call
**Goal**: Generate a concise call brief with risks and questions
**Preconditions**: STORY-gtm-03 (optional) for research context; not required.
**Ideal path**: 1 call — the brief is synthesized from the posted objective and context.
**Alternate paths**: none found.

### Steps
1. `POST /api/gtm/calls/prep` — body:
   ```json
   {
     "founderObjective": "Confirm Northwind will run a two-week pilot on the platform team",
     "knownContext": ["Migrated dispatch to Next.js in Q1", "Two platform hires open in Berlin"],
     "openLoops": ["No answer yet on security review timeline"],
     "desiredOutcome": "Written agreement to start the pilot on the 14th",
     "evidenceRefs": [{ "kind": "url", "ref": "https://northwind.example/blog/dispatch-rewrite" }]
   }
   ```
   → expect `201` `{callId, runId, brief:{objective, conciseBrief, risks, openLoops, suggestedQuestions, desiredOutcome, sourceCount}}`

### Variations
- Omit `desiredOutcome` and `evidenceRefs` → `201`, `sourceCount` falls back to `knownContext.length`.

### Edge Cases
- No session cookie → `401`.
- `founderObjective: ""` or whitespace-only → `400` `errorKind:"invalid_call_input"` ("Call prep requires a founder objective.").
- Malformed JSON → `400` `invalid_call_input`.
- `contactId` from another user → `403` `cross_user_reference`.

---

## STORY-gtm-05: Debrief the call and approve the follow-up it proposes

**Type**: medium
**Persona**: Founder right after the call ends
**Goal**: Capture notes, get structured next steps, and release the proposed follow-up
**Preconditions**: STORY-gtm-04 created a `callId`.
**Ideal path**: 3 calls — debrief, decide the approval it created, confirm state via brief. Currently matches, because the debrief returns `approvalIds` inline.
**Alternate paths**: The approval ids returned here are also decidable through the same `PATCH /api/gtm/approvals/{approvalId}` used by outbound, activation, and weekly review — one decision route, four producers.

### Steps
1. `POST /api/gtm/calls/debrief` — body:
   ```json
   {
     "callId": "<callId from STORY-gtm-04>",
     "notes": "Priya confirmed the pilot. Pushback on SSO not being available on the team plan. Asked for audit log export before security review. Wants to start the 14th.",
     "attendees": ["Priya Raman", "Tomas Vogel"],
     "evidenceRefs": [{ "kind": "note", "ref": "call-2026-08-02" }]
   }
   ```
   → expect `201` `{callId, runId, debrief:{summary, sentiment, attendees, nextSteps, objections, productAsks, followUpDraft, proposedActions}, insightIds, approvalIds}`
2. `PATCH /api/gtm/approvals/<approvalIds[0]>` — body: `{"decision":"approved"}` → expect `200` `{approvalId, status:"approved", targetKind, targetId, actionKind, decidedAt}`
3. `GET /api/gtm/diagnosis?source=account_work&id=<targetId from step 2>` → expect `200` diagnosis reflecting the decided approval
4. `GET /api/gtm/brief?window=24h` → expect `200` with the debrief run visible in the window

### Variations
- Send `accountId`/`contactId` instead of `callId` to debrief an unprepped call.
- `{"decision":"denied"}` in step 2 → `200` `status:"denied"`.

### Edge Cases
- No session cookie on any step → `401`.
- `notes: ""` → `400` `invalid_call_input`.
- Oversized transcript in `notes` → `400` `errorKind:"transcript_too_large"`.
- `callId` owned by another user → `403` `cross_user_reference`.
- Repeating step 2 on the same approval → `409` `errorKind:"approval_already_decided"`.
- `PATCH /api/gtm/approvals/does-not-exist` → `404` `errorKind:"approval_not_found"`.
- `{"decision":"maybe"}` → `400` "Approval decision must be approved or denied." `invalid_approval_input`.

---

## STORY-gtm-06: Draft outbound email and hold it behind the approval gate

**Type**: medium
**Persona**: Founder sending the post-call follow-up
**Goal**: Stage an email that cannot leave the system until explicitly approved
**Preconditions**: STORY-gtm-05 produced the follow-up content.
**Ideal path**: 2 calls — create draft, approve it. The draft always returns `status:"pending_approval"` plus the `approvalId`, so no lookup call is needed.
**Alternate paths**: none found for creating outbound; the approval decision shares `PATCH /api/gtm/approvals/{approvalId}` with every other producer.

### Steps
1. `POST /api/gtm/outbound/drafts` — body:
   ```json
   {
     "actionKind": "email_send",
     "subject": "Pilot kickoff on the 14th + audit log export",
     "body": "Priya — thanks for the time today. Confirming the two-week pilot starting the 14th. I'm attaching the audit log export doc your security review asked for. SSO on the team plan is on our roadmap; I'll follow up with a date this week.",
     "summary": "Post-discovery follow-up confirming pilot dates",
     "recipientHash": "sha256:9f2c1ab4c0d5e6f78901a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7",
     "recipientDomain": "northwind.example",
     "allowedDomains": ["northwind.example"],
     "evidenceRefs": [{ "kind": "note", "ref": "call-2026-08-02" }],
     "metadata": { "callId": "<callId from STORY-gtm-04>" }
   }
   ```
   → expect `201` `{touchpointId, approvalId, status:"pending_approval", policy:{actionKind:"email_send", requiresApproval:true, externalMutationAllowed:false, reason:"pending_approval", policySnapshot}}`
2. `PATCH /api/gtm/approvals/<approvalId>` — body: `{"decision":"approved"}` → expect `200` `status:"approved"`

### Variations
- `actionKind` values `email_create_draft`, `crm_note_create`, `crm_contact_update`, `crm_sequence_enroll` all → `201`, all with `requiresApproval:true`.
- Omit `actionKind` entirely → server defaults to `email_send` (an unknown string also silently defaults to `email_send` rather than erroring — worth flagging).
- Omit `recipientDomain` or send `allowedDomains: []` → policy treats the domain as allowed (`reason:"pending_approval"`).

### Edge Cases
- No session cookie → `401`.
- `recipientDomain:"gmail.example"` with `allowedDomains:["northwind.example"]` → `201` but `policy.reason:"domain_not_allowed"` and `externalMutationAllowed:false`; approving it in step 2 still returns `200` while the policy snapshot keeps the block.
- Malformed JSON → `400` `errorKind:"invalid_outbound_input"`.
- `accountId` from another user → `403` `cross_user_reference`.
- Approving the same `approvalId` twice → `409` `approval_already_decided`.

---

## STORY-gtm-07: Run the activation watcher over at-risk signups

**Type**: medium
**Persona**: Founder reviewing why new signups aren't activating
**Goal**: Classify signup telemetry into activation signals with drafted interventions
**Preconditions**: Authenticated session. Candidate rows are supplied in the request body (hashed user ids), not read from the platform automatically.
**Ideal path**: 2 calls — run the watcher, list the resulting queue. Currently matches.
**Alternate paths**: `GET /api/gtm/activation/signals` and the `POST` response both return signal ids; the same signals also surface inside `GET /api/gtm/brief` under the audience/inbound sections (same data, three readers).

### Steps
1. `GET /api/gtm/activation/signals` → expect `200` `{signals: []}` (baseline)
2. `POST /api/gtm/activation/signals` — body:
   ```json
   {
     "candidates": [
       { "targetUserHash": "sha256:11a4...c9", "signedUpAt": "2026-07-28T09:12:00.000Z", "githubInstalled": false, "sessionCount": 0 },
       { "targetUserHash": "sha256:22b5...d1", "signedUpAt": "2026-07-25T14:02:00.000Z", "githubInstalled": true, "sessionCount": 6, "failureCount": 5 },
       { "targetUserHash": "sha256:33c6...e2", "githubInstalled": true, "sessionCount": 3, "objectionText": "We can't use this until it supports self-hosted GitLab." },
       { "targetUserHash": "sha256:44d7...f3", "githubInstalled": true, "sessionCount": 12, "featureRequestText": "Please add per-repo spend limits." }
     ]
   }
   ```
   → expect `201` `{runId, signalIds, approvalIds, dedupedCount:0}` with signal types `github_not_installed`, `repeated_session_failure`, `explicit_objection`, `product_request`
3. `GET /api/gtm/activation/signals` → expect `200` `{signals:[{signalId, approvalId?, signalType, severity, summary, evidenceRefs, metadata, updatedAt}, ...]}`
4. `PATCH /api/gtm/approvals/<approvalIds[0]>` — body: `{"decision":"approved"}` → expect `200` `status:"approved"`
5. `POST /api/gtm/activation/signals` — replay the identical body from step 2 → expect `201` with `dedupedCount:4` and no new signal ids (dedup by `dedupSignature`)

### Variations
- `{"candidates": []}` → `201` with empty `signalIds`.
- A candidate with only `targetUserHash` and no telemetry → classifier may emit nothing; `201` regardless.

### Edge Cases
- No session cookie → `401`.
- Malformed JSON → `400` `errorKind:"invalid_signal_input"`.
- Candidates missing `targetUserHash` are silently filtered out by the route before classification (no error) — a validation gap worth flagging.
- Omitting `candidates` entirely → `201` with zero signals rather than a `400`.

---

## STORY-gtm-08: Deny an activation intervention

**Type**: short
**Persona**: Founder who disagrees with a proposed nudge
**Goal**: Reject the drafted intervention so it never fires
**Preconditions**: STORY-gtm-07 step 2 created `approvalIds`.
**Ideal path**: 2 calls — list the queue, deny the approval.
**Alternate paths**: The approval id is also available from the POST response of STORY-gtm-07 (so a well-informed client needs only 1 call) — the same identifier is returned by two endpoints.

### Steps
1. `GET /api/gtm/activation/signals` → expect `200`, pick an item with an `approvalId`
2. `PATCH /api/gtm/approvals/<approvalId>` — body: `{"decision":"denied"}` → expect `200` `{approvalId, status:"denied", targetKind, targetId, actionKind, decidedAt}`
3. `GET /api/gtm/activation/signals` → expect `200` with the item's approval no longer pending

### Edge Cases
- No session cookie → `401`.
- Body `{}` (no `decision`) → `400` `invalid_approval_input`.
- Body is a JSON array → `400` `invalid_approval_input`.
- Deny then approve the same id → second call `409` `approval_already_decided`.

---

## STORY-gtm-09: Weekly review — approve, deny, and merge learnings

**Type**: medium
**Persona**: Founder closing out the GTM week
**Goal**: Convert the week's experiments into durable learnings under an approval gate
**Preconditions**: GTM experiments/touchpoints exist inside the window (created by STORY-gtm-03 through STORY-gtm-07). A fresh account returns `status:"partial"` or `"blocked"` with `sourceGaps`.
**Ideal path**: 3 calls — dry run to see candidates, re-run with decisions, list active learnings. The API needs two POSTs because decisions reference `candidateKey`s that only exist after the first run.
**Alternate paths**: `GET /api/gtm/weekly-review` returns the active learnings; the same learnings also appear as context inside `GET /api/gtm/brief` (duplicate read path).

### Steps
1. `GET /api/gtm/weekly-review` → expect `200` `{learnings: []}` (baseline)
2. `POST /api/gtm/weekly-review` — body: `{"weekStart":"2026-07-27","weekEnd":"2026-08-03","approvals":[]}` → expect `201` `{reviewRunId, status, experimentSummaries, sourceGaps, nextBets, learningCandidates, approvalIds, persistedLearningIds, dedupedCount}`; note each candidate's `candidateKey`
3. `POST /api/gtm/weekly-review` — body:
   ```json
   {
     "weekStart": "2026-07-27",
     "weekEnd": "2026-08-03",
     "approvals": [
       { "candidateKey": "<key A>", "decision": "approved" },
       { "candidateKey": "<key B>", "decision": "denied" },
       { "candidateKey": "<key C>", "decision": "merge" }
     ]
   }
   ```
   → expect `201` with `persistedLearningIds` non-empty for the approved key, the merged key carrying `existingLearningId`, and `dedupedCount` incremented
4. `GET /api/gtm/weekly-review` → expect `200` `{learnings:[{learningId, title, summary, confidence, sourceId, evidenceRefs, updatedAt}]}`
5. `GET /api/gtm/brief?window=168h` → expect `200` snapshot reflecting the completed review run

### Variations
- Only `"approved"`, `"denied"`, `"merge"` pass the route's filter; any other decision string is silently dropped from the approvals array (not a `400`).
- `status:"partial"` with populated `sourceGaps` when metrics or qualitative sources are missing — still `201`.

### Edge Cases
- No session cookie → `401`.
- Malformed JSON → `400` `errorKind:"invalid_review_window"`.
- `weekStart` == `weekEnd`, or `weekStart` after `weekEnd` → `400` `invalid_review_window`.
- `{"weekStart":"last monday","weekEnd":"today"}` → `400` `invalid_review_window`.
- Missing `weekStart`/`weekEnd` → `400` `invalid_review_window` (route coerces non-strings to `""`).

---

## STORY-gtm-10: Full account cycle — research to signed pilot

**Type**: long
**Persona**: Founder working one enterprise opportunity end to end over a week
**Goal**: Take an inbound account from cold research to an approved outbound follow-up and a recorded learning
**Preconditions**: Authenticated session only. This story creates all its own state.
**Ideal path**: 12 calls — research, prep, debrief, 2 approvals, 2 outbound drafts, 2 approvals, weekly review dry run, weekly review with decisions, final brief. The extra reads below exist because no route returns a consolidated "account timeline".
**Alternate paths**: Verification reads are duplicated across `GET /api/gtm/brief` and `GET /api/gtm/diagnosis`; `/api/account/status` and `/api/account/diagnosis` mirror both again on the platform side.

### Steps
1. `GET /api/gtm/brief?window=168h` → expect `200` baseline snapshot
2. `POST /api/gtm/research/runs` — body: `{"accountName":"Northwind Logistics","contactName":"Priya Raman","claims":[{"text":"Migrated dispatch to Next.js in Q1","evidenceRefs":[{"kind":"url","ref":"https://northwind.example/blog/dispatch-rewrite"}]},{"text":"Two platform roles open in Berlin","evidenceRefs":[{"kind":"url","ref":"https://northwind.example/careers"}]}],"openQuestions":["Who owns the CI budget?"],"nextSteps":["Book a 20-minute technical call"]}` → expect `201`, capture `runId`, `signalIds`
3. `POST /api/gtm/calls/prep` — body: `{"founderObjective":"Book a two-week pilot with the platform team","knownContext":["Migrated dispatch to Next.js in Q1","Two platform roles open in Berlin"],"openLoops":["Security review timeline unknown"],"desiredOutcome":"Pilot start date agreed"}` → expect `201`, capture `callId`
4. `POST /api/gtm/calls/debrief` — body: `{"callId":"<callId>","notes":"Priya confirmed the pilot pending security review. Objection: no SSO on the team plan. Asked for audit log export.","attendees":["Priya Raman","Tomas Vogel"]}` → expect `201`, capture `approvalIds`, `insightIds`
5. `PATCH /api/gtm/approvals/<approvalIds[0]>` — body: `{"decision":"approved"}` → expect `200` `status:"approved"`
6. `POST /api/gtm/outbound/drafts` — body: `{"actionKind":"email_send","subject":"Audit log export + pilot dates","body":"Priya — attaching the audit log export doc for your security review, and confirming the pilot window.","recipientDomain":"northwind.example","allowedDomains":["northwind.example"],"metadata":{"callId":"<callId>"}}` → expect `201`, capture `approvalId` (call it `outboundApproval1`)
7. `PATCH /api/gtm/approvals/<outboundApproval1>` — body: `{"decision":"approved"}` → expect `200`
8. `POST /api/gtm/outbound/drafts` — body: `{"actionKind":"crm_note_create","subject":"Northwind pilot — security review dependency","body":"Pilot start blocked on security review; audit log export sent 2026-08-02.","summary":"CRM note after discovery call","allowedDomains":["northwind.example"]}` → expect `201`, capture `approvalId` (call it `crmApproval`)
9. `PATCH /api/gtm/approvals/<crmApproval>` — body: `{"decision":"approved"}` → expect `200`
10. `POST /api/gtm/activation/signals` — body: `{"candidates":[{"targetUserHash":"sha256:11a4...c9","githubInstalled":true,"sessionCount":4,"objectionText":"No SSO on the team plan."}]}` → expect `201` with an `explicit_objection` signal
11. `GET /api/gtm/activation/signals` → expect `200` with that signal in the queue
12. `GET /api/gtm/diagnosis?source=account_work&id=<runId from step 2>&limit=50` → expect `200` diagnosis showing the research run, call, and outbound touchpoints
13. `POST /api/gtm/weekly-review` — body: `{"weekStart":"2026-07-27","weekEnd":"2026-08-03","approvals":[]}` → expect `201`, capture `learningCandidates[].candidateKey`
14. `POST /api/gtm/weekly-review` — body: `{"weekStart":"2026-07-27","weekEnd":"2026-08-03","approvals":[{"candidateKey":"<key>","decision":"approved"}]}` → expect `201` with `persistedLearningIds` non-empty
15. `GET /api/gtm/weekly-review` → expect `200` `{learnings:[...]}` including the new learning
16. `GET /api/gtm/brief?window=168h` → expect `200` snapshot showing the week's runs, touchpoints, and signals

### Variations
- Substitute step 6's `actionKind` with `crm_sequence_enroll` to exercise the sequence path (still `201`, still approval-gated).
- Run steps 13–14 with `"decision":"merge"` to fold the learning into an existing one.

### Edge Cases
- Any step without the session cookie → `401`.
- Step 5/7/9 replayed → `409` `approval_already_decided`.
- Step 12 with an id from a different user → `404` `GTM item not found` (ownership is enforced as not-found, not 403, on the diagnosis path — inconsistent with the 403 `cross_user_reference` used by the write routes).
- Step 6 with `recipientDomain:"personal-gmail.example"` while `allowedDomains:["northwind.example"]` → `201` with `policy.reason:"domain_not_allowed"`.

---

## STORY-gtm-11: Multi-turn approval negotiation across a single opportunity

**Type**: long
**Persona**: Founder and their GTM coordinator agent going back and forth over an afternoon
**Goal**: Iterate on an outbound message through several rejected drafts until one is approved
**Preconditions**: STORY-gtm-04 created a `callId`; STORY-gtm-05 recorded the debrief.
**Ideal path**: 6 calls — three draft/decide pairs. There is no route to revise an existing draft, so every iteration mints a new touchpoint and a new approval (redundancy/friction signal).
**Alternate paths**: none found — outbound drafts are create-only; there is no `PATCH /api/gtm/outbound/drafts/{id}` and no listing route.

### Steps
1. `POST /api/gtm/outbound/drafts` — body: `{"actionKind":"email_send","subject":"Following up","body":"Hi Priya, just checking in on the pilot. Let me know when you have a moment.","recipientDomain":"northwind.example","allowedDomains":["northwind.example"],"metadata":{"iteration":1}}` → expect `201`, capture `approvalId` (draft 1)
2. `PATCH /api/gtm/approvals/<draft1 approvalId>` — body: `{"decision":"denied"}` → expect `200` `status:"denied"` (too vague)
3. `POST /api/gtm/outbound/drafts` — body: `{"actionKind":"email_send","subject":"Audit log export for your security review","body":"Priya — here's the audit log export doc your security team asked for. Can we hold the 14th for the pilot start?","recipientDomain":"northwind.example","allowedDomains":["northwind.example"],"evidenceRefs":[{"kind":"note","ref":"call-2026-08-02"}],"metadata":{"iteration":2}}` → expect `201`, capture `approvalId` (draft 2)
4. `PATCH /api/gtm/approvals/<draft2 approvalId>` — body: `{"decision":"denied"}` → expect `200` (still missing the SSO answer)
5. `POST /api/gtm/outbound/drafts` — body: `{"actionKind":"email_send","subject":"Audit log export + SSO timeline + pilot on the 14th","body":"Priya — three things: (1) audit log export doc attached for security review, (2) SSO on the team plan ships in Q4, I'll send the changelog entry when it lands, (3) holding the 14th for the pilot start unless I hear otherwise.","summary":"Third revision; addresses SSO objection explicitly","recipientDomain":"northwind.example","allowedDomains":["northwind.example"],"evidenceRefs":[{"kind":"note","ref":"call-2026-08-02"}],"metadata":{"iteration":3,"callId":"<callId>"}}` → expect `201`, capture `approvalId` (draft 3)
6. `PATCH /api/gtm/approvals/<draft3 approvalId>` — body: `{"decision":"approved"}` → expect `200` `status:"approved"`
7. `POST /api/gtm/calls/debrief` — body: `{"callId":"<callId>","notes":"Sent revised follow-up after three drafts. SSO objection addressed with Q4 date. Pilot held for the 14th.","attendees":["Priya Raman"]}` → expect `201` with new `approvalIds`
8. `PATCH /api/gtm/approvals/<new approvalIds[0]>` — body: `{"decision":"approved"}` → expect `200`
9. `GET /api/gtm/diagnosis?source=account_work&id=<callId>&limit=50` → expect `200` showing all three touchpoints and their decisions
10. `GET /api/gtm/brief?window=24h` → expect `200` reflecting the full afternoon's activity

### Variations
- Approve draft 2 instead and skip 5–6 (7 total calls).
- Use `actionKind:"email_create_draft"` throughout so nothing can send even after approval.

### Edge Cases
- Re-deny draft 1 in step 2 → `409` `approval_already_decided`.
- Step 5 with `body:""` → `201` (the route coerces a missing/non-string body to `""` and does not reject it) — a validation gap.
- Any step without the session cookie → `401`.
- Step 9 with a `callId` from another user → `404`.

---

## STORY-gtm-12: Cold-start account with no GTM data

**Type**: short
**Persona**: New user who just enabled the GTM surface
**Goal**: Confirm every GTM read returns a usable empty state rather than an error
**Preconditions**: Fresh authenticated account with no GTM records.
**Ideal path**: 4 calls — one per read surface. A single consolidated GTM read endpoint would make this 1 call.
**Alternate paths**: `GET /api/account/status` covers the platform half of this same empty-state check.

### Steps
1. `GET /api/gtm/brief?window=24h` → expect `200` snapshot with empty sections
2. `GET /api/gtm/activation/signals` → expect `200` `{signals: []}`
3. `GET /api/gtm/weekly-review` → expect `200` `{learnings: []}`
4. `POST /api/gtm/weekly-review` — body: `{"weekStart":"2026-07-27","weekEnd":"2026-08-03","approvals":[]}` → expect `201` with `status:"partial"` or `"blocked"` and populated `sourceGaps`

### Edge Cases
- All four without a session cookie → `401`.
- `GET /api/gtm/diagnosis?source=account_work&id=anything` on an empty account → `404` `GTM item not found`.
- Step 4 with a window in the future → `201` with empty `experimentSummaries` (no error).
