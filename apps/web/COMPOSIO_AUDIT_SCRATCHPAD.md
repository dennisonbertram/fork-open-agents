# Composio Domain Audit Scratchpad

Domain: apps/web/lib/composio, apps/web/app/api/composio
Date: 2026-06-17

## Files read
- docs/agents/lessons-learned.md (full)
- apps/web/app/api/composio/connected-accounts/route.ts
- apps/web/app/api/composio/connect/route.ts
- apps/web/app/api/composio/toolkits/route.ts
- apps/web/app/api/composio/status/route.ts
- apps/web/lib/composio/client.ts
- apps/web/lib/composio/config.ts
- apps/web/lib/composio/managed-auth-config.ts
- apps/web/lib/composio/user-id.ts
- apps/web/lib/composio/session.ts
- apps/web/app/workflows/chat.ts (partial: lines 276-408, proposeToolAction wiring)

## Bug #388 status
- Fix merged: 968d5cb0 (PR #390) + d7f3712e (#388). proposeToolAction IS now constructed in
  chat.ts:349-367 and passed to agentOptions (chat.ts:386-388). The agent package consumes it
  (packages/agent/open-agent.ts, tools/propose-tool.ts). NOT reporting as broken.

## Assumptions
- toComposioUserId(userId) = `open_agents_user_${userId}` — single global Composio workspace keyed
  by server API key; per-user isolation is via this derived id only.
- requireAuthenticatedUser() gates all 4 routes.

## Candidates considered (updated as I go)
(see findings below)
