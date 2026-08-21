# Learnings — security hygiene fanout (#1392–#1402)

## Incorrect assumptions

- A single mega-branch/PR would be reviewable. Watchdog review needs one PR per issue; a mixed diff makes scope checks forensic.
- Concurrent agents sharing `/workspace` can steal the checkout mid-commit (empty #1395 push). Prefer `best-of-n-runner` worktrees or finish/commit before spawning peers on the same tree.
- Mega-commit pathspecs (`packages/agent/src/...`) do not match this repo (`packages/agent/tools/...`).

## What worked

- Extract patches from mega commit into `/tmp/issue-patches/*/full.patch`, then re-apply onto fresh `origin/develop` branches.
- Keep DNS pin (#1393) and unattended write gate (#1394) as separate PRs even though both touch `fetch.ts`.
- Red→green commits on #1396/#1398/#1399/#1400/#1401 make TDD audit mechanical.
