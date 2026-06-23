# STORY-015 Walk Report: User Creates And Tests A Background Agent

Walked: 2026-06-22
Target: `http://localhost:3002/settings/background-agents`
Browser: authenticated in-app browser tab
Status: partial, feature-disabled environment

## Steps

1. Opened `/settings/background-agents`.
   - Result: page rendered readiness, create form, existing agents, and run history.
   - Evidence: `snapshots/step-1-background-agents.txt`.
2. Opened Operator details.
   - Result: readiness explained that background agents were not enabled and named missing operator inputs including `BACKGROUND_AGENTS_ENABLED`, Vercel runtime markers, `AI_GATEWAY_API_KEY`, cron secret, and webhook secret.
   - Evidence: `snapshots/step-2-operator-details.txt`.
3. Applied quick fix for repeated row labels.
   - Result: agent actions now include target agent names, webhook copy controls include the agent name, and run links include repository plus run target.
   - Evidence: `snapshots/step-3-action-labels-after-fix.txt`.
4. Clicked Test on an existing enabled agent.
   - Result: no run was started; the page showed `Background agents are disabled`.
   - Evidence: `snapshots/step-4-test-disabled-message.txt`.
5. Opened an existing run detail.
   - Result: background run detail rendered status, repository, sandbox, permissions, output, summary, timeline, and debug/sidebar metadata.
   - Evidence: `snapshots/step-5-run-detail.txt`.

## Findings

- `F-STORY-015-001`: Background agent and run-history repeated actions needed target-specific accessible labels.

## Notes

The main create-and-test flow could not be completed because the local deployment reports background agents disabled. This story remains partial until it can be repeated with `BACKGROUND_AGENTS_ENABLED=true` and the required runtime/gateway secrets available. Existing run detail inspection was used to cover the run review portion without starting a new job.
