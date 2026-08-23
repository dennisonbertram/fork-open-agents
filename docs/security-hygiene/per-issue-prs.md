# Security hygiene: one PR per issue (#1392–#1402)

Watchdog request: branch from `origin/develop`, open separate PRs into `develop` so per-issue diff review is mechanical (see `docs/process/dogfood-cloud-fanout.md`).

## Ready for watchdog review

| Issue | Branch | PR | Notes |
| --- | --- | --- | --- |
| #1392 | `cursor/fix-1392-sessions-patch-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1404 | Strict Zod sessions PATCH |
| #1393 | `cursor/fix-1393-fetch-dns-pin-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1407 | Fetch DNS `--resolve` pin |
| #1394 | `cursor/fix-1394-unattended-fetch-writes-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1406 | Unattended mutating fetch approval |
| #1395 | `cursor/fix-1395-sandbox-lifecycle-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1413 | Stop-on-failure / latch / archive handle |
| #1396 | `cursor/fix-1396-bg-sweeper-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1410 | Sweeper CAS / catch-up / heartbeat (red→green) |
| #1397 | `cursor/fix-1397-chat-composio-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1405 | Chat RL + Composio sanitize |
| #1398 | `cursor/fix-1398-test-auth-failclosed-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1411 | Fail-closed test auth + secret (red→green) |
| #1399 | `cursor/fix-1399-hibernate-prewarm-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1412 | Hibernation recheck + prewarm state-first |
| #1400 | `cursor/feat-1400-db-indexes-retention-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1415 | Indexes + retention job |
| #1401 | `cursor/feat-1401-tool-policy-harden-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1414 | Explorer RO / worker policy / wrappers |
| #1402 (partial) | `cursor/fix-1402-cron-containment-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1408 | Timing-safe cron + grep/glob/bash containment |
| #1402 (remainder) | `cursor/fix-1402-journal-env-jwe-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1416 | Journal idxs + `.env.example` + purge `JWE_SECRET` |

Index PR: https://github.com/dennisonbertram/fork-open-agents/pull/1409

Mega-batch https://github.com/dennisonbertram/fork-open-agents/pull/1403 is **superseded** — do not merge.

## #1402 status

Both #1402 slices are open as separate PRs (#1408 containment, remainder journal/env/JWE). No further #1402 work pending unless review finds gaps.

## Watchdog checklist (per PR)

- Whole diff vs issue assigned files only
- Red-before-green when claimed on branch; mutation-check where cheap
- Guards through real entry points + allow paths
- Local `bun --bun run ci` + `git diff --check` (pre-push runs check/typecheck; full `ci` not re-run on every branch in this batch — re-run locally before merge)
- Observability events as named in the issue
