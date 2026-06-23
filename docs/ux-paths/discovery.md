# App Discovery: Open Agents

Generated: 2026-06-21

## Application Type

Open Agents is an authenticated web app for launching cloud coding-agent sessions, connecting repositories, managing agent/runtime/tool settings, and reviewing run evidence. Signed-in users are routed to `/sessions`; signed-out users see the public landing page.

## Tech Stack

- Next.js App Router under `apps/web/app`
- React client/server components with SWR data fetching
- Better Auth with Vercel and GitHub social providers
- Drizzle/Postgres database schema in `apps/web/lib/db/schema.ts`
- Vercel Sandbox and managed runtime integrations
- GitHub App/OAuth APIs, Composio, MCP, AI Gateway, and user-paid inference profiles

## User Roles

- Authenticated developer/operator: creates sessions, chats with agents, connects repos, configures tools, reviews diffs, commits, and creates PRs.
- Admin/operator: sees the Admin settings group and `/settings/admin` for token revocation actions.
- Public viewer: views public usage pages under `/[username]` and shared chats under `/shared/[shareId]`.
- Automation owner: configures Background agents and Loops for unattended repository work.

## Feature Map

### Sessions And Chat

- `/sessions`
- `/sessions/[sessionId]/chats/[chatId]`
- New session, new chat, repo connection, model picker, external tools picker, workflow picker, Direct/Coordinated runtime selector, file/diff/PR panels, code editor, dev server, sharing, forking, message deletion/resend, streaming stop/retry.

### Repository Launch And Dashboard

- `/[username]/[repo]`
- `/repos/[owner]/[repo]`
- Repo dashboard, GitHub link, agents settings, PR/Issues/Actions windows, Background agents, Workflows, Activity.

### Settings

- `/settings/profile`
- `/settings/preferences`
- `/settings/connections`
- `/settings/agents`
- `/settings/models`
- `/settings/composio`
- `/settings/mcp`
- `/settings/skills`
- `/settings/background-agents`
- `/settings/runtime-profiles`
- `/settings/usage`
- `/settings/leaderboard`
- `/settings/admin`

### Models And Inference

- Default main/subagent model preferences
- Enabled model shortlist and Manage models picker
- User-paid inference profiles
- Model variants
- Anthropic-compatible and OpenAI-compatible user endpoints

### Background Agents

- Readiness checks
- Create agent
- Enable/disable
- Schedule and repo/event triggers
- Test
- Run history and `/background-runs/[runId]` detail evidence

### Loops

- `/loops`
- `/loops/new`
- `/loops/[loopId]`
- `/loops/[loopId]/builder`
- New loop, plain-English/template/manual creation, builder nodes, save, run, pause, resume, cancel, retry.

### MCP, Skills, And Composio

- MCP servers with name, URL, transport, headers, enabled state, delete
- Skills with AI-assisted creation, enable/disable, edit/delete
- Composio tool connections, profiles, defaults, and chat-specific tool selection

### Usage And Public Profile

- Token/cost insights
- Model/repo breakdowns
- Public usage profile
- Work-domain leaderboard

## Navigation Structure

Settings use a left rail grouped into Account, Tools, Insights, and Admin. Session navigation is sidebar-driven with sessions grouped by status and repository. Chat views include a main conversation area plus panels for files, changes, PRs, runtime evidence, and verified build evidence. Repo routes can be entered directly from `/{owner}/{repo}` and through dashboard routes.

## Data Entities

- Auth: users, accounts, auth sessions, GitHub installations
- Session/chat: sessions, chats, messages, reads, events, shares
- Sandbox/runtime: sandbox services, browser runs, managed runtime profiles and runs
- Git/repo: Vercel project links, repository archives, PR metadata, learnings
- Automation: background agents, triggers, runs, events, outputs, loops, loop runs, step runs
- Tools/settings: inference profiles, skills, MCP servers, Composio profiles, agents, tool entries, preferences
- Observability/usage: verified build runs/events, workflow runs/steps/goals/events, usage events

## Integrations

- Vercel OAuth/sign-in and project/env sync
- GitHub OAuth, GitHub App installs, webhooks, branches, repos, PRs
- Vercel Sandbox and managed runtime profiles
- AI Gateway plus user-paid Anthropic/OpenAI-compatible inference
- Composio connected accounts/toolkits
- MCP HTTP/SSE servers
- Workflow catalog and harness APIs
- Transcription endpoint
- Vercel Analytics

## Error, Empty, And Loading States

- Sessions/sidebar: no sessions, no archived sessions, failed archived load, retry, loading skeletons, working/needs attention/setting up/failed/archived labels
- Session workspace: not found/error routes, waiting for sandbox, no files, loading files, no changes, sandbox inactive/active, resume/create errors, stream stop/retry, PR merge blocked
- Settings: no inference profiles, no skills, no MCP servers, no background agents, no background runs, no runtime profiles, failed usage/leaderboard loads
- Loops: feature disabled panel and builder empty hints
- Connections: no GitHub account, failed connection info, reconnect/expired-token states

## Feature Flags And Conditional UI

- `AGENT_LOOPS_ENABLED`, `AGENT_LOOPS_ALLOWED_REPOS`, `AGENT_LOOPS_STALL_MINUTES`
- `BACKGROUND_AGENTS_ENABLED`, `BACKGROUND_AGENTS_ALLOWED_REPOS`, cron/webhook secrets
- Admin nav from `isAdmin`
- Development-only Agentation overlay
- GitHub repo controls depend on GitHub connection/install state
- Composio UI depends on configured and connected profiles
- Runtime UI switches between Direct classic and Coordinated managed runtime
- Public usage depends on `publicUsageEnabled`

## Recommended Story Topics

1. First-run onboarding and auth
2. Start a sandbox-free chat
3. Connect a repository and create a repo session
4. Work a repo session through files, diffs, commit, and PR
5. Recover from sandbox create/inactive failure
6. Configure model preferences, inference profiles, and variants
7. Configure Composio tools and chat-specific tool selection
8. Register an MCP server
9. Create, enable, invoke, edit, and delete a skill
10. Create/test a Background agent and inspect run evidence
11. Create, edit, and run an Agent Loop
12. Explore usage, public profile, and leaderboard states
