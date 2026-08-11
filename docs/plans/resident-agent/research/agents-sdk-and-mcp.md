# Agents SDK & MCP

**TL;DR:** Cloudflare's Agents SDK (`agents` on npm, v0.20.1 as of 2026-07-28) is a pre-1.0 but heavily developed library that maps one `Agent` class instance to one Durable Object with embedded SQLite, giving each resident worker durable identity, state, scheduling (alarms/cron), WebSocket hibernation, and durable execution ("fibers") essentially for free. For MCP, the picture is in transition: the stateful `McpAgent` Durable Object class is **deprecated and feature-frozen** (docs updated 2026-07-27/28) in favor of a stateless `createMcpHandler` built on MCP SDK v2 (`@modelcontextprotocol/server`), tracking the MCP 2026-07-28 spec revision. The Agents SDK also ships a full MCP *client* (`this.addMcpServer()` over HTTP/SSE/RPC) so a Cloudflare-hosted agent can call out to other MCP servers — directly relevant to worker-to-worker delegation. OAuth is solved by the separate `@cloudflare/workers-oauth-provider` library (v0.4.0), which implements the OAuth 2.1 provider side with PKCE, RFC 7591 Dynamic Client Registration, and the newer Client ID Metadata Documents (CIMD) — meaning external agents (Claude Code, ChatGPT, Codex) can register and connect without pre-provisioned credentials. Main risks: SDK is 0.x with fast-breaking API churn (MCP surface was just re-built), `McpAgent` deprecation means the "stateful MCP server per DO" pattern the resident-agent design wants is exactly the thing being moved away from, and Project Think (the long-running-agent layer) is explicitly preview/experimental.

**Status/maturity:** Agents SDK v0.20.1 (npm, published 2026-07-28; 645 published versions; repo created 2025-01-29, ~5.4k GitHub stars, very active — last push 2026-08-11, 158 open issues). `@cloudflare/workers-oauth-provider` v0.4.0 (published ~2026-06; 51 versions; ~1.9k stars, 18 open issues). Project Think announced 2026-04-15 (blog updated 2026-07-15), labeled **experimental/preview**. MCP docs revised 2026-07-27/28 around the MCP 2026-07-28 authorization spec and MCP SDK v2 migration. Everything here is pre-1.0 and moving fast — re-verify against docs before implementation.

---

## Agents SDK core

Source: [cloudflare/agents GitHub README](https://github.com/cloudflare/agents), [Agents docs overview](https://developers.cloudflare.com/agents/), [Project Think blog post](https://blog.cloudflare.com/project-think/) (published 2026-04-15, modified 2026-07-15).

### The `Agent` class and Durable Object identity

Each `Agent` subclass instance **is** a Durable Object. Agents are addressed by class + name; `routeAgentRequest()` routes HTTP/WebSocket traffic, `getAgentByName()` fetches a named instance. Hibernation is the default: an idle agent consumes zero compute, keeps WebSocket connections open (hibernation API), and wakes on HTTP request, WS message, alarm, or inbound email.

Minimal agent with state and RPC (source: [github.com/cloudflare/agents](https://github.com/cloudflare/agents)):

```ts
// server.ts
import { Agent, routeAgentRequest, callable } from "agents";

export type CounterState = { count: number };

export class CounterAgent extends Agent<Env, CounterState> {
  initialState = { count: 0 };

  @callable()
  increment() {
    this.setState({ count: this.state.count + 1 });
    return this.state.count;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  }
};
```

The agent needs a DO binding and a SQLite migration in `wrangler.jsonc` (`new_sqlite_classes`). Cloudflare claims the SDK "is already powering thousands of production agents" (Project Think post, 2026-04-15) — unverifiable externally, treat as vendor claim.

### State management

Source: [Store and sync state](https://developers.cloudflare.com/agents/api-reference/store-and-sync-state/).

Two tiers, both colocated in the DO:

- **`this.state` / `this.setState()`** — JSON-serializable state object, persisted to SQLite, **broadcast to all connected WebSocket clients on every change**, with `onStateChanged(state, source)` and a synchronous `validateStateChange()` hook (throw to reject). Meant for small "hot" UI/session state.
- **`this.sql` template tag** — direct SQLite queries against the per-agent database for large/queryable data:

```ts
export class MyAgent extends Agent {
  async onRequest(request: Request) {
    let userId = new URL(request.url).searchParams.get("userId");
    let [user] = this.sql<User>`SELECT * FROM users WHERE id = ${userId}`;
    return Response.json(user);
  }
}
```

Docs recommend keeping `state` light and putting history/collections in SQL. Max state per agent: **1 GB** (see Limits).

### Scheduling (alarms / cron)

Source: [Schedule tasks](https://developers.cloudflare.com/agents/api-reference/schedule-tasks/).

Four modes, all persisted in SQLite and fired via DO alarms — they survive restarts/hibernation:

| Mode | Syntax | Granularity |
| --- | --- | --- |
| Delayed | `this.schedule(60, "cb", payload)` | seconds |
| At a time | `this.schedule(new Date(...), "cb", payload)` | — |
| Cron | `this.schedule("0 8 * * *", "cb", payload)` | minute |
| Interval | `this.scheduleEvery(30, "cb", payload)` | seconds, with overlap-skip |

```ts
export class ReminderAgent extends Agent {
  async onStart() {
    // cron schedules are idempotent by default — safe in onStart()
    await this.schedule("0 8 * * *", "dailyDigest", { userId: "u1" });
    await this.scheduleEvery(30, "poll", { source: "api" });
  }
  async dailyDigest(payload: { userId: string }) { /* ... */ }
  async poll(payload: { source: string }) { /* errors don't stop the interval */ }
}
```

Also: `listSchedules()`, `cancelSchedule(id)`, `getScheduleById(id)`, per-task `retry` options, and `destroy()` (self-destruct is safe from a scheduled callback — relevant for TTL-ing resident workers). Practical limit: tens of thousands of tasks per agent; task payload ≤ 2 MB.

### WebSocket hibernation and lifecycle

Source: [WebSockets](https://developers.cloudflare.com/agents/api-reference/websockets/).

Lifecycle hooks: `onStart(props?)`, `onRequest(request)`, `onConnect(connection, ctx)`, `onMessage`, `onClose`, `onError`, `shouldSendProtocolMessages`. Hibernation is on by default (`static options = { hibernate: false }` to disable). What persists across hibernation: `this.state`, per-connection `connection.state`, SQLite data, connection metadata. What doesn't: in-memory variables, timers, in-flight promises.

Long-running work protection: `keepAlive()` / `keepAliveWhile(fn)` hold a 30-second alarm-backed heartbeat to prevent idle eviction (DOs are evicted after ~70–140 s of inactivity). `AIChatAgent` calls `keepAlive()` automatically during LLM streaming.

### Fibers (durable execution) and Project Think

Source: [Project Think blog](https://blog.cloudflare.com/project-think/) (2026-04-15).

`runFiber()` is a durable function invocation: registered in SQLite before execution, checkpointed via `ctx.stash()`, recovered on restart via `onFiberRecovered`:

```ts
import { Agent } from "agents";

export class ResearchAgent extends Agent {
  async startResearch(topic: string) {
    void this.runFiber("research", async (ctx) => {
      const findings = [];
      for (let i = 0; i < 10; i++) {
        const result = await this.callLLM(`Research step ${i}: ${topic}`);
        findings.push(result);
        ctx.stash({ findings, step: i, topic }); // checkpoint
        this.broadcast({ type: "progress", step: i });
      }
      return { findings };
    });
  }

  async onFiberRecovered(ctx) {
    if (ctx.name === "research" && ctx.snapshot) {
      await this.startResearch(ctx.snapshot.topic);
    }
  }
}
```

Note the recovery model is **restart-the-function with your checkpoint**, not transparent mid-execution resume — you re-run and skip ahead using the stash. For very long operations (CI pipelines, video gen) Cloudflare's own guidance is: start the work, persist the job ID, hibernate, wake on callback.

Other Project Think primitives (all usable from the base `Agent` class):

- **Sub-agents via Facets** — `this.subAgent(ResearchAgent, "research")` spawns child DOs colocated with the parent, each with isolated SQLite, typed RPC (function-call latency). This is the SDK-native delegation primitive.
- **Session API** (`agents/experimental/memory/session`) — tree-structured messages with `parent_id`, forking, non-destructive compaction, FTS5 full-text search.
- **`Think` base class** (`@cloudflare/think`) — opinionated harness: agentic loop, stream resumption, persistent memory "context blocks", workspace tools, sandbox tools, self-authored extensions. **Explicitly experimental/preview.**
- **Execution ladder** — Tier 0 workspace (`@cloudflare/shell`, SQLite+R2 virtual FS) → Tier 1 Dynamic Workers/codemode → Tier 2 npm via worker-bundler → Tier 3 Browser → Tier 4 Cloudflare Sandbox containers (the tier relevant to running Pi/Claude Code inside).

Packages: `agents` (core), `@cloudflare/ai-chat`, `@cloudflare/think`, `@cloudflare/codemode`, `@cloudflare/shell`, `@cloudflare/voice`, `@cloudflare/worker-bundler`, `hono-agents`. Repo has 30+ examples including `mcp-client`, `mcp-worker-authenticated`, `mcp-rpc-transport`, `workflows`, `a2a`. **Repo is not accepting external PRs** ("SDK is evolving quickly") — a signal of API instability.

## MCP server hosting

Sources: [McpAgent API](https://developers.cloudflare.com/agents/model-context-protocol/apis/agent-api/), [Handler API](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/), [Transport](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/), [Build a Remote MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/) (all updated 2026-07-27/28).

**Critical, recent development:** the MCP surface was rebuilt around MCP SDK v2 and the MCP 2026-07-28 spec. Decision table from the docs:

| Approach | Stateful? | Protocol path | Status |
| --- | --- | --- | --- |
| `createMcpHandler()` (`agents/mcp/server`) | No | stateless + legacy compat | **Recommended for new servers** |
| `createLegacyMcpHandler()` (`agents/mcp`) | Optional | legacy sessions via `WorkerTransport` | Temporary migration bridge |
| `McpAgent` | Yes (Durable Object) | legacy | **Deprecated, feature-frozen** |

### `createMcpHandler` (the current path)

Creates a stateless Streamable HTTP handler from an MCP SDK v2 server factory — one fresh `McpServer` per request; there is **no protocol-level session** on this path:

```ts
import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

function createServer() {
  const server = new McpServer({ name: "My MCP Server", version: "1.0.0" });

  server.registerTool(
    "hello",
    {
      description: "Returns a greeting message",
      inputSchema: { name: z.string().optional() },
    },
    async ({ name }) => ({
      content: [{ text: `Hello, ${name ?? "World"}!`, type: "text" }],
    }),
  );

  return server;
}

export default {
  fetch(request, env, ctx) {
    return createMcpHandler(createServer)(request, env, ctx);
  },
} satisfies ExportedHandler;
```

Key properties: `route` (default `/mcp`), CORS on by default with browser Origin/Host validation (DNS-rebinding protection), `authContext` / `getMcpAuthContext()` for OAuth props, `context.http.authInfo` for standard token metadata, `responseMode: "json" | "sse" | "auto"`, keepalive on listen streams (default 15 s), max 1,024 concurrent subscriptions. Durable data must live behind your own storage boundary (DO, D1, KV, R2) — the docs say this explicitly. Elicitation on this path is stateless via multi-round-trip requests (MRTR).

### `McpAgent` (deprecated but directly relevant)

`McpAgent` makes each MCP server instance a stateful DO with its own SQLite — architecturally the closest existing thing to "resident worker exposed over MCP":

```ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export class MyMCP extends McpAgent {
  server = new McpServer({ name: "Demo", version: "1.0.0" });
  initialState = { counter: 1 };

  async init() {
    this.server.tool(
      "add",
      { a: z.number() },
      async ({ a }) => {
        this.setState({ ...this.state, counter: this.state.counter + a });
        return { content: [{ type: "text", text: `total: ${this.state.counter}` }] };
      },
    );
  }
}

export default MyMCP.serve("/mcp"); // ~15 lines to a deployed stateful MCP server
```

Features: full Agent state APIs (`state`, `setState`, `sql`), `props` from OAuth, elicitation (form + URL modes), WebSocket hibernation by default, EU/FedRAMP jurisdiction pinning, and a Streamable HTTP transport hardened against Cloudflare's ~5-minute edge idle-stream watchdog (comment-frame keepalives every 25 s; `Last-Event-ID` resumability when a `DurableObjectEventStore` is configured). That watchdog hardening matters for long tool calls — but it's documented on the deprecated path; verify equivalent behavior on `createMcpHandler` (its `keepAliveMs` option suggests it's covered).

### How MCP routes to Durable Objects

Two patterns:

1. **`McpAgent.serve("/mcp")`** — Worker handler routes to DO-backed instances directly (deprecated path).
2. **Recommended composition for new builds:** a plain `Agent` DO (your resident worker) plus `createMcpHandler` at the edge, where each tool handler calls into the named agent via `getAgentByName(env.MyAgent, name)` — i.e. the MCP front door is stateless protocol plumbing and the DO owns state. The docs' own guidance ("store cross-request data behind an authenticated handle in a Durable Object") points this way.

### Transports

| Transport | Use | Auth |
| --- | --- | --- |
| Streamable HTTP | External clients, production | OAuth supported |
| RPC (DO binding) | Agent↔MCP within Cloudflare | **None** — internal only |
| SSE | Legacy clients | Deprecated |

## MCP client support (calling OUT)

Source: [McpClient API](https://developers.cloudflare.com/agents/model-context-protocol/apis/client-api/) (Agents SDK v0.20.0+ uses `@modelcontextprotocol/client`).

Yes — a Cloudflare-hosted `Agent` is a first-class MCP client:

```ts
import { Agent } from "agents";

export class MyAgent extends Agent {
  async onRequest(request: Request) {
    const result = await this.addMcpServer("github", "https://mcp.github.com/mcp");

    if (result.state === "authenticating") {
      return Response.redirect(result.authUrl); // server requires OAuth
    }
    return Response.json({ status: "connected", id: result.id });
  }
}
```

Details relevant to worker-to-worker delegation:

- **Persistence:** registrations, OAuth tokens, and transport config are stored in the agent's SQLite and **restored automatically after hibernation/restart**.
- **Transports:** `streamable-http` (default `auto`), `sse`, and **RPC over a Durable Object binding** (`addMcpServer("name", this.env.MyMCP)`) — zero-HTTP-overhead MCP calls between agents in the same Worker. RPC carries caller `props` (e.g. `{ userId, role }`) but no OAuth.
- **Stable server IDs:** `addMcpServer("GitHub", url, { id: "github" })` makes tools surface as `tool_github_<name>`; idempotent re-registration; transparent migration from generated IDs.
- **Tool access:** `this.mcp.listTools()` (raw catalog), `this.mcp.getAITools()` (AI SDK format, namespaced by server ID), `waitForConnections()` after wake.
- **OAuth client side:** the agent performs **Dynamic Client Registration by default** when connecting to OAuth-protected servers; callback URL auto-derived (`https://{host}/agents/{agent-name}/{instance-name}/callback`); overridable via `createMcpOAuthProvider()` for pre-registered credentials; token storage pluggable via `DurableObjectOAuthClientProvider`.
- **SSRF guard:** `addMcpServer` blocks private/loopback/metadata IP ranges (loopback allowed in dev). For internal services the docs steer you to RPC transport.
- **Elicitation handlers** configurable per mode; server-initiated input requests can be forwarded to a browser UI over the agent's WebSocket broadcast.

## OAuth for MCP

Sources: [workers-oauth-provider README](https://github.com/cloudflare/workers-oauth-provider), [Authorization docs](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/), npm page showing v0.4.0 (2026-06).

`@cloudflare/workers-oauth-provider` implements the **provider side of OAuth 2.1** as a wrapper around your Worker. It handles: authorization-code flow, PKCE (S256 default), token issuance/refresh/rotation/revocation, RFC 8414 authorization-server metadata, RFC 9728 protected-resource metadata, RFC 8707 resource indicators, RFC 9207 issuer identification, RFC 7591 DCR, and CIMD. Tokens/secrets are stored hashed in KV (`OAUTH_KV` binding); `props` (your per-user data, e.g. upstream tokens) are AES-GCM encrypted.

Canonical wiring (source: workers-oauth-provider README):

```ts
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: createMcpHandler(createServer), // or MyMCP.serve("/mcp") on the legacy path
  defaultHandler,                              // owns /authorize: login + consent UI

  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",

  scopesSupported: ["mcp:read"],

  resourceMetadata: {
    resource: "https://mcp.example.com/mcp",
    authorization_servers: ["https://mcp.example.com"],
    scopes_supported: ["mcp:read"],
    resource_name: "Example MCP server",
  },

  // Preferred for clients with no pre-existing relationship (needs
  // global_fetch_strictly_public compat flag for SSRF protection):
  clientIdMetadataDocumentEnabled: true,

  // Compatibility fallback. MCP 2026-07-28 deprecates DCR for new clients:
  clientRegistrationEndpoint: "/oauth/register",
});
```

Inside the default handler, the flow is `env.OAUTH_PROVIDER.parseAuthRequest(request)` → authenticate user + consent → `completeAuthorization({ request, userId, scope, props })` → redirect. The provider is **not an identity provider** — you bring authentication (your own, GitHub/Google, Access, Stytch/Auth0/WorkOS/Descope — all have runnable Cloudflare examples).

### Can external agents (Claude Code, ChatGPT, Codex, Devin) connect?

Mechanically yes, and this is the designed-for case:

- **DCR (RFC 7591):** enable `clientRegistrationEndpoint` and any MCP client that supports dynamic registration can self-register. Options: `clientRegistrationTTL` (default 90 days), `disallowPublicClientRegistration`, `clientRegistrationCallback` for policy gating.
- **CIMD:** clients that use an HTTPS URL as `client_id` (the direction the MCP 2026-07-28 spec pushes) are supported, validated per draft-ietf-oauth-client-id-metadata-document-00.
- **Discovery:** standard `401` → `WWW-Authenticate` with `resource_metadata` → RFC 9728 → RFC 8414 chain, which is what conformant MCP clients implement.
- Clients without remote/OAuth support can bridge via the `mcp-remote` local proxy (used for Claude Desktop in Cloudflare's own guide).

Known gaps/caveats:

- **CIMD token auth:** only `token_endpoint_auth_method: "none"` is implemented; a CIMD client offering only `private_key_jwt` is rejected.
- **No operation-level scope enforcement:** the provider validates tokens and exposes `ctx.props`, but per-tool permission checks are your job (check inside handlers or conditionally register tools).
- **Human-in-the-loop by default:** the standard flow assumes a browser-based consent step. A pure machine-to-machine external agent with no user present needs either a pre-registered client (`OAuthHelpers.createClient()`), token exchange (`allowTokenExchangeGrant`, RFC 8693), or the experimental Enterprise-Managed Authorization (ID-JAG) path. There is no client-credentials grant mentioned in the README — **verify** how you'd onboard a headless agent client.
- Token audience binding: MCP clients must send the canonical server URI as `resource`; path-boundary prefix matching applies.
- KV-based storage means OAuth state is global-edge KV (eventual consistency characteristics); grants enumeration is per-user by design.

## Limits & pricing

Source: [Agents limits](https://developers.cloudflare.com/agents/platform/limits/) — deliberately brief here; DO/Workers limits are another researcher's scope.

Agents-SDK-specific limits:

| Feature | Limit |
| --- | --- |
| Concurrent running agents per account | "Tens of millions+" |
| Agent class definitions per account | ~250,000 |
| State per agent | 1 GB |
| Compute time per agent | 30 s CPU, refreshed per HTTP request / WS message; wall-clock wait time (LLM calls, DB) unlimited |
| Scheduled tasks | tens of thousands per agent; payload ≤ 2 MB; cron = minute precision, interval = second precision |
| DO idle eviction | ~70–140 s without requests/messages/alarms (mitigate with `keepAlive` / fibers) |

Pricing: no Agents-SDK-specific pricing — it rides on Workers + Durable Objects billing (requests, duration, DO storage). DOs (with SQLite) are available on the Workers **Free** plan since 2025-04-07 per the DO changelog. The headline economic claim is hibernation: idle agents cost ~$0 (Project Think post: "10,000 agents each active 1% of the time ≈ 100 active at any moment"). The OAuth provider additionally needs a KV namespace (KV pricing).

## Fit for resident agent service

Architecture under evaluation: Worker MCP front door → one DO per resident worker (identity + SQLite memory) → Workflows for turn execution → Sandbox SDK containers running third-party coding agents → R2 workspace persistence. External agents connect as OAuth MCP clients.

**What the Agents SDK gives for free:**

- **One DO per worker with name-addressable identity** — the core `Agent` class *is* this pattern, including `routeAgentRequest`/`getAgentByName` routing, hibernation, and SQLite memory. This is the SDK's center of gravity, not an edge case.
- **Durable execution for turns:** fibers (`runFiber`/`stash`/`onFiberRecovered`) + scheduling (cron/interval/delayed, idempotent) + `keepAliveWhile` cover much of what Workflows would be used for; SDK also integrates with Cloudflare Workflows (`step.updateAgentState` etc.) if you want both.
- **MCP client for delegation:** `addMcpServer` with RPC transport gives zero-overhead worker→worker MCP calls inside the same account; HTTP transport + built-in DCR OAuth client for external servers.
- **MCP server plumbing:** `createMcpHandler` handles Streamable HTTP, CORS/Origin validation, auth context propagation — the front door is mostly boilerplate.
- **OAuth provider:** `@cloudflare/workers-oauth-provider` is a production-grade OAuth 2.1 AS with DCR + CIMD — exactly what's needed for arbitrary external agents to onboard without manual client provisioning.
- **Elicitation** (form/URL modes) maps well to "ask the operator a question mid-task".
- **Execution ladder / Sandbox integration:** Project Think's Tier 4 is Cloudflare Sandbox with bidirectional workspace sync (`@cloudflare/shell` workspace backed by SQLite + R2) — aligned with the R2-persistence plan.
- **Real-time inspection:** state broadcast over WebSocket + `agents/react` hooks give "inspect the worker's work" UI nearly free.

**What we'd hand-roll:**

- **MCP-front-door → resident-DO bridging on the modern path.** Since `McpAgent` is deprecated, the stateless `createMcpHandler` must route each tool call to the right named DO (e.g. `getAgentByName(env.Worker, taskId)` from URL or token `props`). Cloudflare endorses this composition, but the per-request mapping, naming scheme, and auth-context → agent-instance binding are ours to build.
- **Tool surface design** for tasking/questioning/inspecting workers, per-client tool gating (provider gives `props`; per-tool scope enforcement is app code).
- **Headless client onboarding:** consent-flow UX assumes a browser; for autonomous external agents we must design pre-registration or token-exchange flows ourselves.
- **Workspace persistence model:** `@cloudflare/shell` offers a SQLite+R2 virtual FS, but syncing real Sandbox container filesystems (running Pi/Claude Code) to R2 is our integration work (covered by the sandbox research).
- **Multi-tenant isolation policy:** per-client/per-user grants, revocation UX, audit logging.

**Missing or risky:**

- **0.x everything.** `agents` 0.20.1, oauth-provider 0.4.0, `@cloudflare/think` preview, Session API experimental. The MCP server API was wholesale rebuilt in July 2026 (SDK v2 migration); another such shift is plausible before we ship.
- **`McpAgent` deprecation cuts both ways.** The exact primitive matching "stateful MCP server per DO" is frozen. New code should compose `createMcpHandler` + plain `Agent` DOs — fine, but it means the "15-line stateful MCP server" demos in older blog posts are no longer the recommended pattern, and features like pushed elicitation/sampling/roots and standalone resumable streams currently exist **only on the legacy lane**. If we need server-pushed requests to MCP clients (e.g. worker asks the external agent a question mid-turn), the stateless path uses MRTR elicitation instead — verify client support (Claude Code/ChatGPT elicitation/MRTR support is UNVERIFIED).
- **RPC transport has no auth** — fine inside one account, but cross-account worker-to-worker delegation must go over HTTP+OAuth.
- **Repo is closed to external PRs** and moves fast; we inherit their release cadence. Pin versions and track the MCP SDK v2 migration guide.
- **CPU limit per turn:** 30 s CPU per request (wall-clock unlimited) — long coding-agent turns must live in Sandbox containers + Workflows/fibers, not in the DO request handler. This reinforces the planned architecture but makes the DO a coordinator, not an executor.
- **Vendor maturity claims** ("thousands of production agents", "tens of millions of instances") are UNVERIFIED marketing.

## Open questions

1. Does `createMcpHandler`'s keepalive behavior fully match `McpAgent`'s documented edge-watchdog hardening (25 s comment frames, `Last-Event-ID` replay) for long tool calls? (Docs detail this on the legacy path; stateless path exposes `keepAliveMs`/`maxSubscriptions` but no `EventStore` replay discussion.)
2. Which external MCP clients we care about (Claude Code, Codex, ChatGPT, Devin) support DCR vs. CIMD vs. requiring pre-registered clients today, and do any require a consent UI we must host? Their current MCP OAuth client capabilities are UNVERIFIED here.
3. Do those clients support MCP elicitation (form/URL modes, MRTR on the stateless path)? If not, "worker asks external agent a question" needs a different channel (tools + polling).
4. Is there a client-credentials / M2M grant path in workers-oauth-provider for fully headless agents, or must we use pre-registered clients + token exchange (`allowTokenExchangeGrant`)? README documents neither a client-credentials grant nor rules it out — UNVERIFIED.
5. Fibers vs. Cloudflare Workflows for turn execution: fibers give SQLite-checkpointed restart semantics inside the DO; Workflows give multi-step retries and human-in-the-loop. Which owns a "turn" when the actual work runs in a Sandbox container for minutes-to-hours? (Likely: workflow/fiber starts container job, DO hibernates, webhook/poll wakes it — the pattern Cloudflare itself recommends.)
6. KV eventual consistency for OAuth grants/tokens: any risk window where a revoked grant still validates at another edge PoP? (Storage is KV with TTLs; revocation semantics under concurrent edge traffic are UNVERIFIED.)
7. Cost model at our scale: DO SQLite storage (1 GB/agent max) × many resident workers + KV OAuth records + Sandbox container hours — needs a pricing pass against the DO/sandbox research docs.
8. Migration risk: if we build on `createMcpHandler` now, does the MCP SDK v2 stateless model (no protocol sessions) constrain future features we want (e.g. long-lived client sessions seeing live worker progress over a standalone GET stream)?

## Sources

- https://developers.cloudflare.com/agents/ — Agents platform overview; four-part composition (channels, harness, SDK runtime, tools). Updated 2026-06-24.
- https://github.com/cloudflare/agents — Agents SDK repo README: features, packages (`agents`, `@cloudflare/think`, `@cloudflare/shell`, etc.), 30+ examples, no external PRs. ~5.4k stars, pushed 2026-08-11.
- https://blog.cloudflare.com/project-think/ — Project Think announcement: fibers, sub-agents/Facets, Session API, execution ladder, `Think` base class. Published 2026-04-15, modified 2026-07-15; labeled preview/experimental.
- https://developers.cloudflare.com/agents/api-reference/store-and-sync-state/ — Agent state APIs: `setState`, `onStateChanged`, `validateStateChange`, `this.sql`, state-vs-SQL guidance.
- https://developers.cloudflare.com/agents/api-reference/schedule-tasks/ — Scheduling: delayed/Date/cron/interval modes, idempotency, `keepAlive`, limits (2 MB payloads, tens of thousands of tasks).
- https://developers.cloudflare.com/agents/api-reference/websockets/ — WebSocket lifecycle hooks, hibernation semantics, connection state, broadcast, `shouldSendProtocolMessages`.
- https://developers.cloudflare.com/agents/model-context-protocol/apis/agent-api/ — `McpAgent` API (deprecated/feature-frozen): stateful DO MCP servers, `serve()`, OAuth `props`, elicitation, transport watchdog hardening, `DurableObjectEventStore`. Updated 2026-07-27.
- https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/ — `createMcpHandler`/`createLegacyMcpHandler` reference: stateless MCP SDK v2 path, options, Origin/Host validation, MRTR elicitation, migration notes. Updated 2026-07-28.
- https://developers.cloudflare.com/agents/model-context-protocol/apis/client-api/ — MCP client: `addMcpServer` (HTTP/SSE/RPC), stable IDs, OAuth client with default DCR, SSRF guards, persistence across hibernation, elicitation handlers. Updated 2026-07-27.
- https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/ — Transport comparison (Streamable HTTP vs RPC vs SSE), RPC transport between agents and McpAgent, routing patterns. Updated 2026-07-27.
- https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/ — MCP OAuth guidance: four provider integration patterns, token flow diagrams, per-tool permission patterns. Updated 2026-07-27.
- https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/ — Build-a-remote-MCP-server guide: templates, MCP inspector, `mcp-remote` bridge for Claude Desktop, GitHub OAuth walkthrough. Updated 2026-07-27.
- https://github.com/cloudflare/workers-oauth-provider — OAuth 2.1 provider library README: DCR (RFC 7591), CIMD, PKCE, RFC 8414/9728/8707/9207, KV storage, token rotation, gaps (CIMD `none`-only auth, no op-level scopes). ~1.9k stars; v0.4.0.
- https://www.npmjs.com/package/@cloudflare/workers-oauth-provider — npm metadata: v0.4.0 published ~2026-06, 51 versions.
- https://registry.npmjs.org/agents — npm metadata: `agents` latest 0.20.1 published 2026-07-28.
- https://developers.cloudflare.com/agents/platform/limits/ — Agents-specific limits: tens of millions concurrent agents, 1 GB state/agent, 30 s CPU per request.
- https://developers.cloudflare.com/changelog/product/durable-objects/ — DO changelog incl. SQLite migrations syntax and Free-plan availability (2025-04-07).
- https://blog.cloudflare.com/managed-oauth-for-access/ — Managed OAuth for Access (2026-04-14); alternative for internal/SSO-gated MCP servers (context only).
