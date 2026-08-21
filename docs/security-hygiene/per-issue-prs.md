# Security hygiene: one PR per issue (#1392–#1402)

Watchdog request: branch from `origin/develop`, open separate PRs into `develop` so per-issue diff review is mechanical (see `docs/process/dogfood-cloud-fanout.md`).

## Ready for watchdog review

| Issue | Branch | PR | Scope |
| --- | --- | --- | --- |
| #1392 | `cursor/fix-1392-sessions-patch-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1404 | Strict Zod sessions PATCH allowlist |
| #1393 | `cursor/fix-1393-fetch-dns-pin-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1407 | Fetch DNS `--resolve` pin / fail-closed |
| #1394 | `cursor/fix-1394-unattended-fetch-writes-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1406 | Unattended mutating fetch approval |
| #1397 | `cursor/fix-1397-chat-composio-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1405 | Chat 30/min RL + Composio sanitize |
| #1402 (partial) | `cursor/fix-1402-cron-containment-b536` | https://github.com/dennisonbertram/fork-open-agents/pull/1408 | Timing-safe cron auth + grep/glob/bash containment |

Mega-batch https://github.com/dennisonbertram/fork-open-agents/pull/1403 is **superseded** — do not merge.

## Still to land (separate PRs)

- #1395 sandbox leaks / stop latch / archive handle
- #1396 BG sweeper CAS / catch-up / heartbeat
- #1398 test-auth fail-closed + `TEST_AUTH_SECRET`
- #1399 hibernation TOCTOU + prewarm orphan
- #1400 DB indexes + retention job
- #1401 explorer RO bash / worker policy / wrapper approvals
- #1402 remainder: `.env.example`, Drizzle journal repair, purge `JWE_SECRET`

## Watchdog checklist (per PR)

- Whole diff vs issue assigned files only
- Red-before-green when claimed; mutation-check where cheap
- Guards through real entry points + allow paths
- Local `bun --bun run ci` + `git diff --check` (pre-push runs check/typecheck)
- Observability events as named in the issue
