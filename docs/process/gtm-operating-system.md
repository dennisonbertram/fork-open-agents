# GTM Operating System

The GTM operating-system foundation is intentionally agent-first and
approval-gated. Open-Agents owns durable GTM state and treats CRM, email,
analytics, and GitHub as bounded integrations behind explicit approval policy.

## Current Surfaces

- `apps/web/lib/db/schema.ts` defines user-scoped GTM tables for accounts,
  contacts, signals, experiments, touchpoints, insights, GTM agent runs,
  approvals, and append-only events.
- `apps/web/lib/gtm/*` contains the typed event vocabulary, redaction helpers,
  and transaction-scoped store helpers.
- `apps/web/lib/gtm-outbound/*` contains the approval policy and local
  outbound draft persistence boundary. It may create local touchpoints and
  pending approval rows, but it must not call email, CRM, or sequence tools.
- `apps/web/lib/gtm-call/*` contains the call prep/debrief extraction and
  persistence boundary. It creates local call artifacts, draft insights, and
  pending approvals before any record update can be applied.
- `apps/web/lib/gtm-activation/*` contains the private activation watcher
  classifier, dedupe logic, issue-draft preview, and approval boundary.
- `GET /api/gtm/brief?window=24h` returns the read-only daily GTM brief.
- `GET /api/gtm/diagnosis?source=account_work&id=...` returns bounded evidence
  for a single GTM item.
- `POST /api/gtm/research/runs` creates a deterministic, draft-first account
  research run from cited manual, CRM, or public evidence. It persists draft GTM
  signals and rejects uncited or unverified private claims instead of guessing.
- `POST /api/gtm/outbound/drafts` creates a local outbound touchpoint and a
  pending approval request for the requested external action.
- `POST /api/gtm/calls/prep` creates a local call-prep brief artifact.
- `POST /api/gtm/calls/debrief` ingests notes into a redacted debrief, draft
  insights, and pending approvals for follow-up or GTM record updates.
- `GET /api/gtm/activation/signals` returns the private activation signal queue.
- `POST /api/gtm/activation/signals` runs the activation watcher on supplied
  source snapshots and creates draft signals plus pending issue approvals.
- `GET /api/gtm/weekly-review` returns active, approved GTM learnings for
  future GTM agent context.
- `POST /api/gtm/weekly-review` reviews completed experiments in a supplied
  week, reports source gaps, proposes next bets, extracts learning candidates,
  requests approvals, and persists only approved/deduped GTM learnings.
- `/gtm/weekly-review` provides the founder-facing weekly review surface for
  the same experiment table, metric summary, source gaps, next bets, learning
  candidates, and approved-learning context.

## Event Vocabulary

Initial `gtm_events.event_name` values:

- `gtm.account.created`
- `gtm.contact.upserted`
- `gtm.signal.recorded`
- `gtm.experiment.created`
- `gtm.touchpoint.recorded`
- `gtm.insight.recorded`
- `gtm.agent_run.started`
- `gtm.agent_run.completed`
- `gtm.agent_run.failed`
- `gtm.approval.requested`
- `gtm.approval.decided`
- `gtm.call_brief.created`
- `gtm.call_notes.ingested`
- `gtm.call_debrief.extracted`
- `gtm.call_action.proposed`
- `gtm.call_action.approved`
- `gtm.call_action.rejected`
- `gtm.call_action.applied`
- `gtm.call_action.failed`
- `activation.watcher.scanned`
- `activation.signal.created`
- `activation.signal.deduped`
- `activation.issue_draft.created`
- `activation.issue_file.blocked_without_approval`
- `weekly_review.started`
- `weekly_review.experiment_summarized`
- `weekly_review.source_gap_detected`
- `weekly_review.learning_candidate_extracted`
- `weekly_review.learning_redaction_blocked`
- `weekly_review.learning_deduped`
- `weekly_review.learning_approval_requested`
- `weekly_review.learning_persisted`
- `weekly_review.completed`
- `weekly_review.failed`

Each event must include `userId`, `requestId`, `entityKind`, `entityId`,
`status`, `level`, and `redactionStatus`. Optional correlation fields are
`sessionId`, `chatId`, `workflowRunId`, and `gtmAgentRunId`.

## Redaction

Do not persist raw tokens, prompt/session content, full email bodies, full call
transcripts, private CRM notes, or customer contact details in event payloads.
Use stable entity IDs, hashes, bounded summaries, and evidence references.

The `gtm` module redacts sensitive payload keys such as `email`, `phone`,
`body`, `note`, `prompt`, `transcript`, `token`, `secret`, `stdout`, and
`stderr` before ledger persistence.

## Approval Boundary

GTM rows may store local drafts and proposed changes. Any external mutation,
including email sends, CRM writes, sequence enrollment, or GitHub issue filing,
must create a pending GTM approval first. A denied or expired approval must not
call the external tool.

Research runs create local draft signals only. Promoting a research finding to
active, writing to CRM, sending outbound, or filing a public issue remains a
separate approval-gated action.

Outbound actions covered by the first policy surface are `email_create_draft`,
`email_send`, `crm_note_create`, `crm_contact_update`, and
`crm_sequence_enroll`. The outbound API returns `pending_approval` and records
`gtm.touchpoint.recorded` plus `gtm.approval.requested` events before any
external system is eligible to mutate.

Call prep/debrief actions create local call artifacts and draft insights only.
Follow-up creation, CRM/GTM record updates, and insight promotion remain pending
approval until an explicit approval decision is recorded.

Activation watcher signals are private operator records. GitHub issue bodies are
stored only as redacted drafts behind `activation_issue_draft_file` approvals;
no public GitHub issue is created by the watcher path.

Weekly reviews treat GTM learnings as durable context, so persistence is also
approval-gated. Without an approval decision, the review creates
`gtm_learning_persist` approval rows and leaves candidates pending. Approved
candidates write active `gtm_insights` rows with
`createdBy = "gtm_weekly_review_agent"`. Duplicate candidates merge into the
existing insight by deterministic `dedupSignature` instead of creating noisy
context. Secret-looking candidate text is blocked before approval or insight
persistence.

## Debug Recipes

- Reconstruct one operation: query `gtm_events` by `request_id`.
- Reconstruct one GTM run: query `gtm_events` by `gtm_agent_run_id`.
- Reconstruct one entity timeline: query `gtm_events` by
  `user_id`, `entity_kind`, and `entity_id`.
- Explain an incomplete daily brief: inspect `sourceStatus` in
  `/api/gtm/brief`, then inspect source-specific events by `requestId`.
- Explain a weekly review source gap: inspect
  `weekly_review.source_gap_detected` events by `gtmAgentRunId`, `sourceKind`,
  and `errorKind`.
- Explain why a learning was not persisted: inspect
  `weekly_review.learning_redaction_blocked`,
  `weekly_review.learning_approval_requested`, and
  `weekly_review.learning_deduped` events by candidate key or review run.
