# POC 1c — First-class MCP client inside the agent

A generic **Model Context Protocol (MCP) client** that lets any agent session
mount arbitrary MCP servers (databases, internal tools, filesystem, etc.)
per-repo / per-session, discovers their tools, and exposes them to the agent's
tool loop as ordinary AI-SDK tools — complementing the existing Composio SaaS
integrations.

This is a **complete, working proof-of-concept**, not a smoke test. It performs
a real end-to-end round trip against two real MCP servers with no mocks.

---

## Goal

Prove that the agent can:

1. Take a per-session list of MCP server configs (stdio command+args, or
   HTTP/SSE URL).
2. Connect to each server, discover its tools, and adapt them into
   AI-SDK-compatible `Tool` definitions that merge into the agent's `ToolSet`.
3. Namespace tools to avoid collisions with built-in tools (`read`, `bash`, …)
   and Composio tools (`COMPOSIO_*`): `mcp__<server>__<tool>`.
4. Invoke a mounted tool **the way the agent tool loop calls it** (validate
   args → `tool.execute(args, options)`) and get the correct result back.
5. Cleanly tear down all transports (lifecycle: connect → list → call → close).

---

## What was built

All code is self-contained in `POC/1c-mcp-client/` (its own `package.json` and
`node_modules`; **nothing in the root workspace was touched**).

| File | Purpose |
|------|---------|
| `src/types.ts` | Zod schemas for MCP server configs (`stdio` / `http` / `sse`) and a per-session `McpSessionSelection`. Modeled on the standard `mcpServers` config shape, and on `ChatComposioSelection`. |
| `src/mcp-client.ts` | The core. `mountServer()` connects one server and adapts its tools; `McpSessionClient` mounts a *set* of servers, exposes the merged namespaced `ToolSet`, and owns lifecycle/cleanup. Includes `namespacedToolName` / `parseNamespacedToolName`. |
| `src/test-server.ts` | A tiny **real** stdio MCP server built on the official `@modelcontextprotocol/sdk`, exposing deterministic `add(a,b)` and `echo(text)` tools so results are exactly assertable. |
| `src/eval.ts` | The end-to-end eval harness (connect → list → call → guard → close), writing evidence. |

### Chosen SDK + transport, and why

- **AI SDK MCP client** (`@ai-sdk/mcp` v1.0.45, the package that backs
  `experimental_createMCPClient` in AI SDK v6) for the **client** side. The repo
  already runs **AI SDK v6** (`ai@6.0.168` in `packages/agent/node_modules`), and
  `client.tools()` returns objects that are already AI-SDK `Tool`s — so they drop
  straight into the agent's `ToolSet` with zero adapter glue. This is the lowest-
  friction path to "MCP tools become agent tools."
- **Official `@modelcontextprotocol/sdk`** (v1.29.0) for the **server** side of
  the test (and for the real `@modelcontextprotocol/server-filesystem`). Using
  the canonical SDK proves interop against a spec-compliant server, not a toy.
- **Transport: stdio** for the eval, because it is the most reliable, dependency-
  free transport and the one used by the broad MCP ecosystem (Claude Desktop,
  Cursor, filesystem/everything servers). The client module **also supports
  Streamable HTTP (`type: "http"`) and legacy SSE (`type: "sse"`)** via config —
  Streamable HTTP is the current remote transport; SSE is retained only for
  backward compatibility.

---

## How it was tested + evidence

Run:

```bash
cd POC/1c-mcp-client
npm install
npm run eval        # node --experimental-strip-types src/eval.ts
```

The eval mounts **two real MCP servers** from a session selection:

- `math` — the custom stdio server (`add`, `echo`)
- `fs` — the official `@modelcontextprotocol/server-filesystem` (stdio), scoped
  to a freshly created temp dir

It then asserts (exit code `0` only if every check passes):

1. **CONNECT** — both servers complete the MCP `initialize` handshake
   (`poc-test-server v0.1.0`, `secure-filesystem-server v0.2.0`).
2. **LIST** — discovered tools appear under the namespace; asserts
   `mcp__math__add`, `mcp__math__echo`, and a `mcp__fs__read*` tool exist
   (16 tools total across the two servers).
3. **CALL** — `add(2,3) == 5`, `echo("hello") == "echo: hello"`.
4. **CALL (real server)** — `mcp__fs__read_text_file` of a file we wrote
   returns its exact contents.
5. **GUARD** — invalid args (`add({a:"not-a-number"})`) are rejected by the
   server with `MCP error -32602: Input validation error`.
6. **CLOSE** — all transports torn down.

Evidence is captured to:

- `evidence/transcript.txt` — full connect/list/call/close transcript.
- `evidence/summary.json` — `{ "passed": true, "failures": 0, ... }`.

Latest run: **ALL CHECKS PASSED** (see `evidence/`). Typecheck: `npx tsc
--noEmit` → 0 errors.

Each adapted tool is invoked exactly as the AI SDK tool loop would: args are
run through the SDK's own `safeValidateTypes({ value, schema:
tool.inputSchema })`, then `tool.execute(args, { toolCallId, messages })` is
called — the same code path `streamText`/`ToolLoopAgent` uses internally.

---

## Integration plan into the real codebase

The agent already merges externally-supplied tools into its tool set; MCP tools
follow the **exact same path Composio uses today**. Three touch points:

### 1. Tool registration / merging — `packages/agent/open-agent.ts`

Externally-provided tools flow in through
`getRuntimeModeToolPolicy(runtimeMode, requestedTools)`:

```ts
// packages/agent/open-agent.ts
export function getRuntimeModeToolPolicy(runtimeMode, requestedTools?) {
  const mergedTools = requestedTools ? { ...tools, ...requestedTools } : tools;
  ...
}
```

and `prepareCall` passes `settings.tools` (the per-call tools) into it. **No
change is required in `open-agent.ts`** — the MCP `ToolSet` produced by
`McpSessionClient.tools()` is merged the same way Composio's `ToolSet` already
is. (The only consideration: `managed_runtime` mode currently restricts to a
fixed allowlist via `pickTools`, so MCP tools would be filtered out there unless
the allowlist is extended — a deliberate policy decision.)

### 2. Per-session config — `apps/web/lib/db/schema.ts`

Add an `mcpSelection` jsonb column on `chats`, mirroring `composioSelection`:

```ts
// schema.ts (existing)
composioSelection: jsonb("composio_selection")
  .$type<ChatComposioSelection>()
  .notNull()
  .default(defaultChatComposioSelection),

// proposed addition
mcpSelection: jsonb("mcp_selection")
  .$type<McpSessionSelection>()   // from src/types.ts
  .notNull()
  .default({ servers: [] }),
```

Per-repo defaults would mirror `repository_composio_settings`
(schema.ts ~L977) — a `repository_mcp_settings` table with allowed/blocked
server configs that a chat selection inherits. Server secrets (DB URLs, API
keys) belong in the `env`/`headers` fields and should be stored encrypted /
referenced indirectly, exactly as Composio connected-account credentials are.

### 3. Flowing tools into the agent — `apps/web/app/workflows/chat.ts`

Composio resolves a `ToolSet` per turn and passes it into the stream:

```ts
// chat.ts (existing, ~L1789-1873)
let composioTools: ToolSet | undefined;
const composioResult = await resolveComposioToolsForChat({ ... });
if (composioResult.status === "ready") composioTools = composioResult.tools;
...
const result = await webAgent.stream({
  messages,
  options: stepAgentOptions,
  ...(composioTools ? { tools: composioTools } : {}),
});
```

The MCP equivalent is a `resolveMcpToolsForChat(...)` that reads the chat's
`mcpSelection`, calls `McpSessionClient.mount(selection)`, and returns
`session.tools()`. Then **merge** with Composio (last-write-wins on key, but the
`mcp__`/`COMPOSIO_` namespaces never collide):

```ts
const mcpSession = await McpSessionClient.mount(selection);
try {
  const requestedTools = { ...composioTools, ...mcpSession.tools() };
  const result = await webAgent.stream({
    messages, options: stepAgentOptions,
    ...(Object.keys(requestedTools).length ? { tools: requestedTools } : {}),
  });
  // ... consume stream ...
} finally {
  await mcpSession.close();   // lifecycle: close after the turn
}
```

Observability events (`mcp.server.mounted`, `mcp.tool.called`,
`mcp.session.failed`) would be emitted alongside the existing
`composio.profile.selected` / `composio.session.*` events in `chat.ts`.

---

## Feasibility verdict

**Strongly feasible, low-risk.** The AI SDK v6 already in the repo ships a
production MCP client whose output type is the agent's existing `ToolSet`. MCP
tools require **zero new merge machinery** — they reuse the exact
`requestedTools` path Composio uses. A real round trip against both a custom
server and the official filesystem server works end to end. Estimated work to
ship: a config column + resolver + UI for selecting servers, plus the
sandbox-execution decision below.

---

## Blind spots eliminated

- **Transport choice.** Verified all three transports are supported by
  `@ai-sdk/mcp` (`Experimental_StdioMCPTransport` for stdio; `{ type: "http" }`
  Streamable HTTP and `{ type: "sse" }` in config). stdio proven end-to-end;
  HTTP/SSE wired in the config schema. Streamable HTTP is the current remote
  transport; SSE is legacy.
- **Auth/secrets for MCP servers.** The config carries `env` (stdio) and
  `headers` (HTTP, e.g. `Authorization: Bearer …`); `@ai-sdk/mcp` also exposes
  an `authProvider` OAuth hook. These map onto the same
  encrypted-credential pattern Composio already uses — secrets never need to be
  inlined in the model-visible config.
- **Adapter compatibility.** Confirmed `client.tools()` returns objects that ARE
  AI-SDK `Tool`s (carrying a `jsonSchema()` `inputSchema` and an `execute` that
  proxies `callTool`). They merge into `ToolSet` directly and execute via the
  normal loop.
- **Client-side arg validation gap (important).** AI SDK v6 adapts MCP tools
  (`schemas: "automatic"`) with a JSON-Schema-only schema that has **no
  client-side `validate()`** — so `safeValidateTypes` passes args through
  unchecked. The **real validation boundary is the MCP server**, which rejects
  bad input with `-32602`. The eval proves this. Implication: do not assume the
  agent host validates MCP tool args; trust the server, and treat server errors
  as the contract.
- **Tool-count / context bloat.** Two servers already yield 16 tools; the
  filesystem server alone is 14. Mounting several servers will balloon the tool
  list and the system-prompt token cost. `McpSessionClient.toolCount()` exposes
  this; a real integration needs per-server tool allow/deny lists (like
  Composio's `blockedToolkitSlugs`) and/or a cap.

---

## Remaining risks

- **Where MCP servers run: sandbox vs. web process.** stdio servers spawn a
  child process. Running arbitrary user-configured commands **inside the web
  process is a serious RCE/exfiltration risk** and was deliberately NOT done
  here beyond the trusted eval. Production should run stdio MCP servers **inside
  the per-session sandbox** (`packages/sandbox`), close to the workspace, with
  resource/time limits — not in the Next.js server. Remote (HTTP/SSE) servers
  avoid local spawning but introduce SSRF/egress concerns instead.
- **Lifecycle across streaming turns.** The POC mounts/closes within one call.
  In `chat.ts`, mounting per turn is simplest and safest (proven here) but adds
  per-turn connect latency; a pooled/long-lived session would need careful
  cleanup on abort/disconnect (the existing `abortController` path is the hook).
- **Untrusted tool descriptions / prompt injection.** MCP tool descriptions and
  results are model-visible and attacker-controllable for third-party servers.
  Namespacing prevents *name* collisions but not malicious *content*; the same
  prompt-injection hardening applied to web/Composio content applies here.
- **Per-server failure isolation.** `McpSessionClient.mount` connects
  sequentially so one bad server yields an attributable error; production should
  degrade gracefully (mount the healthy servers, surface the failed one as an
  observability event) rather than failing the whole turn.
- **Version pinning.** `@ai-sdk/mcp` is at v1.0.x and still exports the
  `experimental_` aliases; track the AI SDK MCP API as it stabilizes.
```
