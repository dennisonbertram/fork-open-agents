<!-- TITLE: feat: first-class MCP client to mount external MCP servers per repo/session as agent tools -->

## Why this matters

Today the agent's tool surface is fixed by us: built-in tools (`read`, `bash`, …) plus the curated Composio SaaS integrations. There is no way for a user to say "also give the agent access to my Postgres staging DB," "let it call our internal deploy API," or "mount this team's MCP server." If a team's workflow depends on a system we haven't integrated, the agent simply can't reach it — the user falls back to copy-pasting query results into the chat by hand. Meanwhile the entire MCP ecosystem (Claude Desktop, Cursor, the official filesystem/everything servers, and a growing catalog of database/SaaS/internal servers) is something the agent can't tap, even though the AI SDK already in the repo ships a production MCP client.

This feature lets any agent session mount arbitrary Model Context Protocol servers — databases, internal tooling, the filesystem, third-party services — per repo and per session, auto-discover their tools, and expose them to the agent as ordinary namespaced tools (`mcp__<server>__<tool>`). The bet: the agent becomes dramatically more useful when users plug in *their* tools instead of waiting for us to build first-party integrations for each one. It is the extensibility flywheel and a standards-alignment play that complements (not competes with) Composio by covering the long tail of custom/internal/standards-based tools — reframing open-agents from "an agent with our integrations" to "an agent that speaks to your whole stack."

## User/operator path protected

The agent chat tool-resolution path on a repo: `apps/web/app/workflows/chat.ts` resolves a per-turn `ToolSet` (today via `resolveComposioToolsForChat`, reading the chat's `composioSelection`) and passes it into `webAgent.stream({ messages, options, tools })`; `packages/agent/open-agent.ts#getRuntimeModeToolPolicy(runtimeMode, requestedTools)` merges externally-supplied tools (`{ ...tools, ...requestedTools }`). Per-repo defaults live in `repositoryComposioSettings` (`apps/web/lib/db/schema.ts`), and per-chat selection in the `composioSelection` jsonb column on `chats`. Adding MCP must not regress: Composio tool resolution/merging, the per-turn streaming path, existing tool-call rendering, `managed_runtime` mode's `pickTools` allowlist behavior, or the per-repo/per-chat settings persistence.

## Behavior contract

- **Given** a chat with an `mcpSelection` listing one or more servers (stdio command+args, Streamable HTTP, or legacy SSE), **when** a turn starts, **then** the resolver connects to each server, completes the MCP `initialize` handshake, discovers its tools, and merges them into the turn's `ToolSet`.
- **Given** discovered tools, **then** each is namespaced `mcp__<server>__<tool>` so it never collides with built-ins (`read`, `bash`) or Composio (`COMPOSIO_*`).
- **Given** a mounted tool the agent calls (e.g. `mcp__math__add(2,3)`), **when** the tool loop invokes it, **then** it executes via the normal `tool.execute(args, options)` path and returns the correct result (`5`); a real server read (`mcp__fs__read_text_file`) returns the file's exact contents.
- **Given** invalid args to a mounted tool, **then** the **MCP server** is the validation boundary and rejects them (`MCP error -32602`), surfaced as a typed tool error (the AI SDK adapts MCP tools with no client-side `validate()`, so the host passes args through unchecked).
- **Given** a session selecting N servers where one is unreachable, **when** mounting, **then** healthy servers mount and the failed one surfaces as an attributable observability event — the whole turn does **not** fail.
- **Given** the turn completes (or aborts), **then** all MCP transports are torn down cleanly (connect → list → call → close).
- **Given** a per-server allow/deny list, **then** only allowed tools are mounted, bounding the tool count and system-prompt token cost.
- **Given** server secrets (DB URLs, API keys), **then** they live in `env`/`headers` (or an OAuth `authProvider`) stored encrypted/referenced indirectly and are never model-visible.

## Product and design spec

A per-session/per-repo MCP client that mounts a user-configured set of servers, connects, discovers each server's tools, and merges them into the agent's `ToolSet` namespaced `mcp__<server>__<tool>`. The AI SDK v6 MCP client (`@ai-sdk/mcp`, backing `experimental_createMCPClient`) returns objects that *are* AI-SDK `Tool`s, so they drop into the exact `requestedTools` merge path Composio already uses — zero new merge machinery.

### UX — how users use it & how it's exposed

- **Settings → Integrations → MCP Servers (per repo)**: the management surface. "Add server" with fields for transport (stdio command+args / HTTP URL), name, `env`/`headers` for secrets (stored encrypted, never model-visible), and per-server tool allow/deny lists. A "Test connection" button runs the MCP `initialize` handshake and shows discovered tools before saving.
- **Per-session tool picker**: a chat-level chip/panel ("Tools: math, fs") to enable/disable configured servers for the current session, mirroring Composio toolkit selection.
- **Repo-level defaults**: an org/repo admin sets an approved server catalog so sessions inherit safe defaults (the `repository_mcp_settings` analog of `repository_composio_settings`). Walkthrough: an admin adds an HTTP "staging-db" server with an encrypted `Authorization: Bearer …` header, "Test connection" shows 5 tools, they allow-list `query` and `describe_table` and save it as a repo default → a developer enables "staging-db" in a session → asks "why are signups failing today? check the staging users table" → agent calls `mcp__staging-db__describe_table(users)` then `mcp__staging-db__query(...)` (each a card with the "staging-db" badge; the 1b approval gate fires before write-capable variants, read queries pass) → agent correlates rows with a recent migration and explains, citing real data → transports tear down after the turn.

### UX — how the feature demonstrates & explains its value to the user

- **"Test connection" before save** makes the value tangible immediately: the live `initialize` handshake shows "16 tools discovered" (or "couldn't connect"), proving the server is reachable and what it unlocks before any session uses it.
- **Server-badged tool-call cards** (`mcp__fs__read_text_file` with an "fs" badge) make it obvious in-chat that the agent is reaching an external system the user mounted — visually distinct from built-in and Composio tools — so the "the agent used *my* tool" moment is legible.
- **Tool-budget warning** ("this session has N tools mounted — large tool sets slow responses and raise cost") with a one-click "trim to allow-list" teaches the cost/benefit tradeoff in context and gives an immediate remedy.

### UX — how it's clear what the feature is doing (states & feedback)

- **Server list (Settings)**: rows showing name, transport badge (stdio / HTTP), live connection status ("16 tools discovered" / "couldn't connect"), and a tool-count chip; expanding reveals the discovered tool list with allow/deny checkboxes.
- **Connecting**: a spinner + "connecting…" on the row / picker.
- **Ready**: "N tools" chip.
- **Partial**: "2 of 3 servers mounted — `db` failed: connection refused" (per-server failure attributed, not a blanket session error).
- **Failed / Disabled**: explicit per-server states.
- **In-chat**: server-badged tool-call cards with args/result; write-capable calls route through the 1b approval card.
- **Tool-budget warning** when the mounted tool count crosses a threshold.

### UX — how to test the UX, including regressions

Per the authenticated-local-UI-smoke discipline: DB-backed local app, sign in, open a repo's Settings → MCP Servers. **Happy-path smoke**: add the POC's custom stdio `math` server (and/or the official `@modelcontextprotocol/server-filesystem` scoped to a temp dir), click "Test connection" and assert discovered tools appear; save as a repo default; start a session, enable the server in the picker, prompt "add 2 and 3 using the math tool" and assert (a) a server-badged `mcp__math__add` card renders, (b) the result is `5`, (c) `agent-browser errors`/`console` are clean, (d) after the turn the transports closed. **UX regression locks**: a test that an MCP tool-call part renders with the server badge and namespaced tool name (fails before MCP card handling; passes after); a test that a server failing to connect shows the "partial — `<server>` failed" state without failing the whole session; a test that the tool-budget warning appears past the threshold; a test that Composio tool resolution/rendering is unchanged when MCP is enabled. A UX regression test asserts "a mounted MCP tool always renders with its server provenance" and "one bad server never blanks the session."

## Integration spec

- **Client module**: add the MCP client (POC `src/mcp-client.ts`: `mountServer()`, `McpSessionClient` with merged namespaced `ToolSet`, lifecycle/cleanup, `namespacedToolName`/`parseNamespacedToolName`) into `packages/agent` (e.g. `packages/agent/mcp/`), using `@ai-sdk/mcp` (the package backing `experimental_createMCPClient` in the repo's `ai@6.0.168`).
- **Resolver**: add `resolveMcpToolsForChat(...)` in/near `apps/web/app/workflows/chat.ts` mirroring `resolveComposioToolsForChat` — reads the chat's `mcpSelection`, calls `McpSessionClient.mount(selection)`, returns `session.tools()`, and `finally`s `session.close()` after the turn. Merge with Composio: `requestedTools = { ...composioTools, ...mcpSession.tools() }` (namespaces never collide) and pass into `webAgent.stream`.
- **Merge path (exists)**: `packages/agent/open-agent.ts#getRuntimeModeToolPolicy` already merges `requestedTools` — **no change required**, except the deliberate policy decision of whether to extend `managed_runtime`'s `pickTools` allowlist to include `mcp__*` (default: excluded).
- **Schema**: add an `mcpSelection` jsonb column on `chats` (`apps/web/lib/db/schema.ts`, mirroring `composioSelection` near L315, default `{ servers: [] }`, typed `McpSessionSelection` from POC `src/types.ts`), and a `repository_mcp_settings` table mirroring `repositoryComposioSettings` (L1349) for per-repo allowed/blocked server configs. Secrets in `env`/`headers` stored encrypted/referenced like Composio connected-account credentials. Generate the migration via `bun run --cwd apps/web db:generate`.
- **Sandbox execution**: run stdio MCP servers **inside the per-session sandbox** (`packages/sandbox` `exec`, `domain(port)`) with resource/time limits — **never** spawn user-configured commands in the Next.js web process. HTTP/SSE servers connect remotely (subject to an egress allowlist).
- **Allow/deny + cap**: per-server tool allow/deny lists (like Composio's `blockedToolkitSlugs`) and a session tool cap, surfaced in the UI.
- **Observability**: emit `mcp.server.mounted` / `mcp.tool.called` / `mcp.session.failed` alongside the existing `composio.*` events in `chat.ts`.

## In scope

- The MCP client module (mount/list/call/close, namespacing) integrated into `packages/agent`.
- `resolveMcpToolsForChat` resolver merging MCP tools with Composio in `chat.ts`.
- `mcpSelection` jsonb column on `chats` + `repository_mcp_settings` defaults table + migration.
- Settings → Integrations → MCP Servers management UI (add/test/allow-deny) + per-session picker + repo defaults.
- Per-server tool allow/deny lists and a session tool-count cap with UI warning.
- Per-server failure isolation (mount healthy, attribute failed) and clean per-turn teardown.
- **Remote (HTTP/SSE) servers first**, plus the sandbox-hosted execution design for stdio servers.
- Encrypted secret handling in `env`/`headers`; structured observability events.

## Out of scope

- **Gating MCP write/external actions** — depends on POC 1b (approval gate); MCP write-capable tools register behind 1b's policy, but the gate itself is built in the 1b issue.
- **Enabling MCP tools in `managed_runtime` mode** — deliberately deferred; `pickTools` keeps `mcp__*` out by default until a policy decision extends the allowlist.
- **Pooled/long-lived MCP sessions across turns** — v1 mounts/closes per turn (simplest, proven); pooling is a follow-up.
- **Full sandbox-hosted stdio execution rollout** — start with remote HTTP servers (which dodge the RCE fork); the sandbox-hosted stdio design lands here but its hardened rollout (resource/time limits validated in the microVM) is sequenced after.
- Prompt-injection hardening beyond reusing the existing web/Composio content hardening.

## Research and context sources

- POC PR **#82** (branch `poc/1c-mcp-client`) and folder `POC/1c-mcp-client/`.
- Eval evidence: `POC/1c-mcp-client/evidence/transcript.txt` (connect→list→call→guard→close against two real servers) and `evidence/summary.json` (`{ "passed": true, "failures": 0 }`). Real round trip: `add(2,3)==5`, `echo("hello")=="echo: hello"`, `mcp__fs__read_text_file` exact contents, invalid args → `MCP error -32602`, 16 tools across two servers.
- Product brief: `POC/1c-mcp-client/PRODUCT-BRIEF.md` (TL;DR, gap, case FOR/AGAINST, greenlight trigger, "build later — but next").
- README integration plan: `POC/1c-mcp-client/README.md`.
- External research findings (from README): `@ai-sdk/mcp` v1.0.45 backs `experimental_createMCPClient`; `client.tools()` returns objects that ARE AI-SDK `Tool`s (zero adapter glue); transports = stdio (proven) + Streamable HTTP (current remote) + legacy SSE; official `@modelcontextprotocol/sdk` v1.29.0 for spec-compliant interop; **client-side validation gap** (`schemas: "automatic"` has no `validate()`, server is the validation boundary); tool-count bloat (filesystem server alone = 14 tools) requires allow/deny + cap; `@ai-sdk/mcp` still exports `experimental_` aliases (track as it stabilizes).

## Agent todo checklist

- [ ] Write failing tests: mount a stdio test server → `mcp__math__add(2,3)==5`; namespacing avoids collisions; invalid args → `-32602` surfaced as a typed error; one bad server → healthy mount + attributed failure; transports close.
- [ ] Write failing resolver test: a chat `mcpSelection` produces a merged `ToolSet` combined with Composio without key collisions.
- [ ] Write failing schema/migration test for `mcpSelection` default + `repository_mcp_settings`.
- [ ] Confirm red; commit red tests.
- [ ] Integrate the MCP client module into `packages/agent`.
- [ ] Add `resolveMcpToolsForChat` + merge in `chat.ts` with per-turn `close()`.
- [ ] Add the `mcpSelection` column + `repository_mcp_settings` table; generate + commit the migration.
- [ ] Build Settings MCP Servers UI (add/test/allow-deny) + per-session picker + repo defaults.
- [ ] Add per-server allow/deny + tool cap + budget warning.
- [ ] Implement sandbox-hosted stdio execution path; remote HTTP first.
- [ ] Wire encrypted secret storage for `env`/`headers`.
- [ ] Add `mcp.*` observability events + typed error kinds.
- [ ] Run targeted tests green; commit green.
- [ ] Authenticated local UI smoke (add/test server, enable, call, partial-failure); capture evidence.
- [ ] `git diff --check`; `bun --bun run ci`.

## Tests to add first

- **Round trip (behavior)**: mounting the POC stdio `math` server and calling `mcp__math__add(2,3)` returns `5`; `mcp__math__echo("hello")` returns `"echo: hello"` — via the normal `tool.execute` path.
- **Real-server read**: `mcp__fs__read_text_file` of a written temp file returns its exact contents.
- **Namespacing**: discovered tools appear as `mcp__<server>__<tool>` and never collide with `read`/`bash`/`COMPOSIO_*`.
- **Validation boundary**: `mcp__math__add({a:"not-a-number"})` is rejected by the server (`-32602`) and surfaced as a typed tool error (host does not pre-validate).
- **Failure isolation (UX/system)**: a selection with one unreachable server mounts the healthy ones and emits an attributed `mcp.session.failed` — the turn does not fail. Fails before isolation logic; passes after.
- **Merge**: a chat `mcpSelection` plus a Composio selection yields a single `ToolSet` with both namespaces and no key collisions; transports close after the turn.

## Observability and user feedback

- **User-visible status**: Settings connection status ("16 tools discovered" / "couldn't connect"), the "Test connection" result, per-session picker state, partial-mount banner, server-badged tool-call cards, and the tool-budget warning.
- **Named service + structured events**: an `mcp` service emits `mcp.server.mounted` (info; fields `server`, `transport`, `toolCount`, `chatId`, `sessionId`, `userId`), `mcp.tool.called` (info; fields `server`, `tool`, `namespacedTool`, `durationMs`, `success`, `chatId`), `mcp.session.failed` (warn/error; fields `server`, `transport`, `error.kind`), `mcp.session.closed` (info; fields `server`, `reason`), and `mcp.tool.budget_exceeded` (warn; fields `toolCount`, `cap`, `sessionId`).
- **Typed error kinds**: `connect_failed`, `handshake_failed`, `tool_call_error` (incl. `-32602` validation_rejected), `transport_unsupported`, `tool_budget_exceeded`, `egress_blocked`, `sandbox_spawn_failed`.
- **Correlation IDs**: `userId`, `sessionId`, `chatId`, `requestId`, `sandboxName` (for sandbox-hosted stdio), and a `server` name on every MCP event.
- **Redaction rules**: never log `env`/`headers` secret values or `Authorization` tokens (log key names + `[redacted]`); treat MCP tool descriptions/results as untrusted, model-visible content (apply the same hardening as web/Composio); never log raw server-returned rows that may contain PII beyond a bounded preview.
- **Grep-able debug recipes**: `grep 'mcp.session.failed' | grep '"error.kind":"connect_failed"'` to find unreachable servers; `grep 'mcp.tool.budget_exceeded'` to find token-bloating sessions; reconstruct a session's MCP timeline by `sessionId` + `server`.
- **Evidence expectation**: the smoke captures a "Test connection — N tools discovered" screenshot, a server-badged tool-call card with the correct result, a partial-failure banner, and the corresponding `mcp.*` log lines.

## Regression harness plan

- **New coverage**: (1) MCP client unit/integration tests (port the POC `eval.ts` against the POC stdio `test-server.ts` and the official filesystem server) for connect/list/call/guard/close; (2) a namespacing/collision test; (3) a failure-isolation test; (4) a resolver+merge test combining MCP and Composio; (5) schema/migration tests for the default `mcpSelection` and `repository_mcp_settings`. **Fixtures/setup**: the POC `src/test-server.ts` stdio server, `@modelcontextprotocol/server-filesystem` scoped to a temp dir, and a fake/blocked-egress HTTP endpoint. **Fail-before/pass-after**: before, the client/resolver/columns don't exist (red); after, the round trip passes, namespacing holds, one bad server is isolated, and the merge has no collisions. **Limits — what it will NOT catch**: real RCE/exfiltration safety of running arbitrary stdio servers in the microVM (a sandbox-execution validation, not a unit test), prompt-injection via malicious tool descriptions/results, SSRF/egress behavior of arbitrary HTTP servers, and production tool-count/token-cost bloat across many mounted servers.

## TDD audit trail

- **Red commit**: add the client round-trip, namespacing, failure-isolation, and resolver/merge tests. Command: `bun test packages/agent/mcp/mcp-client.test.ts apps/web/app/workflows/chat.mcp.test.ts`. Expected failing output: `cannot find module ".../mcp-client"` / `resolveMcpToolsForChat is not a function` and assertions like `expected tool "mcp__math__add" … received undefined`. Commit the red tests.
- **Green commit**: integrate the client + resolver + schema; rerun the same command; expected `pass` (round trip returns `5`, namespaces present, bad server isolated, merge collision-free). Commit green.
- **Exception**: the schema migration `.sql` is generated (not hand-written) and committed with the green change; note this if generation and the test land in the same commit.

## Regression risks and concerns

- **"Where stdio servers run" is an unsolved security fork** (PRODUCT-BRIEF case AGAINST #1): spawning user-configured commands in the web process is flat-out RCE/exfiltration — must run inside the per-session sandbox with limits; HTTP servers dodge spawning but introduce SSRF/egress concerns.
- **Untrusted model-visible content is a prompt-injection vector** (case AGAINST #2): third-party servers control tool descriptions and results; namespacing prevents name collisions, not malicious content; blast radius includes whatever those servers (DBs, internal APIs) can touch.
- **Tool-count bloat degrades every turn** (case AGAINST #3): 16 tools from two servers already; mounting several balloons system-prompt tokens, slowing even non-MCP work — mandatory allow/deny + cap.
- **Composio overlap may confuse users/model** (case AGAINST #4): two parallel external-tool systems; mitigate with clear provenance badges and shared patterns.
- **`managed_runtime` filters MCP out by default + client-side validation gap** (case AGAINST #5): headline value may not reach the default surface; the server is the only validation boundary.
- **Per-server failure + version coupling** (README): mount-sequentially must degrade gracefully; `@ai-sdk/mcp` still `experimental_`.

## Deploy or migration impact

- **Migrations**: `add` an `mcpSelection` jsonb column (default `{ servers: [] }`) on `chats` and create the `repository_mcp_settings` table; generate via `bun run --cwd apps/web db:generate` and commit the `.sql` (Neon branch-per-preview means previews apply it in isolation).
- **Env/flags**: a feature flag to enable MCP per repo; an egress allowlist for remote servers; encrypted-secret storage config for `env`/`headers`.
- **Sandbox/managed-runtime**: sandbox-hosted stdio execution needs `exec`/`domain(port)` with resource/time limits; the `managed_runtime` `pickTools` allowlist stays excluding `mcp__*` until a deliberate policy change.
- **Auth/security**: server credentials stored encrypted like Composio connected-accounts; reuse prompt-injection hardening.
- **Rollout/rollback**: ship remote-HTTP-first behind the flag, then enable sandbox-hosted stdio; rollback by disabling the flag (resolver returns no MCP tools; Composio path unaffected). **Cost**: per-turn connect latency + sandbox compute for stdio servers + token cost from larger tool sets (bounded by allow/deny + cap).

## Definition of done

- [ ] Red test observed first (client round trip + resolver + schema failing).
- [ ] Behavior proof red before implementation captured.
- [ ] Red-test commit (or documented exception) recorded.
- [ ] Green commit after red.
- [ ] Targeted tests pass (MCP client round trip + namespacing + isolation + merge).
- [ ] Adjacent suite passes (chat workflow / Composio resolution / open-agent merge / schema).
- [ ] `git diff --check` clean.
- [ ] `bun --bun run ci` passes.
- [ ] Regression harness implemented (ported eval against two real servers + isolation + merge + migration tests).
- [ ] Docs updated (MCP Servers settings, secret handling, sandbox-execution note, allow/deny + cap; lessons-learned).
- [ ] Observability evidence captured ("Test connection" + badged tool-call + partial-failure screenshots + `mcp.*` log lines).
- [ ] Deploy notes included (migration, flag, egress allowlist, sandbox execution, rollback).
