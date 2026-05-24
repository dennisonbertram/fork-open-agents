Summary: Plan the Composio tool-access epic for Open Agents. The detailed epic plan is `docs/plans/composio-agent-tools-epic.md`; the GitHub epic is https://github.com/dennisonbertram/fork-open-agents/issues/8. The design treats Composio as a session-scoped external action plane with a chat-bar selector, settings setup, and per-agent tool policy.

Context: Current Composio docs and local Agent University research agree that v3 integrations should use `@composio/core` sessions plus `@composio/vercel` for AI SDK tools. Composio sessions expose meta tools, can be restricted by toolkit/auth config/connected account, and should be reused across multi-turn conversations by persisting `sessionId`. Open Agents already builds per-turn `OpenAgentCallOptions` in `apps/web/app/workflows/chat.ts` and `packages/agent/open-agent.ts` already supports dynamic `settings.tools` in `prepareCall`.

System Impact: Composio adds a new source of truth for external-service action capability. Open Agents should own user preferences, chat overrides, selected agent profiles, and observability; Composio should own third-party OAuth credentials, connected account status, toolkit execution, and remote tool logs. The workflow must persist and reuse Composio session IDs to avoid losing meta-tool memory between outer AI SDK tool-loop steps.

Approach: Build the smallest coherent path first: configuration and status surfaces, then main-agent session injection, then chat-bar profile selection, then per-agent settings and subagent rollout. Do not preload direct app tool schemas or let every agent inherit all external tools by default. Start with allowlisted toolkits, `workbench: { enable: false }`, no in-chat OAuth links, and explicit user/operator status when Composio is unavailable or a connection is missing.

Changes:
- `docs/plans/composio-agent-tools-epic.md` - Epic plan covering target architecture, state ownership, rollout slices, issue bodies, tests, observability, migration impact, and open decisions.

Verification:
- Validate implementation slices against current Composio docs before coding.
- For future code slices, add red tests first for config validation, DB normalization, workflow tool injection, chat payload persistence, and missing-connection UX.
- Run `bun --bun run ci` and Agent Browser smoke for settings and chat-bar changes.
