# Cloudflare durable-worker-agent stack: example code and boilerplate inventory

Research date: 2026-08-11. All repo trees, package.json pins, and npm versions below were
fetched live today via `gh api`, `npm view`, and `curl raw.githubusercontent.com` — not
recalled from training data. Every claim below is dated and sourced; items I could not
verify are marked **UNVERIFIED**.

## TL;DR

- **cloudflare/agents** (MIT, pushed today) is the right home for M1/M4/M5. Its
  `examples/mcp-worker` + `examples/mcp-worker-authenticated` are the correct, *current*
  starting points for M1/M4 — **not** `examples/mcp`, which the repo itself labels
  "deprecated, feature-frozen." `examples/sandbox-coding-agent` is an almost-exact
  pre-built reference for M2 (Sandbox container + credential-less egress interception +
  per-task facet DO), down to a documented "upgrade path" section describing exactly the
  R2 backup/restore work M3 needs.
- **cloudflare/sandbox-sdk** (`@cloudflare/sandbox`, Apache-2.0, latest `0.12.5` on npm,
  `0.13.0-next.724.1` prerelease) has real, current examples for `claude-code`, `codex`,
  `codex-app-server`, `opencode`, `openai-agents`, and — critically for M3 — `time-machine`
  (interactive backup/restore demo) and official tutorials for Claude Code, **Claude
  Managed Agents**, and **Devin Outposts**, all live and dated 2026.
- **cloudflare/claude-managed-agents** (MIT, 267 stars, pushed today) is the single best
  "worked full system" reference for this whole spike: a Cloudflare-authored control-plane
  Worker that receives a webhook, maps a session to a Durable-Object-backed sandbox,
  persists state across sleeps via R2 snapshot or DO SQLite, and enforces a per-session
  egress policy — architecturally almost identical to what M2/M3 describe. It is not one
  of the four repos the brief named, but it is the strongest single find of this research
  pass.
- **cloudflare/computer** is a real, actively developed (pushed today) parallel project
  with its own `container` / `worker-shell` / `worker-javascript` backends and a bundled
  `@cloudflare/think` chat agent — but every README in the repo is banner-tagged **"PREVIEW
  ONLY... NOT suitable for production use at this time."** It solves an overlapping
  problem to `@cloudflare/sandbox` with a different abstraction (`computerd` daemon +
  capnweb RPC + SQLite VFS) and should be treated as a secondary/exploratory reference,
  not the primary path, given the product context's stated target of "Sandbox SDK
  containers."
- **cloudflare/workers-oauth-provider** (MIT, npm `0.10.3`, published yesterday) is the
  correct mechanism to protect the M4 MCP front door — but note the confirmed drift below:
  the officially-linked GitHub OAuth MCP template still pins `0.8.1` and the deprecated
  `McpAgent`, while the repo's own newer example demonstrates `0.10.x` + `createMcpHandler`.
- **mcp-remote** is real, MIT, but its GitHub repo has not been pushed to since **2026-02-05**
  (over six months stale as of today) and its own README calls itself "a working
  proof-of-concept," "experimental." Claude Code, the client named in M4, has native
  remote-MCP OAuth support as of 2026 and does not need `mcp-remote` — treat it as a
  fallback for legacy stdio-only clients only, not a spike dependency.

## Status / maturity (versions verified today, 2026-08-11)

| Package / repo | Latest | Published / pushed | License | Notes |
| --- | --- | --- | --- | --- |
| `agents` (npm) | `0.20.1` | 2026-07-28 | MIT | cloudflare/agents repo pushed 2026-08-11 (today) |
| `@cloudflare/sandbox` (npm) | `0.12.5` (latest tag); `0.13.0-next.724.1` (next tag) | latest tag current; sandbox-sdk repo pushed 2026-08-10 | Apache-2.0 (`packages/sandbox/LICENSE`, verified text) | repo-level GitHub license badge shows "Other" — the actual LICENSE file is Apache-2.0 |
| `@cloudflare/computer` (npm) | `0.2.0` | — | MIT | repo pushed 2026-08-11 (today); README banner: preview only |
| `@cloudflare/think` (npm) | `0.15.1` | published "2 weeks ago" per npm | MIT | used by `examples/sandbox-coding-agent` (agents repo) and `examples/think` (computer repo) — same package, both repos depend on it |
| `@cloudflare/workers-oauth-provider` (npm) | `0.10.3` | 2026-08-10 (yesterday) | MIT | repo pushed 2026-08-10; very actively released |
| `mcp-remote` (npm) | `0.1.38` | 2026-02-05 | MIT | geelen/mcp-remote GitHub repo last pushed 2026-02-05 — 6+ months stale as of today |
| `@modelcontextprotocol/inspector` (npm) | `2.1.0` | 2026-08-05 | MIT (package.json `license` field; no root `LICENSE` file found via API) | modelcontextprotocol/inspector repo pushed 2026-08-11 (today) |
| `cloudflare/claude-managed-agents` | — | pushed 2026-08-11 (today), 267 stars | MIT | Cloudflare-authored full control-plane reference |
| `cloudflare/agents-starter` | `agents@^0.17.4` pin in package.json | pushed 2026-07-24 | MIT | one version behind the `agents` npm `latest` (0.20.1) |

## 1. cloudflare/agents — examples directory

Fetched the live repo tree via `gh api repos/cloudflare/agents/git/trees/main?recursive=1`
today (2026-08-11). The `examples/` directory has **49 top-level example projects**
(confirmed count from the recursive tree listing), not the small hand-picked set implied
by the brief. Full confirmed list: `a2a`, `agent-skills`, `agents-as-tools`, `ai-chat`,
`assistant`, `auth-agent`, `browser-live-view`, `browser-quick-actions`,
`chat-sdk-messenger`, `codemode`, `codemode-browser`, `codemode-connectors`,
`codemode-mcp`, `codemode-mcp-openapi`, `context-overflow-recovery`, `cross-domain`,
`deploy-churn`, `dynamic-tools`, `dynamic-workers`, `dynamic-workers-playground`,
`elevenlabs-starter`, `email-agent`, `github-webhook`, `mcp`, `mcp-client`,
`mcp-elicitation`, `mcp-elicitation-mrtr`, `mcp-rpc-transport`, `mcp-server`,
`mcp-worker`, `mcp-worker-authenticated`, `multi-ai-chat`, `playground`,
`plivo-voice-agent`, `push-notifications`, `resumable-stream-chat`,
`sandbox-coding-agent`, `structured-input`, `telnyx-voice-agent`, `think-chat-sdk`,
`think-submissions`, `think-workflows`, `tictactoe`, `voice-agent`, `voice-input`,
`vue-chat`, `webmcp`, `worker-bundler-playground`, `workflows`, `workspace-chat`,
`x402`, `x402-mcp`.

The names in the brief map onto this real list as follows: `mcp-client` ✓ exists as
named; `mcp-worker-authenticated` ✓ exists as named; `mcp-rpc-transport` ✓ exists as
named; `workflows` ✓ exists as named; `a2a` ✓ exists as named. There is no example
literally named `mcp-worker` demonstrating "the MCP server" in isolation from the others
— it *does* exist and is the canonical stateless-MCP starting point (see below).

Six examples matter most for this spike, all with READMEs fetched and read in full today:

- **`examples/mcp-worker`** — "The simplest way to run a stateless MCP server on
  Cloudflare Workers." Uses `createMcpHandler` from `agents/mcp/server`, no Durable
  Object, no persistent state. This is the M1 target pattern for the echo tool.
  Depends on `agents: "*"`, `@modelcontextprotocol/sdk: 1.30.0`,
  `@modelcontextprotocol/server: 2.0.0`.
  Source: <https://github.com/cloudflare/agents/tree/main/examples/mcp-worker>,
  README fetched 2026-08-11.
- **`examples/mcp-worker-authenticated`** — OAuth 2.1-protected MCP server using
  `@cloudflare/workers-oauth-provider` wrapping `createMcpHandler`. Demonstrates
  `getMcpAuthContext()`, DCR, a KV-backed `OAuthProvider`, and a Hono approval UI. Pins
  `@cloudflare/workers-oauth-provider: ^0.8.1` in package.json — **note this is behind
  the npm `latest` of `0.10.3`** (see Milestone map / drift below). This is the M4
  starting point.
  Source: <https://github.com/cloudflare/agents/tree/main/examples/mcp-worker-authenticated>,
  README + package.json fetched 2026-08-11.
- **`examples/mcp`** — Explicitly labelled by its own README: **"A deprecated,
  feature-frozen stateful MCP server retained only for existing deployments during
  migration. ... New servers should use the stateless SDK v2 `createMcpHandler` path."**
  It demonstrates `McpAgent` + Durable Object + `setState`/`onStateChanged` — i.e. the
  pattern most closely matching "one Durable Object per worker with SQLite memory," but
  Cloudflare itself is steering new builds away from it for the MCP-*server* layer. Read
  full README 2026-08-11.
- **`examples/mcp-rpc-transport`** — An `Agent` calling an `McpAgent` **in the same
  Worker via Durable Object RPC** (`addMcpServer(name, env.MyMCP, {...})`), no HTTP hop.
  Directly relevant to M1's "hand-rolled tool→named-DO routing" question: this is the
  SDK-native alternative to hand-rolling it. Uses Workers AI, no API keys needed.
  Source: <https://github.com/cloudflare/agents/tree/main/examples/mcp-rpc-transport>.
- **`examples/mcp-client`** — An `Agent` acting as an MCP *client*: `addMcpServer` /
  `removeMcpServer`, OAuth popup flow via `configureOAuthCallback`, elicitation handling
  for both "Stateless Elicitation" (MRTR) and "Legacy Elicitation." Relevant if the
  worker-agent itself needs to call other MCP tools, not just serve them.
- **`examples/sandbox-coding-agent`** — see full breakdown in the Milestone map (M2)
  section below; this is the single most load-bearing example for the whole spike.
- **`examples/a2a`** — Agent exposed as an A2A protocol server (`@a2a-js/sdk`), DO-SQLite
  `TaskStore`, SSE streaming, agent-card discovery at
  `/.well-known/agent-card.json`. Not required by M1–M5 but relevant if the product later
  needs agent-to-agent federation alongside MCP.
- **`examples/workflows`** — Multiple concurrent `agent.runWorkflow()` invocations with
  `waitForApproval`/`approveWorkflow`/`rejectWorkflow`, `getWorkflows()` pagination,
  `reportProgress`. This is the closest official example to "Cloudflare Workflows per
  turn" (M2's framing) though it demonstrates the Agents-SDK workflow wrapper, not a raw
  Workflows-binding-per-turn design — worth reading before assuming the two map 1:1.

**cloudflare/agents-starter template** (separate repo, not a folder in `cloudflare/agents`):
README confirms it demonstrates `AIChatAgent`, streaming chat, three tool-calling patterns
(server auto-exec, client-side, human-in-the-loop approval), Workers-AI-by-default model
provider (swappable to OpenAI/Anthropic), MCP client connection via `this.mcp.connect()` /
`this.mcp.getAITools()`, DO-SQLite chat history, resumable streams, task scheduling, vision.
`package.json` pins `agents: "^0.17.4"` (npm latest is `0.20.1` as of today — a real, if
modest, version gap). MIT, pushed 2026-07-24.
Source: <https://github.com/cloudflare/agents-starter>, README + package.json fetched
2026-08-11.

## 2. cloudflare/sandbox-sdk — examples and official tutorials

Live tree fetched today: `examples/` has **16 confirmed subdirectories**: `alpine`,
`authentication`, `claude-code`, `code-interpreter`, `codex`, `codex-app-server`,
`collaborative-terminal`, `git-repo-per-sandbox`, `minimal`, `openai-agents`, `opencode`,
`s3-mount`, `time-machine`, `typescript-validator`, `vite-sandbox`, `websocket-tunnel`.
**There is no `code-reviewer` example** — that name in the brief does not exist in the live
tree; treat it as unconfirmed/incorrect. There is also a root-level (not under `examples/`)
**`devin/`** directory, the Devin Outposts deployment template, confirmed via
`gh api repos/cloudflare/sandbox-sdk/contents/devin`.

Key examples read in full today:

- **`claude-code`** — POST endpoint takes a repo URL + task description, spawns a
  sandbox, clones the repo, runs Claude Code headless, returns logs + diff. Credential
  isolation: the `Sandbox` subclass sets `interceptHttps = true` and registers an
  `outboundByHost` handler for `api.anthropic.com` that swaps a placeholder header for
  the real secret on egress — the container only ever sees
  `ANTHROPIC_API_KEY=proxy-injected`. Network isolation blocks everything except
  Anthropic + GitHub. `IS_SANDBOX=1` is required for Claude to run as root with
  `--permission-mode bypassPermissions`. This is the exact mechanism M2 asks for
  ("outboundByHost credential injection so the container never sees the GitHub token") —
  confirmed working pattern, real code, MIT-licensed example under an Apache-2.0-licensed
  package.
- **`codex`** — Same shape for `codex exec`, intercepting `api.openai.com` and
  `chatgpt.com`.
- **`codex-app-server`** — WebSocket middleman architecture: Worker sits between browser
  and container, runs every JSON-RPC message through a "handler pipeline"
  (inspect/rewrite/intercept), egress handlers per-host (`api.openai.com` → inject key,
  `github.com` → upgrade to HTTPS, catch-all → 403). Explicitly notes: "HTTPS interception
  and `enableInternet = false` require the Cloudflare runtime environment. Local
  development via `wrangler dev` uses `enableInternet = true` with HTTP-only
  interception" — a real local-dev-vs-prod behavior gap worth knowing for M2.
- **`opencode`** — Worker as transparent proxy in front of OpenCode's own web UI running
  in-container; same Worker-side credential injection pattern.
- **`openai-agents`** — Chat-driven shell/file access in a sandbox via OpenAI Agents SDK.
  README carries an explicit **"Security Warning: This example auto-approves all AI
  operations without human review... No safety limits beyond the container itself."**
  Worth citing directly when designing approval gates.
- **`git-repo-per-sandbox`** — one Artifacts repo per sandbox, same ID for both, mints a
  short-lived write token, authenticated git remote pushed into the sandbox. Relevant if
  workspace persistence uses git-push-to-Artifacts instead of/alongside R2 backup.
- **`time-machine`** — interactive UI demo of `sandbox.createBackup({ dir, name?, ttl?,
  useGitignore?, localBucket? })` / `sandbox.restoreBackup(backup)`. Supports both a
  production R2-presigned-URL flow and a `localBucket` flow for local dev
  (`USE_LOCAL_BUCKET_BACKUPS`). This is the concrete, runnable code for M3.
- **`authentication`** — generalizes the `outboundByHost` credential-injection pattern
  across Anthropic, GitHub, and a virtual `r2.worker` hostname for R2 access, each in its
  own `src/services/<name>/` module — a good template for organizing multiple injected
  credentials at once (Anthropic + GitHub + R2, exactly M2's stated set).
- **`s3-mount`** — mounts an external S3 bucket via `mount-s3`/FUSE with short-lived STS
  credentials issued by the Worker on demand (not baked into the container). Explicitly
  requires deployment (`wrangler deploy`); does not work under local `wrangler dev`
  because it needs FUSE support only present in the production container runtime.

### Backup/restore API detail (for M3)

Confirmed via `developers.cloudflare.com/sandbox/guides/backup-restore/` (fetched
2026-08-11): `createBackup()` produces a compressed **squashfs** archive stored in R2 as
`backups/{backupId}/data.sqsh` + `backups/{backupId}/meta.json`; `restoreBackup()` takes
the returned `DirectoryBackup` handle. TTL defaults to 259,200s (3 days) and is **only
checked at restore time, not creation** — expired backups are not auto-deleted. In
production, the FUSE overlay mount is lost on sandbox sleep/restart, requiring re-restore.
`useGitignore: true` requires git to be installed in the container or it throws
`BackupCreateError`.

The **"~2s restore vs ~30s cold boot" claim in the product brief is independently
confirmed**, verbatim, from the Cloudflare blog post announcing Sandboxes GA: "Booting a
sandbox, cloning 'axios,' and npm installing takes 30 seconds. Restoring from a backup
takes two seconds." Source: <https://blog.cloudflare.com/sandbox-ga/> (fetched 2026-08-11;
the post does not carry an explicit calendar date in its own text, but it is the current
canonical GA announcement and is linked from the current backup/restore docs). Note this
number is Cloudflare's own promotional benchmark for one specific scenario (clone + `npm
install` for axios) — it is not a general SLA and should be re-measured for the spike's
actual squashfs size before quoting it in a proposal.

### Official tutorials (all fetched today, all live and current)

- **Run Claude Code on a Sandbox** — <https://developers.cloudflare.com/sandbox/tutorials/claude-code/>,
  page metadata shows last-updated **May 5, 2026**. Walks through
  `npm create cloudflare@latest -- claude-code-sandbox --template=cloudflare/sandbox-sdk/examples/claude-code`,
  local `.dev.vars` with `ANTHROPIC_API_KEY`, `npm run dev`, then `wrangler deploy` +
  `wrangler secret put`. Confirms the tutorial is a thin wrapper around the exact
  `examples/claude-code` repo code (same credential/network isolation as documented
  above).
- **Set up Claude Managed Agents** — <https://developers.cloudflare.com/sandbox/tutorials/claude-managed-agents/>,
  last updated **May 19, 2026**. "The agent loop runs on the Anthropic platform, while
  Cloudflare provides the runtime." Anthropic sends a webhook to a Workers-based control
  plane on session start; the control plane gives each session its own sandbox, routes
  outbound traffic through a per-session egress policy, and persists state across session
  sleeps. Dual backend: full Linux MicroVMs (Containers) or lightweight isolates (Dynamic
  Workers). Requires a paid/Enterprise Workers account. Deep-dives into the reference
  implementation below (cloudflare/claude-managed-agents).
- **Run Devin Outposts on Cloudflare** — <https://developers.cloudflare.com/sandbox/tutorials/devin-outposts/>,
  last updated **July 21, 2026**. Each Devin session gets its own isolated sandbox; a
  cron trigger polls session status once per minute; sessions suspend/resume by archiving
  `/root`, `/workspace`, `/opt/devin-persistent` to R2. Deploy template at
  `cloudflare/sandbox-sdk/devin` (root-level directory, confirmed to exist today via
  `gh api`), installable with
  `npm create cloudflare@latest -- cloudflare-devin-outpost --template=cloudflare/sandbox-sdk/devin`.
  Requires a Devin Enterprise org and Node.js 24 for manual deploys.

All three tutorials post-date and are consistent with the examples/ directory contents
verified above — no drift found between tutorial text and repo code as of today's fetch.

## 3. cloudflare/computer — examples

Live tree fetched today: `examples/` has **9 confirmed subdirectories**: `artifacts`,
`assets`, `container`, `egress`, `think`, `think-compare-runtimes`, `tutorial`,
`worker-javascript`, `worker-shell`. The brief's guessed names map as: `container` ✓,
`worker-shell` ✓, `worker-javascript` ✓, `egress` ✓, `think` ✓, `artifacts` ✓ — all
confirmed real.

**Every example README in this repo carries the same banner** (verified by reading
`container`, `tutorial`, `think`, `worker-shell`, `egress`, `artifacts` READMEs today):

> **PREVIEW ONLY** This package is provided as a preview for feedback only. APIs are
> unstable and the design is subject to change. Suitable for experiments, exploration and
> prototypes. It is NOT suitable for production use at this time.

Root README confirms this is a genuinely different architecture from `@cloudflare/sandbox`:
"Cloudflare Computer is a virtual filesystem that lives inside a Durable Object... exposes
one pluggable execution surface through `workspace.runtime`." Three backends: **Container**
(runs a `computerd` daemon inside the sandbox container, FUSE-mounts DO-SQLite state, syncs
over **capnweb** RPC — described in `examples/container`'s own README as "modelled on the
cloudflare/sandbox-sdk bridge," i.e. a parallel reimplementation, not a wrapper around
`@cloudflare/sandbox`); **Isolate shell** (runs `just-bash` in a Dynamic Worker, reached via
Workers RPC, no container at all); **Isolate JavaScript** (ECMAScript module in a Dynamic
Worker with Workspace-backed `node:fs/promises`).

- **`examples/container`** — Worker + DO boot a Container running `computerd`, expose
  `write`/`read`/`exec` HTTP. Confirms the general pattern: DO owns SQLite-authoritative
  state; container is a FUSE-mounted *cache* of that state, not the source of truth — the
  inverse of the sandbox-sdk model where the container's local disk is itself the
  ephemeral resource being backed up/restored.
- **`examples/tutorial`** — a PDF recipe-card agent: `write` tool runs on the host (DO),
  `bash` (pandoc) runs in the container against the same FUSE-mounted file, output synced
  back and published to R2. Good worked example of "host filesystem tools + container
  compute tools sharing one workspace," a pattern the spike may want even without
  adopting `@cloudflare/computer` wholesale.
- **`examples/think`** — `@cloudflare/think` chat agent (same npm package used by
  `cloudflare/agents`' `sandbox-coding-agent`) behind a terminal chat UI, backed by a
  `@cloudflare/computer` Workspace instead of raw Sandbox calls.
- **`examples/think-compare-runtimes`** — a web UI that runs the *same* agent task against
  the container and worker runtimes side by side; useful reference for evaluating whether
  a lighter-weight Dynamic-Worker-based execution surface could substitute for a full
  container for parts of the coding-agent turn.

License: MIT (repo-level, confirmed). Recency: pushed today, 2026-08-11 — this is not a
dead or abandoned project, just explicitly pre-production.

## 4. cloudflare/workers-oauth-provider — examples/demos, and remote-MCP templates

**No `examples/` or `demo/` directory exists in this repo today** — the live root listing
(fetched via `gh api repos/cloudflare/workers-oauth-provider/contents`) shows only
`.changeset`, `.github`, `AGENTS.md`, `CHANGELOG.md`, `HISTORY.md`, `LICENSE.txt`,
`README.md`, `SECURITY.md`, `__tests__`, `conformance`, `docs`, `src`,
`storage-schema.md`, config files. The README's own Quick Start is the closest thing to a
worked example, and it does not link out to a separate demo repo. The demos live
elsewhere:

- **`cloudflare/agents/examples/mcp-worker-authenticated`** (covered in section 1) is the
  current, actively-maintained demo for this library paired with the new
  `createMcpHandler`.
- **`cloudflare/ai/demos/remote-mcp-authless`** and
  **`cloudflare/ai/demos/remote-mcp-github-oauth`** are the `npm create cloudflare@latest`
  gallery templates. Confirmed real by listing `cloudflare/ai/contents/demos` today (35
  demo directories total, including both of these plus `remote-mcp-auth0`,
  `remote-mcp-authkit`, `remote-mcp-cf-access`, `remote-mcp-cf-access-self-hosted`,
  `remote-mcp-google-oauth`, `remote-mcp-logto`, `remote-mcp-server-autorag`,
  `remote-mcp-server-descope-auth`, `remote-mcp-server`, `mcp-client`,
  `mcp-server-bearer-auth`, `mcp-slack-oauth`, `mcp-stytch-b2b-okr-manager`,
  `mcp-stytch-consumer-todo-list`, `python-workers-mcp`, and others unrelated to MCP).
  Install command confirmed via web search + repo structure:
  `npm create cloudflare@latest -- my-mcp-server --template=cloudflare/ai/demos/remote-mcp-authless`
  (and `remote-mcp-github-oauth` analogously). Repo `cloudflare/ai`: MIT, pushed
  2026-08-05.

  **Drift found, confirmed by reading source directly**: `remote-mcp-authless`'s last
  commit (2026-07-30) is titled "adopt stateless MCP spec — Replace the stateful McpAgent
  and Durable Object transport with the MCP SDK v2 stateless handler for the 2026-07-28
  protocol revision." `remote-mcp-github-oauth`'s last commit is older (2026-06-28,
  "update deps") and its `src/index.ts`, read in full today, **still uses**
  `import { McpAgent } from "agents/mcp"` — the same pattern `cloudflare/agents` itself
  now calls "deprecated, feature-frozen" in `examples/mcp`'s README. Its `package.json`
  also pins `@cloudflare/workers-oauth-provider: ^0.8.1`, two minor versions behind
  today's npm `latest` (`0.10.3`, published yesterday). **This is the template most
  directly matched to M4 and it is the one that has not been migrated** — plan to port
  its GitHub-OAuth-handler logic onto the newer `createMcpHandler` + `OAuthProvider`
  pattern from `mcp-worker-authenticated` rather than starting from
  `remote-mcp-github-oauth` verbatim.

- **`cloudflare/claude-managed-agents`** (MIT, 267 stars, pushed today 2026-08-11) — not
  named in the brief, but the single richest worked reference for "OAuth-adjacent,
  webhook-triggered, per-session sandbox behind a Worker control plane" available today.
  Its `docs/architecture.md` (read in full) describes: Standard Webhooks signature
  verification (HMAC-SHA256, ±300s tolerance), events persisted to D1, session→backend
  mapping (MicroVM `Sandbox`-class DO vs. `IsolateRunner` DO extending the Agents SDK)
  cached per session row, MicroVM state snapshotted to R2 on idle vs. Isolate state
  persisted automatically through DO-SQLite via the Agents SDK's `Workspace` abstraction,
  and a shared egress **policy engine** compiling per-session allow/deny lists,
  header-injection rules, and optional Dynamic Worker proxy / VPC routing. This is not an
  MCP front door (it's a webhook receiver for Anthropic's own managed-agent product,
  architecturally the mirror image of M4's "external client connects to *our* MCP
  server"), but its session-DO-mapping and egress-policy design is directly transferable
  to M2/M3.

## 5. mcp-remote and the MCP Inspector — current state

- **mcp-remote** (`geelen/mcp-remote` on GitHub, MIT). Repo `pushedAt`: **2026-02-05**
  (confirmed via `gh repo view` today) — over six months with no push as of this
  research date. npm `mcp-remote@0.1.38`, `time.modified` also 2026-02-05, consistent
  with the GitHub staleness. Its own README (fetched today) describes it as "a working
  proof-of-concept" / "experimental," and states explicitly: **"As soon as your chosen MCP
  client supports remote, authorized servers, you can remove it."** Listed supported
  clients: Claude Desktop, Cursor (0.48.0+, only needs it for OAuth-protected servers —
  unauthed SSE works natively), Windsurf. **Claude Code is not in its supported-client
  list**, and independently confirmed via web search: Claude Code has native remote-MCP
  support with OAuth via `claude mcp add --transport http <name> <url>`, handling the
  browser-based OAuth flow itself, no proxy required. **Conclusion for M4: `mcp-remote`
  is not needed to register Claude Code against the worker's MCP endpoint** — it only
  becomes relevant if a *second* client in scope (M4 mentions "a second client") turns out
  to be stdio-only.
- **MCP Inspector** (`modelcontextprotocol/inspector`, MIT per npm `package.json license`
  field — the repo itself returned no root `LICENSE` file via the GitHub Contents API
  today, so treat "MIT" as npm-metadata-sourced, not independently confirmed from repo
  text). npm `@modelcontextprotocol/inspector@2.1.0`, published **2026-08-05** (six days
  ago); GitHub repo pushed **today**, 2026-08-11 — actively maintained. `bin` entry is
  `mcp-inspector` (launched via `./clients/launcher/build/index.js`); the package also
  ships separate `clients/web`, `clients/cli`, `clients/tui` build outputs, suggesting a
  larger multi-surface tool than the older single-page inspector some documentation still
  shows. Every `mcp-worker*` README in `cloudflare/agents` points users at the Inspector
  for manual testing against `http://localhost:5173/mcp`, confirming it's still the
  Cloudflare-recommended manual MCP test tool as of today.

## 6. Community/open-source projects wiring DO-per-agent + sandbox + MCP

Searched GitHub code search (`gh search code`) for combinations of `getSandbox`,
`createMcpHandler`, `McpAgent`, `OAuthProvider`, `@cloudflare/sandbox` today. Only
including repos with real, readable code (not blog posts, not gists without code).

- **`jezweb/vite-flare-starter`** (MIT, **46 stars**, pushed **today** 2026-08-11) — the
  strongest community find. `docs/AGENTS.md` (fetched in full today) states its design
  principle directly: "all stateful long-lived things extend `Agent` from the SDK so we
  get state sync, schedule/queue/retry, hibernation, RPC, MCP client, and observability
  without re-implementing them." Wires `@cloudflare/sandbox` for tool execution
  ("Code Mode" composed multi-tool execution, network-blocked by default) and an
  `McpAgent` base class to expose an agent as an MCP server. Ships concrete worked
  examples (Researcher→Writer agent handoff, a `ScratchpadMcpAgent`, a scheduled
  `SweeperAgent`), D1 + R2 + Vectorize bindings, approval queues, per-agent budget gates,
  diagnostics-channel observability. Self-dated against SDKs "as of July 2026."
  **Caveat/expectation gap found while reading this repo**: its own doc comment claims
  the Agents SDK exports `AgentMcpOAuthProvider` for "OAuth-protected MCP endpoints" —
  see Expectation gap in Milestone map / M4 below; that export is real but does a
  different job than the comment implies.
- **`apeacock1991/agents-version-control`** (no license file found, 11 stars, pushed
  2026-04-27) — imports both `@cloudflare/workers-oauth-provider` (`OAuthProvider`) and
  `Sandbox as BaseSandbox` from `@cloudflare/sandbox` in the same `src/index.ts`. Smaller
  and less documented than `vite-flare-starter`, but a second independent confirmation
  that `OAuthProvider` + `Sandbox` in one Worker is a pattern real projects use, not just
  an official-examples-only combination.
- **`syumai/workers-playground`** (MIT, 28 stars, pushed 2025-11-14) — has a
  `perl-sandbox-mcp/` subproject combining `@cloudflare/sandbox`'s `getSandbox` and
  `@cloudflare/workers-oauth-provider`'s `OAuthProvider`. Smaller "playground"-quality
  code, six-plus months stale, useful only as a third confirmation point, not a template
  to build from.
- **`sdan/bashroom`** (no license file, 3 stars, pushed 2026-08-03) and
  **`aidenkbm/agent-cloud-shell`** (no license file, 0 stars, pushed 2026-06-10) — both
  small personal projects combining `createMcpHandler` with `@cloudflare/sandbox`'s
  `getSandbox(env.SANDBOXES, userId, { normalizeId: true })`. Low-signal individually
  (no stars/community validation, no license), but they corroborate that
  `createMcpHandler` + `getSandbox` in the same Worker is a pattern people are already
  reaching for outside Cloudflare's own examples — worth a skim, not worth basing an
  architecture on.

No community project was found that wires **all three** of DO-per-task-Agent +
Sandbox-container + OAuth-protected MCP front door end to end in one repo at meaningful
maturity (stars, recent commits, tests). `cloudflare/claude-managed-agents` (section 4) is
the closest full-system match but solves a different entry point (inbound webhook, not
inbound MCP tool call).

## Milestone map (M1–M5)

### M1 — "Hello worker": named Agent DO + SQLite memory + echo MCP tool + createMcpHandler

**Start from**: `cloudflare/agents/examples/mcp-worker` for the `createMcpHandler` echo
tool shape, cross-read against `examples/mcp` (the deprecated `McpAgent`+DO+SQLite
pattern) *only* to see the SQLite/state API shape, and `examples/mcp-rpc-transport` for
the SDK-native way to route a tool call to a named DO without hand-rolling it
(`this.addMcpServer("name", env.MyMCP, {...})`, DO-to-DO RPC, no HTTP hop).

**Copy**: `mcp-worker`'s `createMcpHandler(createServer)` wiring as the front door;
`mcp-rpc-transport`'s `Agent` extends pattern + `addMcpServer` call for the "route this
tool call to a specific named DO" piece the brief calls "hand-rolled tool→named-DO
routing" — the SDK gives you an unrolled version of this, worth trying before hand-rolling
it.

**Add**: SQLite memory schema is not demonstrated end-to-end in a *current, non-deprecated*
example — `examples/mcp`'s `setState`/`onStateChanged` is the closest but is explicitly
the pattern being migrated away from for the MCP-server role specifically (it's fine as an
`Agent`/DO pattern generally; the deprecation is about using `McpAgent` to *serve MCP*, not
about DO-SQLite state itself). Plan to build the SQLite memory schema directly against
`Agent`'s `this.sql` API (documented in the Agents SDK reference, not example-backed
today) rather than porting `examples/mcp`'s tool/resource registration wholesale.

**Drift/gap found**: the brief's framing ("hand-rolled tool→named-DO routing") assumes
this needs custom code; `mcp-rpc-transport` shows the SDK has a first-class primitive for
exactly this inside one Worker. Re-scope M1 to try the SDK primitive first and only
hand-roll if it doesn't fit the "one Agent DO per task, addressable externally via MCP"
shape.

**Hibernation wake latency**: **no official benchmark found.** Cloudflare's own docs
(`developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/`, per
search snippet today) state a DO hibernates after **10 seconds** of no incoming
request/event and that on wake "the `constructor()` will run again" — but no published
wake-latency number in milliseconds was found in any source checked today. **This is a
number M1 has to measure itself**, not something to cite from docs. Marked as an open
question below.

### M2 — "Brain in a box": Workflow provisions Sandbox, clones repo, runs coding-agent CLI headless, outboundByHost credential injection, kill-mid-turn resume

**Start from**: `cloudflare/agents/examples/sandbox-coding-agent` — read in full today,
this is close to a finished pre-build of M2. It is a `Think` (DO) orchestrator that
delegates coding tasks to a `ClaudeCodeAgent` sub-agent (`AIChatAgent` facet, one per
delegated task, `this.name = agent-tool:<toolCallId>` hashed to a DNS-safe sandbox ID),
running Claude Code headless in its own `@cloudflare/sandbox` container, with
`outboundByHost` intercepting `api.anthropic.com` and forwarding it through
`env.AI.gateway(env.GATEWAY_ID).run(...)` so **no Anthropic token or AI Gateway token ever
enters the container** — a throwaway `ANTHROPIC_API_KEY=cf-aig-placeholder` is dropped at
the interception boundary. Cross-read `sandbox-sdk/examples/claude-code` and
`sandbox-sdk/examples/authentication` for the simpler, non-orchestrator version of the
same credential-injection mechanism (also intercepts GitHub in the `authentication`
example, matching the brief's "container never sees the GitHub token" requirement
directly).

**Copy**: the `outboundByHost` handler pattern verbatim from either
`sandbox-coding-agent` (AI-Gateway-routed) or `sandbox-sdk/examples/authentication`
(direct-secret-injection, simpler, also covers GitHub + R2 hostnames in one place — a
better starting shape if the design needs Anthropic + GitHub + R2 credentials injected
together, exactly M2's stated set).

**Add**: the Workflow-per-turn layer. **No official example currently wires Cloudflare
Workflows directly around a Sandbox provision-and-run step** — `examples/workflows` in
`cloudflare/agents` demonstrates the Agents-SDK workflow wrapper (`runWorkflow`,
`reportProgress`, `waitForApproval`) on abstract "tasks," not on Sandbox provisioning
specifically. Expect to write the Workflow-wraps-Sandbox-provisioning glue from scratch,
using `sandbox-coding-agent`'s Sandbox lifecycle code as the step body.

**Kill-mid-turn resume — read the gap directly from the source, don't assume it's solved**:
`sandbox-coding-agent`'s own README has a "Durability & recovery" section that is
unusually candid about exactly this problem. Quoted verbatim: *"Mid-turn eviction is only
partially recovered. The sub-agent's 'model call' is `runClaudeCode` — a loop reading
`sandbox.streamProcessLogs(...)`. If the facet DO is evicted mid-turn, the `claude -p`
process keeps running orphaned in the container and the tail of that turn is lost;
recovery re-enters `onChatMessage` and starts a new `claude -p --resume` rather than
re-attaching to the live process... Hence resume is between turns, not mid-turn."* The
README's own "Upgrade path (deferred)" section names the exact fix M3 needs: persist the
workspace with `sandbox.createBackup({ directory })` / `restoreBackup()` on every turn
finish, store the handle next to `claudeSessionId` in DO storage, and make workspace setup
"restore if a backup exists, else clone" — and explicitly says memoized-step / true
mid-turn continuity is **deferred**, tracked upstream at
<https://github.com/cloudflare/agents/issues/1829> (an open issue reference the example
itself points to for the AI SDK Harness `session.suspendTurn()`/`detach()` model).
**Practical implication for the spike**: "kill-mid-turn resume" as stated in the brief is
not solved by any current official example — plan the memoized-step design assuming you
are ahead of the reference implementation here, not copying a working pattern.

### M3 — "Persistence": squashfs backup→R2, restore, next-day cold-answer latency

**Start from**: `cloudflare/sandbox-sdk/examples/time-machine` for a runnable,
interactive `createBackup`/`restoreBackup` demo (supports both the production R2-presigned
flow and a `localBucket` local-dev flow — copy its `.dev.vars.example` +
`USE_LOCAL_BUCKET_BACKUPS` wiring directly for local iteration). Cross-read the "Upgrade
path" section of `sandbox-coding-agent`'s README (above) for the specific
turn-finish-triggers-backup design already sketched against this exact orchestrator
shape.

**Copy**: `time-machine`'s R2 bucket provisioning (`wrangler r2 bucket create
time-machine-snapshots`) and its two-mode backup flow.

**Add**: the "next-day cold-answer latency" measurement is not benchmarked in any source
found today beyond the one Cloudflare blog data point (30s cold clone+install vs. 2s
restore, for one specific `axios`-sized scenario — see section 2). This has to be measured
against the spike's actual repo size and squashfs archive size; do not extrapolate
Cloudflare's number to a different workload without re-measuring.

**Drift/gap found**: the TTL on a backup (default 3 days) is **only checked at restore
time**, per the official backup/restore guide fetched today — a "next-day" backup will
restore fine, but a backup left dormant past its TTL is silently retained in R2 (no
auto-delete), which matters for both cost and the design of any backup garbage collection.

### M4 — "Front door": workers-oauth-provider + Claude Code (then a second client)

**Start from**: `cloudflare/agents/examples/mcp-worker-authenticated` — this is the
current, best-practice pairing of `@cloudflare/workers-oauth-provider`'s `OAuthProvider`
with `createMcpHandler`, including DCR, PKCE, `getMcpAuthContext()`, and a working
Hono-based approval UI. **Do not start from `cloudflare/ai/demos/remote-mcp-github-oauth`**
despite it being the more obviously-named "official GitHub OAuth MCP template" — confirmed
today it still uses the deprecated `McpAgent` pattern and pins
`workers-oauth-provider@^0.8.1` against a current npm `latest` of `0.10.3`. If GitHub-repo
scoping (the brief's "task a worker" against a specific repo) is needed, port
`remote-mcp-github-oauth`'s `github-handler.ts` OAuth-exchange logic onto
`mcp-worker-authenticated`'s newer `createMcpHandler` + `OAuthProvider` wiring rather than
building on the older template directly.

**Copy**: `mcp-worker-authenticated`'s `OAuthProvider` config (`authorizeEndpoint`,
`tokenEndpoint`, `clientRegistrationEndpoint`, `apiRoute`, `apiHandler`,
`defaultHandler`), its KV namespace requirement (`OAUTH_KV`), and its `getMcpAuthContext()`
usage inside tool handlers.

**Add**: registering Claude Code specifically needs nothing beyond a correctly-exposed
OAuth-protected `/mcp` endpoint — confirmed today Claude Code has native remote-MCP OAuth
support (`claude mcp add --transport http <name> <url>`), so **no `mcp-remote` proxy is
needed for this client**. Only add `mcp-remote` to the plan if the "second client" (M4's
own phrasing) turns out to be stdio-only.

**Expectation gap found (worth flagging explicitly)**: `jezweb/vite-flare-starter`'s docs
describe `agents`' exported `AgentMcpOAuthProvider` type as the mechanism for
"OAuth-protected MCP endpoints" (i.e., protecting *our* server). Reading the actual
`cloudflare/agents` source today (`packages/agents/src/mcp/do-oauth-client-provider.ts`,
`client.ts`, `client-connection.ts`) shows `AgentMcpOAuthProvider` is in fact a
**client-side** interface — it's what an `Agent` uses when *it* is the OAuth client
connecting out to someone else's MCP server (paired with `createMcpOAuthProvider` in
`examples/mcp-client`), not a mechanism for protecting a server you're exposing. The
correct server-protection mechanism for M4 remains `@cloudflare/workers-oauth-provider`'s
`OAuthProvider`, as used in `mcp-worker-authenticated`. This is exactly the kind of
same-shaped-name confusion an LLM (or a developer skimming a community doc) is likely to
fall into; call it out explicitly in any distilled guidance.

### M5 — "Model swap + cost": Workers AI ↔ AI Gateway BYOK, memory survives, cost per task

**Start from**: no dedicated example repo found for "swap the worker's model" as an
isolated concern — the closest working code is `sandbox-coding-agent`'s
`env.AI.gateway(env.GATEWAY_ID).run({ provider: "anthropic", endpoint, ... })` call
(section 1/M2), which already demonstrates routing through the gateway from a Worker.

**Material, very recent platform change to build against**: Cloudflare announced a
unification of Workers AI and AI Gateway into "a single AI control plane" on
**2026-08-07** (four days before this research date) — blog post
<https://blog.cloudflare.com/workers-ai-gateway-unification/>, changelog
<https://developers.cloudflare.com/changelog/post/2026-08-07-workers-ai-unified-billing/>,
both fetched today. Per the blog: "there's no concept of a separate AI Gateway and Workers
AI binding: it all goes through the same path" — the same `env.AI` binding now serves
both Workers AI models and third-party/BYOK providers, selected by model string and an
optional `{ gateway: { id: '...' } }` parameter, e.g.
`env.AI.run('@cf/zai-org/glm-5.2', {...}, { gateway: { id: 'default' } })`. This directly
simplifies M5's "swap the worker's model" goal — it may now be closer to "change the model
string" than "change the binding."

**BYOK nuance, quoted directly rather than summarized, because the exact wording matters
for M5's cost-per-task capture**: from `developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/`
(fetched today): *"The `cf-aig-byok-alias` header applies to direct provider-passthrough
requests. On requests routed through Unified Billing endpoints (for example, `env.AI.run()`
or `/ai/v1/chat/completions`), only the `default` alias is consulted — if the `default` key
is missing, the request falls through to Unified Billing."* Practical read: calling
`env.AI.run()` against a BYOK provider **does** work through the standard binding, but only
if a key is stored under the `default` alias specifically; if it's missing, the call
silently succeeds anyway by billing through Cloudflare's own Unified Billing rather than
erroring — which would silently invalidate a "BYOK vs. Workers AI cost" comparison unless
the default-alias key is confirmed present before the M5 cost capture.

**Add**: because this AI-Gateway/Workers-AI unification is four days old as of this
research date, treat it as an actively-moving target for the two-week spike — re-verify
the exact binding call shape against current docs at M5 implementation time rather than
copying the snippet above unread, since a feature this fresh is more likely than most to
have follow-on doc/behavior changes during the spike window.

## Fit for resident agent service

- The overall shape the product context describes — one Agent DO per worker, Workflow per
  turn, Sandbox container running a coding-agent CLI, R2 backup/restore, MCP front door
  with OAuth — is not hypothetical; it is closer to Cloudflare's own reference
  architecture than the brief may assume. `sandbox-coding-agent` (agents repo) and
  `claude-managed-agents` (standalone repo) together cover almost every seam described in
  M1–M4, just split across two different "delegation direction" framings (we delegate out
  to a sub-agent vs. we receive a webhook and spin up a session).
- The biggest real gap between "what's demonstrated" and "what the spike needs" is
  **mid-turn durability across a container that has no persistent disk** —
  `sandbox-coding-agent`'s own README says this plainly and points at an open upstream
  issue (`cloudflare/agents#1829`) rather than a shipped solution. Budget real spike time
  for this, not just wiring time.
- `cloudflare/computer` should be treated as a research/reading input, not a build
  dependency, given every one of its example READMEs self-labels "not suitable for
  production." Its host-filesystem-DO + container-FUSE-cache inversion of the sandbox-sdk
  model is worth reading once, for the mental model, before committing to sandbox-sdk's
  disk-is-the-resource model for M3.
- Version churn is real and fast-moving across this whole stack: `agents` shipped 8 days
  before this research date, `@cloudflare/workers-oauth-provider` shipped yesterday, the
  Workers-AI/AI-Gateway unification shipped 4 days ago, and even the *officially linked*
  GitHub OAuth MCP template is already one migration behind its sibling authless template.
  Pin versions deliberately at spike kickoff and re-diff against `latest` at the midpoint,
  rather than assuming a two-week-old pin is still current practice.

## Open questions

- Durable Object hibernation wake latency (M1's explicit measurement target) has no
  published benchmark in any source checked today — must be measured directly, not
  sourced from docs.
- Whether Cloudflare Workflows (the primitive, `workflow.do`/step API) can wrap a Sandbox
  provision-and-run step with the same memoized-step semantics the brief assumes for
  "kill-mid-turn resume" is **unverified** — no example found combining raw Workflows
  bindings with `@cloudflare/sandbox`; only the Agents-SDK workflow wrapper (abstract
  tasks) and the Sandbox-SDK's own turn-based recovery (documented as incomplete) exist
  today.
- Actual next-day cold-restore latency and backup size for a real target-sized repo +
  installed dependencies is unmeasured; only Cloudflare's own axios-sized benchmark
  (30s/2s) is public.
- Whether `AgentMcpOAuthProvider`'s client-side OAuth flow could be reused/adapted to
  simplify M1's Agent-as-MCP-client needs (if the worker itself ever needs to call out to
  other MCP tools) is plausible from the `mcp-client` example but not evaluated in depth
  here — out of scope for M1–M5 as currently scoped, flagged for awareness only.
- `@cloudflare/computer`'s relationship to `@cloudflare/sandbox` at the org-roadmap level
  (are they expected to converge, or is `computer` a longer-term successor?) is
  **UNVERIFIED** — no roadmap document was found stating this explicitly; inferred only
  from both repos being actively developed in parallel as of today.
- MCP Inspector's license: npm `package.json` states MIT, but no `LICENSE` file was found
  at the repo root via the GitHub Contents API today — treat as npm-metadata-sourced only,
  not independently repo-confirmed.

## Sources

All fetched/verified 2026-08-11 unless noted otherwise.

- <https://github.com/cloudflare/agents> — repo metadata, full `examples/` tree via `gh api ... git/trees/main?recursive=1`, MIT license confirmed, pushed today.
- <https://github.com/cloudflare/agents/tree/main/examples/mcp-worker> — README read in full.
- <https://github.com/cloudflare/agents/tree/main/examples/mcp-worker-authenticated> — README + package.json read in full.
- <https://github.com/cloudflare/agents/tree/main/examples/mcp-rpc-transport> — README read in full.
- <https://github.com/cloudflare/agents/tree/main/examples/mcp> — README read in full; source of the "deprecated, feature-frozen" statement.
- <https://github.com/cloudflare/agents/tree/main/examples/mcp-server> — README read in full.
- <https://github.com/cloudflare/agents/tree/main/examples/mcp-client> — README read in full.
- <https://github.com/cloudflare/agents/tree/main/examples/a2a> — README read in full.
- <https://github.com/cloudflare/agents/tree/main/examples/workflows> — README read in full.
- <https://github.com/cloudflare/agents/tree/main/examples/sandbox-coding-agent> — README read in full (entire file), including "Durability & recovery" and "Upgrade path" sections; package.json read (`@cloudflare/sandbox: 0.12.2`, `@cloudflare/think: "*"`).
- <https://github.com/cloudflare/agents-starter> — README + package.json read; MIT, pushed 2026-07-24, pins `agents: ^0.17.4`.
- <https://github.com/cloudflare/sandbox-sdk> — repo metadata, full `examples/` tree, Apache-2.0 LICENSE text confirmed at `packages/sandbox/LICENSE`, pushed 2026-08-10.
- <https://github.com/cloudflare/sandbox-sdk/tree/main/examples/claude-code> — README read in full.
- <https://github.com/cloudflare/sandbox-sdk/tree/main/examples/codex> — README read in full.
- <https://github.com/cloudflare/sandbox-sdk/tree/main/examples/codex-app-server> — README read in full.
- <https://github.com/cloudflare/sandbox-sdk/tree/main/examples/opencode> — README read in full.
- <https://github.com/cloudflare/sandbox-sdk/tree/main/examples/openai-agents> — README read in full, incl. security warning quote.
- <https://github.com/cloudflare/sandbox-sdk/tree/main/examples/minimal> — README read (partial, first 40 lines).
- <https://github.com/cloudflare/sandbox-sdk/tree/main/examples/authentication> — README read (partial, first 40 lines).
- <https://github.com/cloudflare/sandbox-sdk/tree/main/examples/git-repo-per-sandbox> — README read (partial).
- <https://github.com/cloudflare/sandbox-sdk/tree/main/examples/time-machine> — README read in full.
- <https://github.com/cloudflare/sandbox-sdk/tree/main/examples/s3-mount> — README read (partial).
- <https://github.com/cloudflare/sandbox-sdk/tree/main/devin> — existence confirmed via `gh api repos/cloudflare/sandbox-sdk/contents/devin`.
- <https://github.com/cloudflare/computer> — repo metadata, full `examples/` tree, root README read in full, MIT, pushed today.
- <https://github.com/cloudflare/computer/tree/main/examples/container> — README read (partial).
- <https://github.com/cloudflare/computer/tree/main/examples/tutorial> — README read (partial).
- <https://github.com/cloudflare/computer/tree/main/examples/think> — README read (partial).
- <https://github.com/cloudflare/computer/tree/main/examples/worker-shell> — README read (partial).
- <https://github.com/cloudflare/computer/tree/main/examples/egress> — README read (partial).
- <https://github.com/cloudflare/computer/tree/main/examples/artifacts> — README read (partial).
- <https://github.com/cloudflare/workers-oauth-provider> — repo metadata + full root listing (confirms no `examples/`/`demo/` dir), MIT, pushed 2026-08-10.
- README fetched: <https://raw.githubusercontent.com/cloudflare/workers-oauth-provider/main/README.md> — `OAuthProvider` config shape, PKCE/DCR/CIMD notes, `OAUTH_KV` requirement.
- <https://github.com/cloudflare/ai> — repo metadata (MIT, pushed 2026-08-05), `demos/` listing (35 entries) via `gh api`.
- <https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-authless/README.md> — referenced via search; last commit 2026-07-30 confirmed via `gh api commits`.
- <https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-github-oauth/README.md> and `src/index.ts` — full source read; last commit 2026-06-28 confirmed via `gh api commits`; confirms deprecated `McpAgent` usage and `workers-oauth-provider@^0.8.1` pin.
- <https://github.com/cloudflare/claude-managed-agents> — repo metadata (MIT, 267 stars, pushed today); `docs/architecture.md` read in full.
- <https://developers.cloudflare.com/sandbox/tutorials/claude-code/> — fetched in full; last updated May 5, 2026.
- <https://developers.cloudflare.com/sandbox/tutorials/devin-outposts/> — fetched twice (architecture + repo-link follow-up); last updated July 21, 2026.
- <https://developers.cloudflare.com/sandbox/tutorials/claude-managed-agents/> — fetched in full; last updated May 19, 2026.
- <https://developers.cloudflare.com/sandbox/guides/backup-restore/> — fetched in full; source of `createBackup`/`restoreBackup` signatures, squashfs/R2 storage layout, TTL-at-restore-only behavior.
- <https://blog.cloudflare.com/sandbox-ga/> — fetched in full; source of the "30 seconds cold vs. 2 seconds restore" quote and R2 snapshot storage confirmation.
- <https://blog.cloudflare.com/workers-ai-gateway-unification/> — fetched in full; published 2026-08-07; source of the unified `env.AI` binding claim.
- <https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/> — fetched in full; source of the `cf-aig-byok-alias` / `default`-alias-only-on-`env.AI.run()` quote.
- <https://raw.githubusercontent.com/cloudflare/agents-starter/main/README.md> and `package.json` — fetched.
- <https://raw.githubusercontent.com/geelen/mcp-remote/main/README.md> — fetched in full; source of "working proof-of-concept"/"experimental" and supported-client list.
- geelen/mcp-remote repo metadata via `gh repo view` — `pushedAt: 2026-02-05`.
- npm `mcp-remote` via `npm view` — version `0.1.38`, `time.modified: 2026-02-05`.
- <https://github.com/modelcontextprotocol/inspector> — repo metadata (pushed today; no root LICENSE file found via Contents API).
- npm `@modelcontextprotocol/inspector` via `npm view` — version `2.1.0`, published 2026-08-05; `package.json` `bin`/`license` fields read directly.
- Web search: "Claude Code connect remote MCP server OAuth 'claude mcp add' native support 2026" — result summarizing `claude mcp add --transport http` native OAuth support, cross-checked against <https://code.claude.com/docs/en/mcp> (linked in search results, not independently re-fetched).
- Web search: "Durable Objects hibernation wake latency benchmark milliseconds SQLite Cloudflare" — used to source the 10-second-idle-then-hibernate detail and to confirm no published wake-latency benchmark exists; underlying doc <https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/> not independently re-fetched in full (snippet-sourced only — flag as slightly lower-confidence than directly-fetched sources above).
- <https://github.com/jezweb/vite-flare-starter> — repo metadata (MIT, 46 stars, pushed today); `docs/AGENTS.md` fetched in full.
- <https://github.com/apeacock1991/agents-version-control> — repo metadata only (no license file found, 11 stars, pushed 2026-04-27); code confirmed via `gh search code` snippet (not fully read).
- <https://github.com/syumai/workers-playground> — repo metadata (MIT, 28 stars, pushed 2025-11-14); code confirmed via `gh search code` snippet (not fully read).
- <https://github.com/sdan/bashroom> — repo metadata (no license, 3 stars, pushed 2026-08-03); code confirmed via `gh search code` snippet (not fully read).
- <https://github.com/aidenkbm/agent-cloud-shell> — repo metadata (no license, 0 stars, pushed 2026-06-10); code confirmed via `gh search code` snippet (not fully read).
- `gh search code "AgentMcpOAuthProvider"` — used to locate and confirm `packages/agents/src/mcp/do-oauth-client-provider.ts`, `client.ts`, `client-connection.ts` as the client-side location of this export, the basis for the M4 expectation-gap finding.
- npm `agents`, `@cloudflare/sandbox`, `@cloudflare/computer`, `@cloudflare/think`, `@cloudflare/workers-oauth-provider` via `npm view <pkg> version|versions|dist-tags|time.modified|license|repository` — all queried directly today.
