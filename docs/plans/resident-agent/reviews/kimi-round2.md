• Reading all four files now.

• Now reading my round-1 audit and Fable's round-1 standing guard to verify against the consolidation.

• All four files plus my round-1 audit and Fable's standing guard are read. Verification below.

  ## Six flip-to-YES changes — all landed

  1. **Single binding document with precedence.** `prd.md` header (lines 3–8) declares itself binding and names `spike-plan.md` subordinate; `spike-plan.md` line 3 declares itself subordinate; `reviews/README.md` carries the precedence header demoting all review docs to historical record. The divergence-generator is closed. ✓

  2. **Pre-M0 provisioning milestone, founder named decider, register fixed.** `prd.md` §10 has the P0 row ("Nothing else starts until P0 completes") and §11 is a clean register keyed by blocking milestone — P0 items (account/billing, API token, domain/DNS, IdP, GitHub App, Anthropic key, budgets) all carry "decider: founder." `spike-plan.md` P0 section matches item-for-item. The "not blocking M0" mislabel is gone. ✓

  3. **M0 contract artifacts first + untouchable deterministic evaluator.** `prd.md` §9.1: "The evaluator is deterministic, lives in a protected path implementing agents cannot edit, and derives verdicts only from ledger evidence." §10 M0 row and `spike-plan.md` M0 items 1–4 name the ledger schema, barrier names, fingerprint method, and require the evaluator to demonstrably catch a deliberately corrupted bundle. The founder's evidence-over-narration rule now has a build-time mechanism. ✓

  4. **Fixture pinned as M2a entry criterion + plural reconciliation.** `prd.md` §9.4 names all six pins (repo, commit, patch, test outcome, final digest, oracle-green-before-change) and resolves the one-fixture-vs-real-sample-projects conflict exactly as required: one pinned fixture for the spike, ≥2 real sample projects at v1 acceptance. `spike-plan.md` M2a references §9.4 rather than paraphrasing it — correct subordination. ✓

  5. **MCP/OAuth pinning + static-token ownership.** `prd.md` §7.2 pins revision 2026-07-28, the exact CIMD metadata (`client_id_metadata_document_supported: true`, `"none"` in `token_endpoint_auth_methods_supported`), RFC 8707 enforcement; §7.4 pins the progress cadence against the 5-minute idle window; §7.2 assigns static-token design as an M0 work item, owner: front-door epic. Two agents can no longer serve different discovery documents. ✓

  6. **Measured-window revocation + M3 platform traps.** `prd.md` §7.2 rewrites revocation acceptance as measured-window with the KV-consistency flag; story 2's acceptance criterion matches; §9.6 puts backup-GC and the `mksquashfs` 0600/0700 test in M3 pass criteria; §10 M3 row and `spike-plan.md` M3 carry both. The Workflow instance-ID convention (`${workerId}-turn-${seq}`, ≤100 chars) is pinned in §7.1. ✓

  ## Round-1 §1 items

  - Fan-out demo not a go-gate: §10 "M4b — Product shape (evidence, not gate)" and "Cloudflare go … M4b informs, does not gate." ✓
  - Story 30 trimmed: "S(trimmed) … No retention machinery in the spike"; §4 non-goal matches. ✓
  - Kill criterion recalibrated: `spike-plan.md` header — M0+M1 by end of week 1, M4a *attempted* with blockers recorded as evidence, provisioning delay recorded not fatal. ✓
  - Gate-client swap: `spike-plan.md` M4a gates Claude Code (OAuth) + Codex CLI (static bearer, explicitly "so it cannot ship as an inert guard"); ChatGPT web/mobile demoted to canaries. ✓
  - Jurisdiction blocking M1: §8 Security ("TBD before M1 … DO placement is permanent") + §11 register. ✓

  ## New contradictions between prd.md and spike-plan.md

  One minor inconsistency, not blocking: `prd.md` §9.6 assigns the container stdout→observability probe to "M2/M3 … before reliance," while `spike-plan.md` M0 item 6 runs it at M0. Earlier-than-required still satisfies "before reliance," so the intent is preserved, but the milestone tags disagree and an autonomous builder reconciling the two could file it either way. Also note M4a's scheduled window (days 6–8) sits at the week-1/week-2 boundary where the kill criterion expects it "attempted" — workable given the provisioning-delay carve-out, but tight. Neither warrants a flip; flagging for the record.

  ## Dropped load-bearing research

  I checked the traps my audit relied on: workers-sdk #12998 probe, HTTPS-interception parity probe, cloudflare/agents#1829 orphan-CLI reference, BYOK `default`-alias check, the 2026-08-07 `env.AI` unification re-verify, deprecated `McpAgent` template warnings, R2 free-tier card live probe, Codex CLI 60-second tool budget, no-persistent-DO→sandbox-connections rule, vendor 2 s/30 s numbers as baselines-to-remeasure — all present in prd.md or spike-plan.md. Nothing load-bearing was dropped in consolidation.

  Per the standing guard, I propose no new scope.

  CONSENSUS: YES

