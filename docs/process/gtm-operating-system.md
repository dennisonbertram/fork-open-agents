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
- `GET /api/gtm/activation/signals` returns the private activation signal queue.
- `POST /api/gtm/activation/signals` runs the activation watcher on supplied
  source snapshots and creates draft signals plus pending issue approvals.

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
- `activation.watcher.scanned`
- `activation.signal.created`
- `activation.signal.deduped`
- `activation.issue_draft.created`
- `activation.issue_file.blocked_without_approval`

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

Activation watcher signals are private operator records. GitHub issue bodies are
stored only as redacted drafts behind `activation_issue_draft_file` approvals;
no public GitHub issue is created by the watcher path.

## Debug Recipes

- Reconstruct one operation: query `gtm_events` by `request_id`.
- Reconstruct one GTM run: query `gtm_events` by `gtm_agent_run_id`.
- Reconstruct one entity timeline: query `gtm_events` by
  `user_id`, `entity_kind`, and `entity_id`.
- Explain an incomplete daily brief: inspect `sourceStatus` in
  `/api/gtm/brief`, then inspect source-specific events by `requestId`.
