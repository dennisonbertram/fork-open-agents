# Background Agents & Loops Domain Audit Scratchpad

Domain: triggers/cron/grants/runs/events, webhook authz, schedule builder, agent spec, run polling, loops.
Repo root: /Users/dennison/develop/open-agents
Branch (actual): feat/loops-shared-config-integration (env said feat/performance-optimizations)

## Files read
- docs/agents/lessons-learned.md (full)
- Directory listings for lib/background-agents, lib/agent-loops, app/api/background-agents, app/api/agent-loops, app/api/background-agent-runs, app/loops

## Key lessons relevant to this domain (do NOT re-report fixed instances)
- #137: GitHub App callbacks processing OAuth code/installation_id MUST validate server-stored state nonce.
- #143: When GitHub App lacks push access, fail fast 403 -> /settings/connections.
- #147-150: Workflow DevKit: "use step" for node-using funcs; top-level import + start() for durable registration; per-call-site errors.
- #150: FK constraints on event/run tables invisible to mock tests unless mocks enforce FK shape.

## Candidate log
(to be filled)
