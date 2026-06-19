# Topic: Tool Approval Workflow

The headline mobile interaction — `MobileToolApprovalBar` (Approve/Deny) when an agent is blocked on an approval-gated tool.

## STORY-APPR-1: Cautious Migration Approval
**Type**: medium · **Persona**: Backend engineer · **Goal**: Safely approve a DB migration · **Preconditions**: agent hits `db:migrate:apply`.
### Steps
1. Tool arrives "approval-requested"; header → "Waiting"; composer disabled.
2. Bar pins above composer: ShieldAlert, "Approval needed", tool name "bash" (via getToolName).
3. Read the inline tool card (its own Approve/Deny suppressed via activeApprovalId).
4. Tap Approve → `addToolApprovalResponse({id, approved:true})`; bar clears; header → "Working".
### Edge Cases
- Network error → toast "Couldn't approve the action — please try again."; bar stays. Sequential approvals update the bar each time.
- NOTE: the bar shows the tool NAME, not the raw command args — review the full command in the inline thread card.

## STORY-APPR-2: Quick File-Write Approval
**Type**: short · **Persona**: Frontend dev · **Goal**: Keep momentum on a non-destructive write.
### Steps
1. `tool-write` → bar shows "write".
2. Glance at inline card (creating `src/components/Button.tsx`).
3. Approve → resumes; send follow-up "Now add hover styles".
### Edge Cases
- Two writes queued → bar shows the most recent pending only.

## STORY-APPR-3: Deny and Pivot
**Type**: medium · **Persona**: DevOps · **Goal**: Block a risky firewall change and redirect.
### Steps
1. `tool-bash` firewall command → bar "bash".
2. Realize it could lock SSH; tap Deny (destructive) → `{approved:false}`; inline card shows "Denied".
3. Send "Add a connectivity safety check"; agent revises; new bar; Approve the safer variant.
### Edge Cases
- `approval.reason` → inline shows "Denied: …". Race if stream hasn't fully stopped.

## STORY-APPR-4: Nested Approval Sequence
**Type**: long · **Persona**: Full-stack, CI/CD · **Goal**: Step through dependent approvals (lint → test → build → push → PR).
### Steps
1-9. Approve each `bash` step in turn; the final `dynamic-tool` "github-create-pr" → verify PR title inline → Approve. Header cycles Working ↔ Ready.
### Variations
- Deny the push step → agent suggests a draft PR. Close app mid-sequence → pending approval no longer active on return.

## STORY-APPR-5: Recovery After Interruption
**Type**: medium · **Persona**: Data analyst · **Goal**: Resume an interrupted approval.
### Steps
1. `tool-read` → bar "read".
2. Tap back to Activity; row shows "Waiting on you".
3. Re-open the session → bar still present (persisted state).
4. Approve → file reads + summary; chat returns idle.
### Edge Cases
- Timed-out stream → inline shows "Interrupted" (yellow). Opening a different session loses prior approval context.

## STORY-APPR-6: Rapid Deny and Retry
**Type**: short · **Persona**: Impatient dev · **Goal**: Reject quickly to try a faster approach.
### Steps
1. `tool-grep` → Deny without fully reading.
2. Send "Use ripgrep"; agent emits `bash rg …`; Approve.
### Edge Cases
- Repeated denials may signal a misunderstanding. Deny-then-send race while denial in flight.

## STORY-APPR-7: Long Tool-Name Truncation
**Type**: short · **Persona**: Ops · **Goal**: Identify a verbose tool despite truncation.
### Steps
1. `dynamic-tool` long name → bar truncates with CSS truncate.
2. Scroll the inline card to read the full name + inputs.
3. Return to bar → Approve.
### Edge Cases
- Very narrow phones truncate more aggressively.

## STORY-APPR-8: Approval Under Network Latency
**Type**: medium · **Persona**: Junior dev, slow 3G · **Goal**: Approve while the network is slow.
### Steps
1. `tool-write` → Approve; request takes ~2s.
2. Bar stays pinned until success; on timeout, toast → retry.
### Edge Cases
- Double-tap Approve → server dedupe prevents double execution.

## STORY-APPR-9: Approval Chain with Mixed Tool Types
**Type**: long · **Persona**: Full-stack refactor · **Goal**: Navigate read/write/bash/skill approvals in one session.
### Steps
1. Approve read → write (review diff) → bash test → `dynamic-tool` deploy.
2. Header cycles Working/Ready; "Great, the refactor is live!"
### Edge Cases
- Unknown tool type → DefaultRenderer "…" generic summary.

## STORY-APPR-10: Denial with Explicit Reason
**Type**: medium · **Persona**: Security engineer · **Goal**: Block a tool and explain why.
### Steps
1. `tool-bash` fetching unmasked secrets → Deny (bar has no reason field).
2. Send "Use the SECRETS_MANAGER env var instead".
3. Agent emits a safer `bash`; Approve.
### Edge Cases
- Reason arriving before denial is processed (race). `approval.reason` shown inline if set.
