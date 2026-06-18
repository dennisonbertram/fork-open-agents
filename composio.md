# Composio Domain Audit Scratchpad

## Audit Date: 2026-06-18

## Files Read
- [x] lib/composio/session.ts — resolveComposioToolsForChat, proposeToolAction injection
- [x] lib/composio/session-config.ts — buildComposioSessionConfig
- [x] lib/composio/client.ts — getComposioClient
- [x] lib/composio/config.ts — getComposioConfig, status helpers
- [x] lib/composio/types.ts — all type definitions, normalizers
- [x] lib/composio/managed-auth-config.ts — resolveManagedAuthConfigId
- [x] lib/composio/resolve-toolkit-list.ts — resolveComposioToolsForToolkitList
- [x] lib/composio/resolve-chat-with-agent-row.ts — pure precedence logic
- [x] lib/composio/errors.ts — redactComposioErrorMessage, getComposioUserFacingError
- [x] lib/composio/direct-list-config.ts — buildComposioSessionConfigFromDirectList
- [x] app/api/composio/connect/route.ts — OAuth connect initiation (POST)
- [x] app/api/composio/connected-accounts/route.ts — list connected accounts (GET)
- [x] app/api/composio/toolkits/route.ts — list available toolkits (GET)
- [x] app/api/composio/status/route.ts — connection status (GET)
- [x] app/workflows/chat.ts — resolveChatModelRuntime, runAgentStep, agentOptions flow
- [x] packages/agent/open-agent.ts — prepareCall, proposeToolAction injection into experimental_context
- [x] packages/agent/tools/propose-tool.ts — propose_composio_tool definition
- [x] packages/agent/tools/task.ts — task tool, subagent delegation
- [x] packages/agent/subagents/explorer.ts, executor.ts, design.ts — subagent ToolLoopAgent definitions
- [x] packages/agent/subagents/roster.ts — applyRosterOverrides
- [x] lib/background-agents/executor.ts — runMutationAgent
- [x] lib/background-agents/composio-tools.ts — resolveComposioToolsForBgRun
- [x] lib/background-agents/store.ts — listEnabledToolGrantsForAgent
- [x] lib/db/schema.ts — backgroundAgentToolSessions, backgroundAgentToolGrants
- [x] lib/composio/user-id.ts — toComposioUserId
- [x] app/workflows/merge-extra-tools.ts — mergeExtraTools

## Assumptions Confirmed

- Composio is a third-party tool integration service providing OAuth-connected external tools
- proposeToolAction is an action injected into experimental_context so propose_composio_tool can record proposals
- The #388 bug (proposeToolAction never injected) IS FIXED for the main chat workflow path

## Bug #388 Analysis (proposeToolAction never injected)

### VERDICT: FIXED for the chat workflow path

Full trace:
1. chat.ts `resolveChatModelRuntime` lines 342-360: builds proposeToolAction closure when mainAgentToolAuthoringEnabled=true && mainAgentId !== null
2. chat.ts lines 379-381: passes it in agentOptions as `{ toolAuthoringEnabled: true, proposeToolAction }`
3. chat.ts lines 1566-1568: agentOptions flows into step via `{ ...modelRuntime.agentOptions, ...options.agentOptions }`
4. chat.ts line 2470-2471: stepAgentOptions passed to webAgent.stream({ options: { ...stepAgentOptions, ... } })
5. open-agent.ts lines 302-303: extracts options.toolAuthoringEnabled and options.proposeToolAction
6. open-agent.ts lines 341-343: injects into experimental_context
7. propose-tool.ts line 59: reads from `ctx?.["proposeToolAction"]`

Regression tests in tool-authoring-wiring.regression.test.ts confirm this works.

## Candidate Defects Traced

### ACCEPTED: Subagent composioToolkitSlugs never resolved into tools
- roster.ts:84-89 returns composioToolkitSlugs from applyRosterOverrides
- task.ts:216-226 destructures rosterOverrides but only uses model and instructions; composioToolkitSlugs is discarded
- Explorer/Executor/Design subagents have fixed hardcoded tool sets with no composio tool injection mechanism
- Background agents (executor.ts) also don't use grants for subagent roles

### ACCEPTED: Grant-level gating not applied in background agent executor
- executor.ts comment (lines 927-929) says: "Grant-level gating is checked here: if no enabled grants exist, slugs are cleared before resolving"
- Actual code (line 931): `agent.composioToolkitSlugs ?? []` — passed directly, no grant filtering
- listEnabledToolGrantsForAgent exists (store.ts:736) but is NEVER called by the executor
- composio-tools.ts resolveComposioToolsForBgRun only filters by repo policy (blocked slugs), not grants

### ACCEPTED: Raw error messages returned without redaction
- connect/route.ts lines 76-80: returns raw error.message to client without calling redactComposioErrorMessage
- toolkits/route.ts lines 88-93: same issue — raw error.message returned
- redactComposioErrorMessage matches `ak_[A-Za-z0-9_*.-]+` pattern; composio API key could appear in error messages

### REJECTED: proposeToolAction never injected (#388)
- Full trace above confirms it IS wired correctly for chat workflow
- Background agent executor doesn't use toolAuthoringEnabled or proposeToolAction, but that's intentional (background agents don't need tool authoring)

### REJECTED: Missing ownership on connected-account reads
- connected-accounts/route.ts line 72-73: scoped by userId via `userIds: [toComposioUserId(authResult.userId)]`
- Composio API enforces the userId filter

### REJECTED: Toolkit listing exposure
- Toolkit listing is platform-level (keyed by API key), not per-user
- No user-specific data exposed in the listing response
- Only authentication is required (requireAuthenticatedUser), which is appropriate

### REJECTED: Duplicate backgroundAgentToolSessions race
- onConflictDoNothing without unique constraint on business keys would allow duplicates
- But session IDs are nanoids, and cache check happens before insert, so race window is very narrow
- Consequence is at most a wasted Composio session, not data corruption

## Coverage Gaps
- No tests exist for subagent composioToolkitSlugs resolution
- No tests exist for grant gating in background agent executor
- No test verifies redactComposioErrorMessage is used in all API route error paths
- No DELETE endpoint for connected accounts (feature gap, not a bug per se)
- callbackUrl in connect route has no domain whitelist (z.url() only validates URL format)
