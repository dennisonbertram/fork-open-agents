---
name: open-agents-gtm
description: Use when answering Open-Agents GTM questions, planning GTM work, routing account research, outbound, calls, activation, weekly review, or repo-native GTM status from evidence.
---

# Open-Agents GTM

Use this skill when the user asks about Open-Agents GTM strategy, status,
implementation, account research, outbound, call prep/debrief, activation
signals, weekly experiment review, or the GTM epic/issues.

## First Reads

Read only the files needed for the request:

- `docs/process/gtm-operating-system.md`
- `docs/process/feature-ticket-format.md`
- `docs/process/observability-discipline.md`
- `docs/process/development-workflow.md`
- `docs/process/github-build-process.md`
- `references/gtm-epic-map.md`
- `references/approval-boundaries.md`
- `references/status-brief-template.md`

When the request depends on live GitHub state, verify the current fork issue or
PR before answering. Start with #708, then the relevant child issue #709-#716.

## Operating Rules

- Separate confirmed repo/runtime evidence from planned or unbuilt surfaces.
- Use source-gap language when GitHub, database, API, or runtime evidence is
  missing, stale, or inaccessible.
- Do not rely on memory for issue status, PR status, deployment state, or recent
  implementation state; verify it first.
- Preserve approval boundaries for email, CRM, sequence enrollment, public
  GitHub issue filing, and durable GTM learning persistence.
- Never paste raw secrets, OAuth tokens, auth headers, private contact details,
  full email bodies, full transcripts, or raw CRM notes into final answers,
  logs, issues, PR bodies, or prompt artifacts.

## Routing

Use this routing map:

- Daily GTM status or "what should I do today" -> #710, `/api/gtm/brief`,
  `/api/gtm/diagnosis`, `docs/process/gtm-operating-system.md`, then the status
  brief template.
- Account/contact research -> #711, `apps/web/lib/gtm-research/*`, and
  `POST /api/gtm/research/runs`.
- Outbound drafts or sending -> #712, `apps/web/lib/gtm-outbound/*`, and the
  approval boundary reference.
- Call prep or debrief -> #713, `apps/web/lib/gtm-call/*`, and call
  prep/debrief routes.
- Activation or product-signal triage -> #714,
  `apps/web/lib/gtm-activation/*`, activation routes, and GitHub issue approval
  boundaries.
- Weekly experiments or compounding learnings -> #715,
  `apps/web/lib/gtm-weekly-review/*`, weekly-review routes, and active GTM
  learning context.
- Repo-bundled skill or GTM chat behavior -> #716 and this skill.
- New implementation work -> feature-ticket format, behavior-first TDD,
  observability discipline, and the GitHub build process.

## Answer Shape

For read-only GTM answers, keep the response short and evidence-backed:

1. What is confirmed.
2. What is missing or source-gapped.
3. Recommended next action.
4. Evidence used.

For implementation requests, create or identify the issue first, name the
protected path, write failing tests before implementation, and preserve the work
in a branch, commit, pushed PR, and verification notes.

For unsafe mutation requests, say the action requires approval and produce a
draft or plan instead of performing the mutation.
