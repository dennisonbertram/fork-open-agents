# Architecture

This is a Turborepo monorepo for "Open Agents" - an AI coding agent built with AI SDK.

## Core Flow

```
Web -> Agent (packages/agent) -> Sandbox (packages/sandbox)
```

1. **Web** handles authentication, session management, and the primary user interface
2. **Agent** (`openAgent`, exported from `packages/agent`) is a `ToolLoopAgent` with tools for file ops, bash, fetch, and task delegation. It supports two runtime modes — `classic` and `managed_runtime` (see `OPEN_AGENT_RUNTIME_MODES`) — and selects per-mode tool policy in `open-agent.ts`.
3. **Sandbox** abstracts file system and shell operations for cloud execution backends. The active backend is Vercel Sandbox (`connectSandbox` → `connectVercel`).

## Key Packages

- **packages/agent/** - Core agent implementation with tools, subagents, and context management
- **packages/sandbox/** - Execution environment abstraction for cloud sandboxes
- **packages/shared/** - Shared utilities across packages

## Web App Layout

Inside `apps/web`:

- **app/** - Next.js App Router pages plus `app/api/*` route handlers that drive
  every subsystem (chat, sessions, sandbox, github, vercel, background-agents,
  composio, harness, inference-profiles, settings, usage, ...).
- **lib/** - domain logic, one folder per concern: `auth`, `db`, `sandbox`,
  `session`, `chat`, `github`, `vercel`, `managed-runtime`, `background-agents`,
  `verified-build`, `composio`, `workflows`, `harness`, `inference`, `skills`,
  `observability`, `usage`, `deployment`, `git`, `diff`.
- **components/**, **hooks/** - UI and client state.

## Major Subsystems

- **Managed Runtime** - runtime profiles declaring their own toolchain and
  setup/verification commands (`packages/sandbox/managed-runtime-profiles.ts`,
  `apps/web/lib/managed-runtime`).
- **Background Agents** - triggered/cron sandbox automation gated by repo
  allowlist and tool grants (`apps/web/lib/background-agents`).
- **Chief of Staff Account Coordinator** - authenticated account status and
  diagnosis API for scoped cross-subsystem observability
  (`apps/web/lib/account-coordinator`,
  `apps/web/app/api/account/status`,
  `apps/web/app/api/account/diagnosis`; see
  `docs/plans/chief-of-staff-account-coordinator.md`).
- **Verified Build** - verified build bridge, contracts, and observability
  (`apps/web/lib/verified-build`).
- **Composio Tools** - external tool connections for agents
  (`apps/web/lib/composio`).
- **Workflows / Harness** - multi-step run orchestration and the agent harness
  API (`apps/web/lib/harness`, `apps/web/lib/workflows`).

## Subagent Pattern

The `task` tool delegates to specialized subagents:
- **explorer**: Read-only, for codebase research (grep, glob, read, safe bash)
- **executor**: Full access, for implementation tasks (all tools)

## Workspace Structure

```
apps/
  web/           # Web interface
packages/
  agent/         # Core agent logic (@open-agents/agent)
  sandbox/       # Sandbox abstraction (@open-agents/sandbox)
  shared/        # Shared utilities (@open-agents/shared)
  tsconfig/      # Shared TypeScript configs
```
