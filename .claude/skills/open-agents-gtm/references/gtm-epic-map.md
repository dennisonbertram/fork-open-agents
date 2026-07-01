# GTM Epic Map

Use this map to route repo-native GTM work from evidence. Verify live issue/PR
state before claiming current status.

## Epic

- #708 - Agent-first GTM operating system for Open-Agents. Parent epic and
  durable source of the full operating-loop contract.

## Child Issues

- #709 - Domain data model and append-only event ledger.
  - Code areas: `apps/web/lib/db/schema.ts`, `apps/web/lib/gtm/*`.
  - Protects: durable GTM state, redaction, append-only events, approvals.
- #710 - Daily GTM brief and read-only Chief of Staff snapshot.
  - Code areas: `apps/web/lib/gtm-coordinator/*`,
    `apps/web/app/api/gtm/brief`, `apps/web/app/api/gtm/diagnosis`.
  - Protects: evidence-backed daily status and bounded diagnosis.
- #711 - Target account and contact research briefs.
  - Code areas: `apps/web/lib/gtm-research/*`,
    `apps/web/app/api/gtm/research/runs`.
  - Protects: cited facts, unknown/private-fact handling, draft signals.
- #712 - Approval-gated outbound drafting and sending.
  - Code areas: `apps/web/lib/gtm-outbound/*`,
    `apps/web/app/api/gtm/outbound/drafts`.
  - Protects: draft-first outbound and no external sends without approval.
- #713 - Founder call prep and debrief workflow.
  - Code areas: `apps/web/lib/gtm-call/*`,
    `apps/web/app/api/gtm/calls/prep`,
    `apps/web/app/api/gtm/calls/debrief`.
  - Protects: prep briefs, debrief insights, approval-gated follow-up.
- #714 - Activation watcher and product-signal issue drafting.
  - Code areas: `apps/web/lib/gtm-activation/*`,
    `apps/web/app/api/gtm/activation/signals`.
  - Protects: private activation signals and approval-gated issue drafts.
- #715 - Weekly experiment review and compounding learning loop.
  - Code areas: `apps/web/lib/gtm-weekly-review/*`,
    `apps/web/app/api/gtm/weekly-review`.
  - Protects: weekly reviews, source gaps, deduped approved learnings.
- #716 - Repo-bundled GTM chat skill for Claude Code and agents.
  - Code areas: `.claude/skills/open-agents-gtm/*`,
    `.agents/skills/open-agents-gtm/*`.
  - Protects: evidence-backed repo-native GTM chat and approval routing.

## Status Questions

For "what is implemented?", inspect code and merged PRs before answering. The
issue body may lag the worktree or GitHub PR state.

For "what should I do next?", combine:

- Current daily brief or weekly review API output when available.
- Open PR/check state in `dennisonbertram/fork-open-agents`.
- Open source gaps from route responses or GTM events.
- Approval queue entries in `gtm_approvals`.

Never infer external CRM/email/GitHub mutation success from local draft rows.
