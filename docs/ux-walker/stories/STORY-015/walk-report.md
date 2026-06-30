# STORY-015 Walk Report — User Creates And Tests A Background Agent

**Walk date:** 2026-06-29
**Target:** https://open-agents-dennisons-projects.vercel.app (production, post PR #680 merge)
**Session:** ux-walker-open-agents-prod
**Status:** authenticated walk completed; feature verified working end-to-end in prod; 3 UX findings filed

## Context

PR #680 shipped docs + a dev-only proof harness to prod (non-runtime). This walk
tests the EXISTING background-agents feature UI on the production deployment,
authenticated as the operator (dennison-9116).

## Steps

### Step 1 — Navigate to /settings/background-agents
- Unauthenticated: clean "Please sign in to continue" gate, no content leak, no
  console errors. (step-02-settings-bg-unauth.png)
- Authenticated: full settings page renders — readiness panel, 6-step
  Create-agent wizard, existing agents list, run history. (step-03-settings-authenticated.png)

### Step 2 — Review readiness verdict
- "Hosted prerequisites are configured." — all 11 categories ready (feature
  flag, auth, Vercel sign-in, GitHub OAuth, GitHub App `open-agents-dennison`,
  sandbox runtime, inference gateway, repo allowlist [unset = all], cron
  secret, webhook secret, GitHub App webhooks). (step-04-readiness-operator-details.png)
- **Prod is fully configured for background agents.**

### Steps 3-5 — Create agent wizard (walked, not submitted)
- 6-step wizard: Trigger → Conditions → Instructions → Permissions → Output →
  Review. Clear "incomplete" step indicators; Create button disabled until
  complete. Permissions summary ("Read-only — can read code/PRs/issues/deployments/checks,
  cannot modify"). Review: "It will be saved disabled so you can test before
  turning it on." Well-structured progressive disclosure. (step-06-create-form-review-tab.png)
- **Finding F-015-005 (medium, #681):** Output tab shows stale
  "Tool providers coming later. Composio is planned for v1.5." — Composio is
  actually live (executor.ts Phase 5).

### Step 6 — Click Test
- **Finding F-015-006 (high, #682):** Clicking Test on the enabled "Live Proof
  Failure Agent" produced no visible feedback (no toast, no navigation, no run
  created via the UI). The underlying API works — POST /test via curl created
  run `WJGH-zftPM4pr4N2Fx_hP` which executed end-to-end (18-event timeline:
  sandbox → git context → branch → mutation agent ran 3 LLM steps with
  tool-calls → checks_failed intentionally). The epic spec says Test should
  navigate to /background-runs/[runId]; it does not. (step-08b-after-test.png)

### Step 7 — Open a background run detail page
- Direct URL navigation to /background-runs/{runId} works correctly.
- **Succeeded ready_pr run** (VBbFB_81wtz-SLTTBcawB): proof strip (succeeded,
  schedule.cron, synthetix, sandbox, contents:write/pullRequests:write/etc,
  checks skipped, output ready_pr·created, 49s), run summary "Run succeeded —
  created ready_pr #960", live timeline with workflow ID + redaction passed.
  (step-07-run-detail-succeeded.png, step-07b-run-detail-timeline.png)
- **Fresh failed run** (WJGH-zftPM4pr4N2Fx_hP, fired during walk): "Run failed —
  checks_failed" with "Fix CI and re-trigger" actionable guidance, full
  timeline with sandbox attribution. (step-09-fresh-run-detail.png)
- **Finding F-015-007 (high, #683):** The Details link in the Run history list
  does NOT navigate (stays on settings page). Direct URL works; the link click
  handler is broken. (step-05-agents-and-run-history.png)

## Major positive finding — feature works end-to-end in prod

The adversarial review (docs/plans/background-agents-review.md) flagged "no
in-repo evidence a real run completes end-to-end" (the repo had only mocked
tests). This walk confirms **production has been running real background agents
successfully**: multiple Succeeded ready_pr runs created actual PRs (PR #960 on
synthetix), and a fresh manual-test run fired during the walk executed the full
ready_pr path including the LLM mutation agent (3 steps with tool-calls) before
an intentional check failure. The feature is genuinely working in production,
including the LLM agent loop and ready-PR creation — stronger than the local
`none`-mode proof captured earlier.

## Findings summary

| ID | Severity | Score | Criterion | Issue |
|----|----------|-------|-----------|-------|
| F-015-001 | info | pass | Unauthenticated gate | — |
| F-015-002 | info | pass | Readiness + prod config | — |
| F-015-003 | info | pass | Real prod runs succeed (ready_pr + LLM) | — |
| F-015-004 | info | pass | Run detail renders typed failures + guidance | — |
| F-015-005 | medium | fail | Stale Composio messaging | #681 |
| F-015-006 | high | fail | Test button silent (no dispatch/navigate) | #682 |
| F-015-007 | high | fail | Details link doesn't navigate | #683 |

4 passes (feature works), 3 UX defects filed (2 high navigation/feedback bugs,
1 medium stale messaging). No quick fixes applied (all findings touch
routing/copy/state beyond a 2-file minimal fix).

## Recommendations

1. Fix #682 (Test button) and #683 (Details link) — both are navigation/feedback
   regressions that block the core operator flow (can't trigger a test from the
   UI; can't reach run details from the list). High impact, likely small fixes.
2. Fix #681 (stale Composio messaging) — update copy or surface Composio
   toolkit selection; the feature is live and the UI undersells it.
3. Consider adding an automated e2e test covering the Test-button → run-detail
   navigation path (the local test-proof harness proves the API; a Playwright
   test would catch the UI navigation regression).
