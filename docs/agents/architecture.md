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

## Background Agent Tools Model

Every background agent (`apps/web/lib/background-agents`) has three distinct
tool tiers, all visible on the agent builder's Tools panel and the read-only
agent detail page (`apps/web/app/repos/[owner]/[repo]/agents/[agentId]/page.tsx`):

- **Scoped GitHub (default built-in, always present).** A narrowly-scoped,
  single-repo GitHub App installation-token mechanism
  (`apps/web/lib/background-agents/ready-pr.ts`,
  `executor.ts`'s `createReadyPullRequestOutput`) that reads the agent's own
  repo and, only when the agent's Result is "Open a pull request"
  (`outputMode: "ready_pr"`), opens a draft PR after the run. Result
  (`outputMode`) is the single source of truth for this capability's write
  access — see `buildAgentPayload` in `agent-spec.ts`, which derives
  `permissions.github.{contents,pullRequests}` purely from `outputMode`, not
  from any separate toggle. This mechanism is executor-only and
  non-model-callable: it never runs during the model's own turn.
- **Standard toolpack (built-ins, on by default except `web_fetch`).** The
  native `openAgent` tool registry (`packages/agent/open-agent.ts`) —
  `bash`, `read`/`write`/`edit`, `grep`/`glob`, `task`, `skill`,
  `todo_write`, `ask_user_question` — persisted per-agent to
  `agent.builtinToolNames` (`apps/web/lib/background-agents/builtin-toolpack.ts`
  defines the toolpack constants; `null` means the default, web_fetch-off
  preset). `web_fetch` defaults **off** because it is the one built-in that
  makes unauthenticated outbound HTTP calls, auto-approved with no human gate
  in unattended runs (`packages/agent/tools/fetch.ts`).
- **Composio toolkits (strictly opt-in, account-wide).** The existing
  "Other tools" picker (`composio-other-tools-section.tsx`, reusing
  `ComposioToolkitPicker`) lets a user opt an agent into any connected
  Composio toolkit, including the generic `github` toolkit
  (`apps/web/lib/composio/session.ts`). This toolkit is **not** scoped to the
  agent's repo — it is a live, model-callable, account-wide connection — so
  it stays opt-in rather than becoming the default GitHub mechanism for
  unattended, auto-approved background-agent runs.

**Credential invariant (unchanged):** during the model's own turn, a
background agent never holds live GitHub write credentials. The installation
token is minted and then revoked (`revokeInstallationToken`,
`apps/web/lib/github/app.ts`) before the mutation agent's first tool call, and
the sandbox's credential-broker network-policy injection is cleared
(`clearGitHubCredentialBrokering`, `packages/sandbox/vercel/sandbox.ts`)
before that same turn. The commit/PR only happens afterward, via the
deterministic, non-model-callable executor code path
(`createReadyPullRequestOutput`, an Octokit-based verified GitHub App
commit).

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
