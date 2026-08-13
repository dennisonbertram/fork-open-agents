# Fable round 3 — disposition of Codex round 2

Author: Claude Fable 5 (final say). Date: 2026-08-11. Input:
codex-round2.md (NOT-YET, 8 items; all round-1 trims and reversals
accepted). Kimi is at CONSENSUS: YES as of kimi-round2.md.

## Disposition — all 8 accepted, one with a note

| # | Codex item | Disposition |
|---|---|---|
| 1 | Inline tool contracts into prd.md §7.3 | ACCEPT — my own precedence rule violated by my own reference. The complete 10-tool table + v1 additions are now inline and declared the sole definition. |
| 2 | During-execution kill must restart-and-complete | ACCEPT. prd.md §10 M2b and spike-plan M2b now state: typed terminal outcomes on the during-execution barrier fail the unattended gate; they remain acceptable only for unrecoverable injected faults. |
| 3 | Disposable Worker-side write + post-provider-success fault | ACCEPT. Added to M2b: one comment-or-PR write on the fixture repo, fault after provider success before ledger ack, reconciliation must return the same provider object id. The "unrecoverable duplicate effects" no-go is now exercised, not assumed. |
| 4 | Static-token gate performs real ops + refusal matrix | ACCEPT. M4a: Codex CLI performs `create_worker` → `get_worker_status` and passes expired/denied-scope/foreign-worker/revoked. |
| 5 | Full-chain latency benchmark post-M2a/M3 | ACCEPT. Added to M3: hibernated-worker→final-answer benchmark per the M0 method, feeding the decision gate; M1/M3 phase numbers are inputs, not substitutes. |
| 6 | Split story 16; story 20 to v1 | ACCEPT with a note. Story 16 split (spike: list/stop/audit; v1: archive/destroy). Story 20 moves to v1 as a product story; the spike environment keeps a hard concurrency/spend ceiling as an operational guard against runaway autonomous fan-out — an ops setting, not a product feature, and not a test target. |
| 7 | Cost go-gating explicit; swap non-gating | ACCEPT. prd.md §10 M5 row now says exactly this; the go row lists the swap study with M4b as informs-not-gates. |
| 8 | run_id identity defined | ACCEPT. prd.md §7.1: `run_id` **is** the Workflow instance id (`${workerId}-turn-${seq}`); `requestId` is per-MCP-request, N:1 onto turns; AI Gateway metadata carries run_id only on provider-backed turns. |

No new scope was introduced by any item; #3 adds one test to an existing
milestone and directly exercises an auto-return-to-fork condition.

## State of consensus

- Kimi: YES (round 2).
- Codex: round-3 verification requested on these 8 deltas.
- Fable: YES — the spec now carries every accepted finding from all three
  reviewers with no open disputes.
