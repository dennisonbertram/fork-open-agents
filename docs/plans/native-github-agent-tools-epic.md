# Epic: Native GitHub Agent Tools

Prepared: 2026-06-10
Status: planning
GitHub epic issue: https://github.com/dennisonbertram/fork-open-agents/issues/315
Child slices: #316 (Slice A), #317 (Slice B), #318 (Slice C)

## Executive Summary

The agent cannot act on GitHub from inside a session. Two production sessions
exposed the gap:

1. A managed-runtime run asked to "take an issue, mark it in progress, implement
   it on a branch, push, update the issue, mark ready for review." The agent had
   no mechanism to read/edit issues or open PRs from the session, and the
   sandbox had no authenticated write access, so it stalled.
2. A separate run failed with a model-provider auth/credit error, but the UI
   showed the generic "Workspace setup failed. Try again in a moment." — setup
   had actually succeeded; inference failed. The real cause was buried in the
   workflow event timeline.

We will own the GitHub tool surface natively (Octokit + the existing GitHub App
installation token) rather than route it through Composio. The agent should act
as the **GitHub App installation identity** we already mint tokens for — the
same identity that creates branches and PRs today via the app-side commit/PR
path — not as a connected third-party OAuth user.

## Why Own It (vs Composio / MCP)

- **Identity & provenance.** Composio tools execute as the connecting user's
  GitHub OAuth identity. Native tools execute as the GitHub App installation,
  matching the existing auto-commit / auto-PR path
  (`apps/web/lib/github/actions/commit.ts`, `apps/web/lib/chat/auto-pr-direct.ts`).
- **No new infra.** There is zero MCP-client support in the codebase today
  (no `experimental_createMCPClient`, no transports). MCP would mean building a
  client layer first. Native tools reuse `mintInstallationToken` /
  `withScopedInstallationOctokit` (`apps/web/lib/github/app.ts`) that already
  exist and are battle-tested.
- **Server-side execution.** Tool `execute()` runs in the workflow process, not
  the sandbox — exactly like Composio tools merge into
  `webAgent.stream({ tools })`. No `gh` CLI, no token injected into the sandbox.

## Architectural Findings (verified 2026-06-10)

- The agent loop (`webAgent.stream`) runs **server-side** in the workflow
  process (`apps/web/app/workflows/chat.ts`). Only bash/file tools proxy into the
  sandbox via the sandbox RPC; their `execute()` still runs server-side.
- Composio tools resolve at step start
  (`resolveComposioToolsForChat`, `apps/web/lib/composio/session.ts`) and merge
  into the `stream({ tools })` call. A parallel `resolveGitHubToolsForChat`
  follows the same shape.
- **Merge clobber bug to avoid:** the current call passes
  `...(composioTools ? { tools: composioTools } : {})`. Adding a second
  `{ tools: githubTools }` spread would overwrite the first. The merge MUST be
  `tools: { ...composioTools, ...githubTools }`.
- Runtime-mode gating (`getRuntimeModeToolPolicy`, `packages/agent/open-agent.ts`):
  externally-injected tools survive in **classic** and **sandbox-free** modes;
  they are filtered out in **managed_runtime** unless added to
  `MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES`. Decide per-tool which belong to the
  coordinator vs only the executor.
- **No new token scope is required for branch/PR work.** The existing commit path
  already mints `{ contents: "write" }` on-demand and runs `git push` inside the
  sandbox with a temporary token (`github/actions/commit.ts:64,73`). Native PR
  tools use `{ pull_requests: "write" }` server-side via Octokit.

## GitHub App Permission Seam (the slice boundary)

GitHub App `open-agents-dennison` currently grants (verified via
`gh api /apps/open-agents-dennison`):

| Permission        | Level   | Unlocks                                            |
| ----------------- | ------- | -------------------------------------------------- |
| `issues`          | read    | list/read issues + comments                        |
| `pull_requests`   | write   | open PR, draft→ready, comment on PR, request review |
| `contents`        | write   | create branch, push (already on-demand today)      |
| `checks`/`statuses`/`deployments`/`metadata` | read | read PR status/checks |

To create/edit/comment/label/close **issues**, the App needs `issues: write`.
This is a GitHub-side change (App settings → Permissions → re-consent each
installation) that only the owner can perform. It cleanly separates the work:

- **Slice B** ships everything possible with **current** permissions.
- **Slice C** ships issue mutation and is **blocked** until `issues: write` is
  granted and the installation re-consents.

## Gating Model: Explicit Opt-In Per Repo/Session

Decided: GitHub write tools are only injected when the user explicitly opts the
repo/session in. Reuse the `agents` table precedent
(`apps/web/lib/db/schema.ts`): it already has `scope: user_default | repo |
session`, data-defined tool lists (`builtinToolNames`, `composioToolkitSlugs`),
and a per-agent `toolAuthoringEnabled` gate from #242. Add a `githubToolsEnabled`
(and later a granular write toggle) resolved the same way the Composio slugs are
resolved per chat/agent. No new bespoke allowlist mechanism.

## Slices

- **Slice A — Surface provider-auth / out-of-credits failures (bug+regression).**
  Independent of the GitHub work; different subsystem. Map model-provider auth /
  402-credit failures to an actionable chat message instead of "Workspace setup
  failed." Closes the Session-2 complaint.
- **Slice B — GitHub tool foundation + read/branch/PR tools (current perms).**
  `resolveGitHubToolsForChat` factory, merge wiring (clobber fix), runtime-mode
  gating, per-repo/session opt-in gate, and the tools that work today:
  list/read issues, list/read PRs, create_branch, open_pull_request,
  mark_pr_ready_for_review, comment_on_pull_request.
- **Slice C — Issue-mutation tools (blocked on `issues: write`).** create_issue,
  update_issue (body/state), comment_on_issue, set_issue_labels. Depends on B's
  foundation; status:blocked until the App permission flip + re-consent.

## Out Of Scope (epic-wide)

- MCP client infrastructure.
- Composio GitHub toolkit (explicitly not the chosen path).
- Granting the sandbox direct authenticated `gh`/git write beyond the existing
  on-demand temporary-token push.
- Replacing the existing auto-commit / auto-PR server-action path (these tools
  are additive agent capabilities, not a rewrite of that path).

## Related Issues

- #284 — HTTP API routes for the git/GitHub workflow (exposes existing
  server actions over HTTP; orthogonal — not the agent-tool surface).
- #244 — Agents settings epic (the `agents` table this epic gates against).
- #242 — policy-gated agent-authored Composio tools (provenance/gating precedent).
