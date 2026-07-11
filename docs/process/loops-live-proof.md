# Agent Loops Live Proof

## Purpose

`loops:journey-proof` is the first automated end-to-end proof of the agent
loops journey: create a loop, confirm it starts in `draft`, activate it, run
it now, watch it reach a terminal status, and clean up — all runnable
against local, preview, or production without a browser. It is the sibling
of `background-agents:journey-proof` (see
[Background Agents Live Proof](background-agents-live-proof.md)'s "Full
Journey Proof" section) for agent loops, mirroring its shape and evidence
discipline. See GitHub issue #865 and epic #857.

Unlike background agents, loops previously had no equivalent proof harness
at all — the only prior proof came from one-off `ux-walker` browser walks
(epic #761), which are not wired into CI or a schedule.

## Safety Rules

- Use a disposable repository only. `LOOP_JOURNEY_PROOF_REPO_OWNER` /
  `LOOP_JOURNEY_PROOF_REPO_NAME` have **no default** — never point them at a
  real repo.
- In production proof, set `AGENT_LOOPS_ALLOWED_REPOS` to the disposable repo
  **before** setting `AGENT_LOOPS_ENABLED=true`.
- Missing, blank, malformed, or mixed wildcard/list values deny all loop
  dispatch. Exact `*` is the only allow-all value; treat it as an explicit
  high-risk operator override, not a setup shortcut.
- Never paste secrets, cookies, or auth headers into issues, PRs, screenshots,
  shell logs, or chat.
- Rollback: set `AGENT_LOOPS_ENABLED=false`.
- **Load-bearing warning**: the loop step's clone token always carries
  `contents:write` (the baseline enforced by `token-permissions.ts`), even
  though this harness's step only requests read permissions and its
  instructions forbid writes. The step is inert by instruction, not by
  capability. This is exactly why the disposable-repo rule above is
  non-negotiable — never relax it to "a real repo, but the step won't write
  anything."

## Prerequisites

- `AGENT_LOOPS_ENABLED=true` in the target environment.
- `AGENT_LOOPS_ALLOWED_REPOS` includes the disposable repo (dispatch is
  gated on this allowlist independently of `AGENT_LOOPS_ENABLED`).
- Loop-bound `webhook.error` triggers use the shared background-agent webhook
  surface and are intentionally double-gated: `BACKGROUND_AGENTS_ALLOWED_REPOS`
  must also include the repo. The readiness response reports this as separate
  `shared_webhook_allowlist` and `shared_webhook_repo_access` checks so it does
  not imply that schedules or manual starts use the background policy.
- An authenticated session cookie for the target environment (e.g.
  `open_agents_test_user_id=<user>` for a test-auth user, or a real Better
  Auth session cookie).
- Optional precheck: `GET /api/agent-loops/readiness?owner=<owner>&repo=<repo>`
  to confirm repo-scoped readiness before firing the journey.

## Usage

```bash
LOOP_JOURNEY_PROOF_BASE_URL=https://<target-host> \
LOOP_JOURNEY_PROOF_COOKIE='<authenticated-session-cookie>' \
LOOP_JOURNEY_PROOF_REPO_OWNER=<disposable-repo-owner> \
LOOP_JOURNEY_PROOF_REPO_NAME=<disposable-repo-name> \
bun run --cwd apps/web loops:journey-proof
```

Env vars:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `LOOP_JOURNEY_PROOF_BASE_URL` | yes | — | http(s) target origin |
| `LOOP_JOURNEY_PROOF_COOKIE` | yes | — | authenticated session cookie |
| `LOOP_JOURNEY_PROOF_REPO_OWNER` | yes | — | disposable repo owner; **no default — never point this at a real/production repo** |
| `LOOP_JOURNEY_PROOF_REPO_NAME` | yes | — | disposable repo name |
| `LOOP_JOURNEY_PROOF_TIMEOUT_MS` | no | `1200000` (20 min) | run-completion timeout. Deliberately larger than the loop's own `maxRunDurationMs`/`stepTimeoutMs` (see below) so a guardrail-terminated run reaches a typed terminal status inside the harness window rather than the harness itself timing out first. Sandbox provisioning inside a step has been observed to take 6+ minutes before the first turn. |
| `LOOP_JOURNEY_PROOF_POLL_MS` | no | `2000` | poll interval |
| `LOOP_JOURNEY_PROOF_REQUIRE_SUCCEEDED` | no | `false` | fail unless the run status is `completed` |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | no | — | preview protection bypass |

## Journey Definition

The harness does not use a template — `apps/web/app/loops/loop-templates.ts`
(the actual template file; note the loops `lib/agent-loops/` directory holds
no templates) is UI-layer code, and epic #761 found some shipped templates
had broken steps (`refFrom` path resolution, a forbidden `gh pr create`
instruction) at the time. The harness instead builds an inline, inert
definition:

- `start` (kind `start`) → `report` (kind `agent_step`, `when: "always"`)
  → `end` (kind `end`, `when: "success"`).
- `report`'s instructions: "Journey proof: reply with a one-sentence status
  report confirming you can see the repository. Do not modify any files,
  branches, PRs, or issues. Do not run any write commands." Permissions:
  `{ github: { contents: "read" } }` only — no write scopes, no
  `composioToolkitSlugs`.
- Deliberately no failure edge from `report` — a failed step yields a typed
  `failed` run (still terminal proof), never a masked success.

Explicit guardrails (for deterministic, turn-bounded termination):

```json
{
  "maxStepsPerRun": 5,
  "maxIterations": 1,
  "maxRunDurationMs": 1080000,
  "stepTimeoutMs": 900000,
  "maxAgentTurnsPerStep": 4
}
```

`stepTimeoutMs` (15 min) covers observed sandbox provisioning (6+ min) plus
1-2 turns; `maxAgentTurnsPerStep` (4) guarantees turn-bounded termination
even if the step never converges.

## Hard-deadline semantics

A run that has not reached a terminal status (`completed`, `failed`,
`cancelled`, or `stalled`) by `LOOP_JOURNEY_PROOF_TIMEOUT_MS` is a journey
**FAILURE** — "still running" or "still paused" never reads as success, even
with the default `REQUIRE_SUCCEEDED=false`. Cleanup is still attempted after
any failure.

## Cleanup-warning semantics

Cleanup (`cleanupLoop`) runs in a `finally` block regardless of the
journey's outcome: `DELETE /api/agent-loops/[loopId]`, then a follow-up
`GET /api/agent-loops/[loopId]` that must return exactly `404` (a `200` —
still exists — or any other error counts as cleanup failure, mirroring
#864's absence-check semantics). If the journey passed but cleanup failed,
the harness prints a loud `WARNING: cleanup failed — manually delete loop
<loopId> (...)` line and sets `"cleanup":"failed"` in the final
`journey-summary` JSON line; this is **not** a failure exit (exit code stays
`0`). If the journey itself failed AND cleanup failed, the process exits `1`
and both failures are reported.

## Leak-detection debug recipe

"Did the last journey-proof run leak a loop?":
`GET /api/agent-loops?repoOwner=<disposable-owner>&repoName=<disposable-repo>`
against the target and look for stale `"Loop journey proof <ISO timestamp>"`
rows older than the harness's own timeout.

## Decisions recorded for issue #865

- **Poll route**: `GET /api/agent-loop-runs/[runId]` is the single poll
  target — it returns `{ run, loop, steps, events, watchdogRuns }` and is
  ownership-scoped (404 for non-owned/missing runs). The harness does NOT
  list-and-filter `GET /api/agent-loops/[loopId]/runs`.
- **DELETE cascade**: confirmed clean in `apps/web/lib/db/schema.ts` —
  `agent_loop_runs.loop_id`, `agent_loop_step_runs.loop_run_id`,
  `agent_loop_events.loop_run_id`, `agent_loop_watchdog_runs.loop_run_id`,
  and `background_agent_triggers.loop_id` all cascade on delete. No
  pre-deletion of runs/steps/events is needed; `deleteAgentLoop` is a
  single ownership-scoped DELETE.
- `dispatch_failed` (502) is a hard journey failure, as is
  `turn_budget_exceeded` on the run or any step.
- Terminal set: `completed`, `failed`, `cancelled`, `stalled`. Non-terminal:
  `queued`, `running`, `paused`.
- Script/package names are fixed by the issue:
  `apps/web/scripts/agent-loop-journey-proof.ts` /
  `loops:journey-proof` (not `agent-loops:journey-proof`).

## Post-release production check (doc-only; CI wiring is #866)

Wiring this harness into `authenticated-production-canary.yml` or any other
workflow is explicitly out of scope for issue #865 (that's #866). This
section is a manual, doc-only procedure for running the harness against
production after a release.

Safety preconditions before running against production:

1. `AGENT_LOOPS_ALLOWED_REPOS` pinned to the disposable repo in production.
2. `AGENT_LOOPS_ENABLED=true` in production (only after step 1).
3. A disposable production test identity's session cookie — never a real
   user's cookie.

```bash
LOOP_JOURNEY_PROOF_BASE_URL=https://<production-host> \
LOOP_JOURNEY_PROOF_COOKIE='<disposable-production-test-identity-cookie>' \
LOOP_JOURNEY_PROOF_REPO_OWNER=<disposable-repo-owner> \
LOOP_JOURNEY_PROOF_REPO_NAME=<disposable-repo-name> \
bun run --cwd apps/web loops:journey-proof
```

### Note for #866

The harness accepts any base URL (plus the optional
`VERCEL_AUTOMATION_BYPASS_SECRET`), exactly like
`background-agents:journey-proof`, so a canary workflow can pass
`github.event.deployment_status.target_url` straight through as
`LOOP_JOURNEY_PROOF_BASE_URL` without any change to this script.
