# Prior Art: E2E Testing & Observability for MCP-Fronted, Sandbox-Executing Agent Systems

Researched 2026-08-11. All sources fetched live today unless noted; dated claims cite the source's own timestamp where available.

## TL;DR

- **MCP e2e testing has real, current tooling.** The official `@modelcontextprotocol/conformance` CLI (npm `latest` 0.1.16 / `alpha` 0.2.0-alpha.11, published today) drives both client and server conformance against dated spec revisions, with baseline/expected-failure YAML files for known gaps. Cloudflare's own `cloudflare/agents` repo wires this exact runner against its `McpAgent`/`MCPClientManager` classes inside `wrangler dev`/workerd — this is the closest thing to a ready-made pattern for our MCP front door.
- **The OAuth leg is the single strongest reusable asset found.** `cloudflare/workers-oauth-provider`'s `conformance/` directory (npm `latest` 0.10.3, published 2026-08-10) is a full black-box OAuth 2.1 + PKCE + DCR test suite, built on Cloudflare's official `createTestHarness()` Wrangler API, that runs a real Worker in workerd with synthetic auto-consent — no browser, no real IdP. This is directly reusable/adaptable for our `@cloudflare/workers-oauth-provider`-based MCP front door.
- **A deterministic fake-brain precedent exists and is a close match**: `paultyng/testagent` (Go, MIT, active 2026-07-28) is a drop-in deterministic fake of the `claude`/`codex` CLIs — same argv, same `--print --output-format stream-json` frames, same hook JSON payloads, zero model/network/tokens. It explicitly does **not** fake an MCP server (it's an MCP *client* fake), so it covers the "Sandbox runs Claude Code headless" leg but not the MCP front door leg.
- **Cloudflare's own DO/Workflows precedent is thin but instructive.** `cloudflare/claude-managed-agents` (pushed today, 2026-08-11) — Anthropic's real "Claude Managed Agents" webhook→sandbox control-plane pattern, architecturally close to this spike — tests with in-memory KV/D1 fakes and `vi.mock()`, and ships a **manual** `VALIDATION.md` QA checklist, not an automated e2e suite. That absence is itself evidence for why the founder wants M0 built first.
- **Official DO hibernation/eviction test helpers now exist**: `evictDurableObject` / `evictAllDurableObjects` from `cloudflare:test` (`@cloudflare/vitest-pool-workers` ≥0.16.20, changelog 2026-06-25) — a first-party, in-process way to simulate the exact "worker DO gets evicted, then wakes" scenario without process kills.
- **OTel GenAI conventions are still Development, not Stable**, as of mid-2026; the whole `gen_ai.*`/MCP semconv tree moved to a dedicated, unversioned repo on 2026-06-12. Claude Code's OTel traces are explicitly **Beta**, gated behind two separate env vars, and do **not** propagate to Bash-tool subprocesses/MCP servers — a concrete gotcha for anyone assuming full automatic instrumentation inside a Sandbox container.

## Status/maturity summary (with dates)

| Component | Maturity | Date evidence |
|---|---|---|
| `@modelcontextprotocol/inspector` CLI mode | Stable, actively developed, v2 architecture (separate `cli`/`web`/`tui` clients) | README fetched 2026-08-11, `--cli` documented feature |
| `@modelcontextprotocol/conformance` | Public, 97 GitHub stars, pushed 2026-08-10; npm stable 0.1.16, alpha 0.2.0-alpha.11 | GitHub API + npm registry, 2026-08-11 |
| `@modelcontextprotocol/sdk` (legacy monolith) | Still published, 1.30.0 (2026-07-27) | npm registry |
| `@modelcontextprotocol/server` / `@modelcontextprotocol/client` (split packages) | New, `client` at 2.0.0 | npm registry, 2026-08-11 |
| `@cloudflare/workers-oauth-provider` conformance suite | Production-grade, versioned matrix over 4 dated MCP auth revisions incl. `2026-07-28` | repo README fetched 2026-08-11; package 0.10.3 published 2026-08-10 |
| `paultyng/testagent` | Small (6 stars), young, actively maintained | pushed 2026-07-22, created earlier 2026 |
| `dwmkerr/mock-llm` | Small (13 stars), active | created 2025-10-03, pushed 2026-07-28 |
| `evictDurableObject`/`evictAllDurableObjects` | Official, recent | Cloudflare changelog 2026-06-25, `@cloudflare/vitest-pool-workers` ≥0.16.20 |
| Cloudflare Workers automatic tracing (OTLP) | Open beta | blog.cloudflare.com published 2025-10-28; still "beta" per 2026-08-04 changelog entry about Agents SDK traces |
| `createTestHarness()` (Wrangler multi-worker test API) | Documented, current | Cloudflare docs page, "last updated July 27, 2026" |
| OTel GenAI semantic conventions | **Development, not Stable**; moved to standalone unreleased repo | opentelemetry.io blog + community posts dated through 2026-07-17 |
| Claude Code OTel traces | **Beta** (metrics/logs are stable) | code.claude.com/docs/en/monitoring-usage, fetched 2026-08-11 |

---

## 1. MCP server e2e testing

### 1.1 Official MCP Inspector, CLI mode

The Inspector shipped a v2 rewrite with three separate clients sharing a `core/`: **web**, **cli**, **tui**, dispatched by a shared `launcher` binary (`mcp-inspector`). The **CLI** client is explicitly billed as "a scriptable command-line client for automation, CI, and fast agent feedback loops" (source: `modelcontextprotocol/inspector` root README, fetched 2026-08-11).

Invocation: `npx @modelcontextprotocol/inspector --cli <target> --method <mcp-method> [flags]`. Verified from `clients/cli/README.md`:

- Supports `tools/list`, `tools/call`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, `prompts/get`, `logging/setLevel`, plus catalog-only `servers/list`/`servers/show`.
- Remote servers: `--transport http` connects Streamable HTTP; default (no flag) is SSE; `--header "X-API-Key: ..."` sets custom headers.
- **Assertions for CI**: `--format json` emits a single-line JSON envelope (`{"result": …}`) with no banners — pipes into `jq`. Exit codes are meaningful and distinct: a `tools/call` returning `isError:true` exits `5` (`tool_is_error`); `--app-info` on a missing tool exits `5` (`tool_not_found`); a tool with no MCP App UI exits `2` (`no_app`). This lets a CI script assert pass/fail via `$?` without parsing stdout, or via `jq` on `--format json` output.
- **Non-interactive OAuth**: `--stored-auth-only` is documented as "CI / non-interactive safe" — it never starts interactive login or opens a browser; it uses tokens already in the shared store or fails immediately with `auth_required`. This is the CI-safe alternative to the default interactive-login-on-401 behavior.
- Proxy support via `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` (routed through `undici`'s `EnvHttpProxyAgent`).

This is real, current tooling suitable for scripted CI smoke ("call tool X, assert exit code / JSON shape"), but it is a **single-call-per-invocation** tool — each `--cli` run does one connect→method→disconnect cycle. It is not a multi-step scenario runner; that role is better filled by the SDK client directly (below) or the conformance CLI (1.3).

Source: `modelcontextprotocol/inspector` GitHub repo README.md and `clients/cli/README.md`, fetched 2026-08-11.

### 1.2 TypeScript MCP SDK client as a test harness

As of 2026-08-11 the SDK monorepo (`modelcontextprotocol/typescript-sdk`) has split into `@modelcontextprotocol/server` (build servers) and `@modelcontextprotocol/client` (build clients) — npm shows `@modelcontextprotocol/client@2.0.0` alongside the still-published legacy monolith `@modelcontextprotocol/sdk@1.30.0`. **UNVERIFIED**: I did not confirm the exact class names / import paths for `StreamableHTTPClientTransport` under the new split packages (a code-search for the string inside the repo returned no results, likely a search-indexing gap rather than absence — the README's "Getting Started" section for the client package was not reached before time budget). What *is* confirmed from the repo's `examples/` directory listing: dedicated `oauth/`, `oauth-client-credentials/`, `bearer-auth/`, `bearer-auth-web/`, `client-quickstart/`, and `cli-client/` example projects exist, and the top-level package list explicitly separates server vs. client libraries and "auth helpers" for both. `examples/oauth/` contains `client.ts`, `simpleOAuthClient.ts`, `simpleOAuthClientProvider.ts`, `simpleTokenProvider.ts`, and `dualModeAuth.ts` — i.e. runnable reference code for building an MCP client that carries OAuth tokens, which is the shape a test harness would reuse to script DCR + PKCE + token exchange, then call tools.

**Pattern validated in the wild**: `cloudflare/agents`' own conformance suite (1.4 below) proves the pattern of "spin up the real server inside workerd via `wrangler dev`, then drive it with the official SDK client (`MCPClientManager`) as the test harness" — this is effectively "TS SDK client as test harness," just wrapped by the official conformance CLI instead of hand-rolled assertions.

Source: `modelcontextprotocol/typescript-sdk` GitHub repo (contents listing + README grep), npm registry, fetched 2026-08-11.

### 1.3 Official MCP conformance framework — `@modelcontextprotocol/conformance`

This is the most load-bearing find for section 1. Repo: `modelcontextprotocol/conformance`, 97 stars, last pushed **2026-08-10** (yesterday relative to this research). Published on npm as `latest` 0.1.16 and `alpha` 0.2.0-alpha.11.

What it does (from the repo README, fetched 2026-08-11):

- **Client testing**: `npx @modelcontextprotocol/conformance client --command "<client-cmd>" --scenario <name>` (or `--suite all|core|extensions|backcompat|auth|metadata|draft|sep-835`). The framework starts a scenario-specific test server, runs the client command against it (appending `<server-url>` and setting `MCP_CONFORMANCE_SCENARIO`/`MCP_CONFORMANCE_CONTEXT` env vars), captures the protocol interactions, and checks them against the spec.
- **Server testing**: `npx @modelcontextprotocol/conformance server --url <url> [--scenario ...] [--suite active|all|draft|pending]` — connects to a running server as a client and checks its responses.
- **Results**: `results/<scenario>-<timestamp>/checks.json` (array of pass/fail with details), plus stdout/stderr capture.
- **Wire-schema validation** is automatic: every JSON-RPC message on the wire is validated against the spec's JSON Schema for the negotiated version, emitting synthetic `wire-schema-valid` / `wire-schema-harness-error` checks alongside the scenario's own checks.
- **Baseline/expected-failure mechanism**: `--expected-failures <path>` takes a YAML file of known failures so CI can go green on documented gaps while still failing on *new* regressions.
- **`--requirements <revision>`**: answers "what does conforming to spec revision X actually require" as a frozen, versioned scenario list (`requirements/<revision>.yaml`) — decoupled from the ever-growing `--suite`/`--spec-version` filters, specifically because a scenario merged after a revision shipped still carries that revision's applicability tag.
- Spec revisions covered as of today: `2025-03-26`, `2025-06-18`, `2025-11-25`, `2026-07-28` (the last is the current `latest` per the spec site, and uses a **stateless** lifecycle with per-request `_meta` instead of the older stateful initialize-handshake lifecycle).

**This is reusable, not just descriptive.** `cloudflare/agents` (packages/agents/conformance/) shows exactly how: it pins `@modelcontextprotocol/conformance@0.2.0-alpha.10`, wraps the CLI in its own `run-suite.mjs`/`run.sh` for process-group cleanup and stricter pass/fail semantics ("non-zero client exits count as failures even when wire assertions pass"), runs it against `wrangler dev` (real workerd), and maintains per-lane baseline YAMLs (`baseline-client-2025-11-25.yml`, `baseline-server-mcp-agent.yml`, etc.) with inline comments explaining *why* each baselined failure is acceptable. Current pass rates documented in that repo's own conformance README (fetched 2026-08-11): e.g. client-stateless lane 28/32 clean + 4 expected failures; server-handler lane 40/40 clean with zero expected failures.

Sources: `modelcontextprotocol/conformance` README (raw, fetched 2026-08-11), npm registry, `cloudflare/agents` `packages/agents/conformance/README.md` (raw, fetched 2026-08-11).

### 1.4 `cloudflare/agents` — the closest working precedent for "MCP round-trip under workerd"

`cloudflare/agents` (the Agents SDK repo, `Build and deploy AI Agents on Cloudflare`) ships, inside `packages/agents/`:

- `conformance/` — the wiring described above, including a **vendored, workerd-adapted copy** of the upstream SDK's own conformance server fixture (documented in `conformance/vendor/README.md`, not fetched in full but referenced) because "the SDK does not publish the fixture as an importable module, and its upstream entrypoint depends on Node and Express" — a concrete note that upstream fixtures assume Node and need adaptation for workerd.
- `evals/` — a *separate* concern from conformance: `evalite`-based evals (see section 2/3) for LLM-driven behavior like scheduling-prompt parsing, run with real provider keys (`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GOOGLE_GENERATIVE_AI_API_KEY`), explicitly opt-in and not part of the deterministic CI gate.
- `src/e2e-tests/` — real end-to-end tests that spawn `wrangler dev`, **SIGKILL the process to simulate real DO eviction**, restart it, and assert that in-flight "fibers" (their checkpointed async task primitive) resume from their last checkpoint via workerd's alarm persistence (`fiber-eviction.test.ts`; cites `cloudflare/workerd#6104` for alarm persistence across restarts). This is a directly transferable pattern for a "hibernation-wake" / "restore-after-sleep" e2e test on our resident-worker Durable Objects.
- `AGENTS.md` at repo root (not read in depth; noted as present).

Package scripts (`packages/agents/package.json`, fetched 2026-08-11) confirm distinct npm scripts per concern: `test`, `test:workers` (`vitest --project workers`), `test:e2e` (`vitest --run -c src/e2e-tests/vitest.config.ts`), `test:conformance` (+ per-lane variants). This four-way split (unit/workers-runtime/e2e/conformance) is itself a useful organizing pattern to copy.

Sources: `cloudflare/agents` GitHub repo, `packages/agents/package.json`, `packages/agents/src/e2e-tests/fiber-eviction.test.ts`, `packages/agents/conformance/README.md`, `packages/agents/evals/README.md` — all raw-fetched 2026-08-11.

### 1.5 Dedicated MCP testing frameworks/utilities on npm (beyond the official conformance runner)

Searched npm registry directly (not just web search) on 2026-08-11 for `mcp-test`, `mcp-testing`, and broader "model context protocol testing" terms. Real, code-backed results:

| Package | What it is | Signal of realness |
|---|---|---|
| `@modelcontextprotocol/conformance` | Official (see 1.3) | 97 GitHub stars, official org |
| `@dotsetlabs/bellwether` (2.1.3) | "Structural drift detection and behavioral documentation for MCP servers" | Published npm package with own GitHub repo (`dotsetlabs/bellwether`), described as "the open-source MCP testing tool" |
| `mcp-testing-kit` (0.2.0) | "The testing library you need to test your MCP servers" | Repo is `thoughtspot/mcp-therapy` — package name doesn't match repo name, worth treating with caution before adopting |
| `@msfeldstein/mcp-test-servers` (1.1.72, published 2026-02-22) | Collection of MCP test **fixture servers**: working (ping, resource, combined, env-echo) and deliberate failure cases (broken-tool, crash-on-startup) | Actively republished (version number and date suggest frequent iteration); useful as ready-made negative-test fixtures |
| `mcp-test-client` / `@mseep/mcp-test-client` | "A testing utility for Model Context Protocol (MCP) servers" | Smaller/older (2025), unverified maintenance |
| `@youzi9601/mcp-testkit-http` (0.1.7, published 2026-08-10) | "HTTP transport for MCP test servers" | Published yesterday; scope unclear beyond description — **UNVERIFIED** depth |

None of these has the combination of official backing + spec-revision coverage + baseline mechanism that `@modelcontextprotocol/conformance` has. Recommendation for the coordinator: treat the official conformance CLI as primary, and `@msfeldstein/mcp-test-servers`-style fixture servers as a source of negative-test scenarios (crash-on-startup, broken-tool) worth mirroring for our own "fake brain" MCP-adjacent failure injection.

Source: npm registry search API, fetched 2026-08-11.

### 1.6 Automating the OAuth leg — `@cloudflare/workers-oauth-provider`'s `conformance/` directory

This directly answers the coordinator's specific question and is the single strongest piece of directly-reusable prior art found in this research. Repo: `cloudflare/workers-oauth-provider`. Package `@cloudflare/workers-oauth-provider` on npm: `latest` 0.10.3, published **2026-08-10** (yesterday).

**What it tests** (from `conformance/README.md`, fetched 2026-08-11 in full — this is a long, detailed document, quoted/paraphrased faithfully):

- Scope is explicitly narrow and stated up front: *"The suite intentionally tests only MCP authorization. It does not test MCP JSON-RPC methods, lifecycle, tools, prompts, resources, or HTTP transport framing."* The protected `/mcp` route in the test fixture is a minimal authenticated endpoint that just proves a bearer token reaches the app handler.
- Coverage matrix spans **4 dated MCP authorization revisions**: `2025-03-26`, `2025-06-18`, `2025-11-25`, `2026-07-28` — with per-revision applicability (e.g. RFC 8707 `resource` parameter only from `2025-06-18` on; RFC 9207 issuer advertisement only from `2026-07-28`).
- Concretely tests: authorization-server metadata (RFC 8414); authorization-code + S256 PKCE flow for public and confidential clients; PKCE enforcement (missing/plain/unsupported-method/wrong-verifier all rejected); redirect URI / client validation; `client_secret_basic`/`client_secret_post`/public-client token-endpoint auth; **Dynamic Client Registration** (RFC 7591) for public and confidential clients, including rejection of unsupported client metadata (`invalid_client_metadata`, `Cache-Control: no-store`); **pre-registered clients when DCR is disabled**, and Client ID Metadata Documents (CIMD) as of `2025-11-25`+; refresh-token rotation, downscoping, and revocation (RFC 7009); RFC 9728 Protected Resource Metadata + `resource_metadata` links in `WWW-Authenticate`; RFC 8707 Resource Indicators / audience validation; `insufficient_scope` step-up challenges (`2025-11-25`+); RFC 9207 issuer advertisement (`2026-07-28`).
- **Relationship to the upstream official conformance runner is explicitly documented**: *"The upstream `@modelcontextprotocol/conformance` authorization-server mode currently exposes two scenarios — metadata and authorization code grant — and applies both to all four dates. The real Worker fixture passed both upstream scenarios for every date using upstream `0.2.0-alpha.10`."* i.e. this repo **already validated interop with the official conformance CLI** and then wrote a much deeper, hand-authored suite on top because the upstream OAuth coverage is currently thin.

**Test architecture (directly answers "pre-registered client credentials vs. scripted DCR" and "automating consent headlessly")**:

- `conformance/worker/` is a **real deployable Worker fixture** (`index.ts` + `wrangler.jsonc`) hosting the actual `OAuthProvider`, started via Cloudflare's official **`createTestHarness()`** Wrangler API (`developers.cloudflare.com/workers/testing/test-harness/`, "last updated July 27, 2026" per the docs page). `createTestHarness()` runs Wrangler's production build inside real workerd, dispatches requests to one or more Workers, and exposes bindings/local storage to the test — this is a genuine multi-worker integration-test API, not a mock.
- The fixture's authorization handler **grants synthetic consent automatically** — this is the "test-only consent auto-approve mode" the coordinator asked about, found as a real, working example: *"an application-owned authorization handler that grants synthetic consent."*
- `support/oauth-client.ts` is a hand-rolled OAuth HTTP client (not the MCP SDK's OAuth client) that: pre-registers clients through `OAuthHelpers` via a typed Worker RPC call (bypassing HTTP DCR when the test wants a pre-registered client), *or* drives real DCR + full authorization-code/PKCE/token exchange over HTTP when the test wants that leg exercised. Both patterns — pre-registered-via-RPC and scripted-DCR-via-HTTP — coexist in the same suite, selected per test.
- `support/harness.ts` (read in full): a ~20-line Vitest wrapper — `beforeAll` calls `harness.listen()`; `afterEach` calls `harness.debug()` on failure then `harness.reset()` (local storage recreated after every test); `afterAll` calls `harness.close()`. This is a clean, copyable pattern for any OAuth-fronted Worker test suite.
- Assertion discipline is stated explicitly: *"Tests assert only observable HTTP responses, redirects, metadata, challenges, and token behavior. They do not access provider internals or stored records."* — i.e. genuinely black-box/e2e, not white-box.

**Direct reuse assessment for this product**: since the target architecture explicitly uses `@cloudflare/workers-oauth-provider` for its MCP front door, this conformance suite's `worker/`, `support/harness.ts`, and `support/oauth-client.ts` are very likely adaptable near-verbatim (same library, same `createTestHarness()` API, same synthetic-consent pattern) rather than needing to be built from scratch. The main adaptation work would be pointing the fixture at the product's actual MCP route instead of the minimal stub `/mcp` handler.

Sources: `cloudflare/workers-oauth-provider` `conformance/README.md`, `conformance/client-registration.test.ts`, `conformance/support/harness.ts` (all raw-fetched in full or substantial part, 2026-08-11); npm registry; Cloudflare docs `workers/testing/test-harness/` (WebFetch, fetched 2026-08-11).

---

## 2. Deterministic agent e2e — the fake/recorded brain

### 2a. Scripted/fake agent CLIs as test stand-ins

**`paultyng/testagent`** (Go, MIT license, GitHub `paultyng/testagent`, 6 stars, last pushed 2026-07-22) is a direct, real precedent for "does any project ship a deterministic mock coding-agent CLI?" — yes.

From its README (fetched in full, 2026-08-11):

- *"A fake `claude` / `codex` CLI. Deterministic output. No model, no network, no tokens. Iterate locally; run in CI without an API key."*
- **Argv-compatible**: drop it in wherever a pipeline shells out to `claude` or `codex`; `--print --output-format stream-json` emits "the same frame shapes a real run would."
- **Hooks fire the same JSON payload real Claude Code fires.** Example shown: a `Type="command"` `PostToolUse` hook piped to `jq . > tool-use.json` captures a payload with `hook_event_name`, `session_id`, `tool_name`, `tool_input`, `tool_response` — same shape as real Claude Code.
- **Scripted interaction via stdin**: a heredoc of `/fake-tool <name> <json-args>`, `/fake-tool-result <json>`, `/exit` lines drives a deterministic tool-use cycle.
- Explicit **scope boundaries** (documented, not inferred): fires `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `PreCompact`, `PostCompact` hooks — **not** `Notification` or `SubagentStop`. Supports `Type="http"` and `Type="command"` hook handlers — **not** `Type="agent"` (which needs a real model). Critically: *"No MCP server fake. testagent is an MCP client — it connects to a real server and dispatches `tools/call`. It doesn't fake the server side."*

**Implication for this product**: testagent (or a same-shaped in-house fork) covers the "Sandbox container runs Claude Code headless" leg of the fake-brain problem — it can stand in for the actual `claude` binary the Sandbox invokes, deterministically producing hook payloads and stream-json frames the resident-worker Durable Object's turn logic can react to. It does **not** cover the MCP front door leg (section 1) — that needs the conformance/OAuth tooling instead. The two are complementary, not overlapping.

A second, adjacent tool: **`dwmkerr/mock-llm`** (13 stars, created 2025-10-03, pushed 2026-07-28) is a configurable OpenAI-compatible mock server ("echo" server driven by a YAML rules file matched via JMESPath) that also has dedicated **MCP mocking** (`docs/mcp.md`) and **MCP OAuth emulation** (`docs/mcp-oauth.md`) modes — the README states it *"can emulate an OAuth 2.1 authorization server in front of its MCP endpoint... It serves RFC 8414 / RFC 9728 discovery, RFC 7591 Dynamic Client Registration, Authorization Code + PKCE, and refresh-token flows, plus a small set of control endpoints for test orchestration."* I did not fetch `docs/mcp.md`/`docs/mcp-oauth.md` in full (time budget) — **UNVERIFIED** in depth beyond the README's own claim, but the top-level README claim is itself a specific, checkable assertion from a maintained repo, not a marketing blurb. Note this tool overlaps with `@cloudflare/workers-oauth-provider`'s conformance suite in *purpose* (fake OAuth+MCP for tests) but is generic/vendor-neutral rather than Cloudflare-Workers-native.

### 2b. LLM record/replay for tests

Confirmed via web search (not deeply verified with direct repo inspection due to time budget — flagging accordingly):

- **Classic VCR/cassette pattern is alive for LLMs in 2026**: community write-ups describe recording real HTTP LLM exchanges to cassette files on first run, replaying deterministically thereafter — same mechanism as `vcrpy` (Python) / `nock` / `polly.js` (Node), just pointed at LLM provider endpoints instead of generic HTTP. **UNVERIFIED** which specific maintained npm package is the current standard for this in a TypeScript/Workers context as of Aug 2026 — search results surfaced `vcr-langchain` (Python, LangChain-specific) and `langchain-replay` (records tool-call *decisions*, replays them while still executing real tool code — a "decision record/replay" variant distinct from full-HTTP-cassette replay) rather than a generic TS/Workers-native cassette library. This is a genuine gap worth flagging to the coordinator rather than guessing.
- **promptfoo** (npm `promptfoo`, latest 0.122.0, published 2026-08-04 — actively maintained) bills itself as an "LLM eval & testing toolkit." Its role is closer to prompt/output evaluation (assertions, scoring, red-teaming) than HTTP-level cassette replay; it is a real, current, widely-used tool but **UNVERIFIED** whether it has first-class record/replay-as-test-fixture support vs. eval-scoring support — did not fetch its docs in depth.
- **Braintrust** exists and is real (see section 3), but its primary role found in this research is tracing/eval, not cassette-style replay; **UNVERIFIED** whether it ships a dedicated fixture/replay feature distinct from its eval framework.
- No dedicated, Workers/edge-native LLM-cassette library was found and confirmed with the same rigor as the MCP/OAuth conformance tooling in section 1. Recommendation: for M0, the fake-brain approach (2a) is better-evidenced and more directly applicable than HTTP-cassette replay, since the product's non-deterministic surface is Claude Code's own tool-use loop, not a raw chat-completions call the harness makes itself.

### 2c. How agent products test themselves

**OpenHands Agent SDK** (arXiv paper `2511.03690`, "The OpenHands Software Agent SDK," fetched 2026-08-11 via arxiv.org/html mirror) documents an explicit **three-tier testing strategy** (its own Section 5.1):

1. **Programmatic tests** — run on every commit, "mock llm calls and verify core logic, data flow, and API contracts within seconds." Zero API cost.
2. **LLM-based (integration) tests** — "both integration and example tests," run daily and on-demand for PRs, using real models to validate "reasoning, tool invocation, and environment stability." Cost: **$0.5–$3 per full run**, **<5 minutes**, per the paper.
3. **Benchmark evaluation** — high-cost ($100–1000, hours per run) runs against academic datasets for quantitative tracking across releases.

The paper's Section 5.1 shows a `BaseIntegrationTest` base class pattern: subclasses define `setup()`, `tools()`, and `verify_result()`, giving deterministic pass/fail even though the middle tier uses a real LLM — i.e. the LLM's *reasoning* is nondeterministic but the *verification* (did the file get created, did the command run, is git state correct) is deterministic. This is a direct precedent for "tests-as-oracle" applied to agent *behavior* tests, not just SWE-bench-style benchmark tasks.

**SWE-bench / SWE-bench Verified** (WebSearch results on tests-as-oracle harness design, 2026-08-11): SWE-bench Verified pairs 500 human-validated GitHub issues with a **hidden test suite** as a deterministic pass/fail oracle — `fail_to_pass` tests (were failing, must now pass) and `pass_to_pass` tests (were passing, must stay passing). Documented **gotchas** relevant to us: (a) "standard harnesses can substantially overstate model performance, either due to inadequate tests or solution leakage," (b) "some tests pass or fail non-deterministically due to timing, resource availability, or randomness, and flaky tests inflate or deflate scores depending on the run." Both are direct warnings for any M0 design that runs "the fixture repo's own test suite" as an oracle: the fixture repo's test suite itself must be vetted for flakiness and for not accidentally containing the solution.

**cloudflare/agents' own `evals/`** (packages/agents/evals/, fetched 2026-08-11): uses **`evalite`** (npm package, real, invoked via `npx evalite`) with `createScorer`/`evalite` from that package, scoring structured-output correctness (e.g. does a scheduling prompt produce the right `Schedule` type/detail) against multiple providers configured via env vars (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, or Cloudflare Workers AI via `workers-ai-provider`). This is a real, current, small-footprint eval harness — worth considering for any "does the resident worker's turn-planning prompt still produce a valid task-graph mutation" evals, as distinct from the deterministic e2e suite.

**Anthropic's own testing guidance for Claude Code**: not separately found as a document beyond the OTel/monitoring docs covered in section 3; **UNVERIFIED** whether Anthropic publishes dedicated "how to test agents built on Claude Code" guidance — did not find one in this pass.

### 2d. "Tests-as-oracle" pattern — who does it, gotchas

Confirmed pattern (from SWE-bench evidence above, and OpenHands' `verify_result()` pattern): verifying agent work by running the target repo's own test suite (or a hidden held-out suite) rather than inspecting the agent's self-report. Gotchas found, with sourcing:

- **Solution leakage / inadequate tests** overstate success (SWE-bench literature, WebSearch 2026-08-11 — **secondary source**, i.e. summarized from search snippets of academic papers, not the primary papers themselves; treat as directionally correct but re-verify against the primary papers if this becomes load-bearing).
- **Flaky tests in the fixture repo** invalidate the oracle regardless of agent correctness — same source.
- **The oracle itself needs its own regression protection**: neither OpenHands' paper excerpt nor the SWE-bench summaries describe how they guard the oracle suite from drifting/breaking independent of agent changes — this is an **open question** (see below), not something this research confirmed prior art for.

---

## 3. Agent observability conventions

### 3.1 OpenTelemetry GenAI semantic conventions — current status

As of **2026-07-17** (per a community status write-up cited by WebSearch, itself referencing the spec repo state), **no GenAI-specific span, event, metric, or attribute is marked Stable** — the conventions remain in **Development**. On **2026-06-12**, all GenAI conventions (`model/gen-ai/`, OpenAI-specific under `model/openai/`, and MCP conventions under `model/mcp/`) were **moved out of the main `opentelemetry-semantic-conventions` repo into a new dedicated repo, `open-telemetry/semantic-conventions-genai`**, released alongside main-repo `v1.42.0`. As of **2026-07-16**, that dedicated repo **has no tagged release** — i.e. there is no versioned GenAI-conventions schema URL to pin against yet. **This is a genuine, current expectation gap**: an agent likely assumes "OTel GenAI semconv" is a stable, versioned target; as of this research it is an actively-moving, unreleased target. Treat any `gen_ai.*` attribute names used in this spike as provisional and expect churn.

Source: WebSearch synthesis of `opentelemetry.io/blog/2026/genai-observability/` and community posts (john-hodge.com, dev.to) dated through 2026-07-17 — **secondary/aggregated**, not independently confirmed by directly reading the OTel repo's own changelog in this pass. Flagging accordingly; recommend a direct read of `open-telemetry/semantic-conventions-genai` before committing attribute names in implementation.

### 3.2 How agent frameworks emit traces

- **Claude Code** (`code.claude.com/docs/en/monitoring-usage`, fetched in full 2026-08-11 — **official, primary source**): Metrics and Logs/Events are **Stable**; **Traces (spans) are Beta**, requiring *both* `CLAUDE_CODE_ENABLE_TELEMETRY=1` *and* `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` (detailed hook spans need a *third* pair: `ENABLE_BETA_TRACING_DETAILED=1` + `BETA_TRACING_ENDPOINT`). Exporters are selected per-signal via `OTEL_METRICS_EXPORTER`/`OTEL_LOGS_EXPORTER`/`OTEL_TRACES_EXPORTER` (`otlp`/`console`/`none`, plus `prometheus` for metrics). Standard `OTEL_EXPORTER_OTLP_*` (endpoint/protocol/headers, or per-signal overrides) apply. Content gating is separate and off by default: `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT`, `OTEL_LOG_RAW_API_BODIES` (the last can dump full Anthropic API request/response JSON, inline or `file:<dir>`).
  - **Mode support, per the docs**: Interactive CLI has full support for all telemetry types; **"Agent SDK & Non-Interactive (`-p`) Sessions: Full support including trace context propagation"** — this is the mode our product's headless-in-a-Sandbox-container usage matches, and it is explicitly documented as fully supported, not degraded.
  - **Concrete gotcha, stated explicitly in the docs**: *"Claude Code does NOT pass `OTEL_*` environment variables to subprocesses (Bash tool, hooks, MCP servers, language servers)."* If our own instrumented tooling runs via Claude Code's Bash tool inside the sandbox, it will not automatically inherit the parent's OTel config — must be set explicitly in the invoked command.
  - **W3C trace-context propagation**: automatic to Bash/PowerShell subprocesses via `TRACEPARENT`; sent as an API/MCP-request header only when `ANTHROPIC_BASE_URL` is unset or points at the real Anthropic API (override for custom proxies via `CLAUDE_CODE_PROPAGATE_TRACEPARENT=1`).
  - **Expectation gap confirmed by a live, open GitHub issue**: `anthropics/claude-code#32364` ("Support OpenTelemetry (OTel) configuration in Claude Code on the Web"), opened **2026-03-09**, still **open**. It documents that in the *managed, Anthropic-hosted* Claude Code on the Web sandbox, users cannot set `OTEL_*` env vars at all (no `~/.claude/settings.json` access, no shell-level env injection, network egress restricted by an allowlisting proxy). **This does not apply to our architecture** (we control the Sandbox container and its env), but it is directly relevant as an "assumption gap": an LLM reasoning from Claude Code's docs alone might not realize OTel configurability is a *self-hosted/CLI* capability, not a *managed-platform* one — worth confirming our Sandbox invocation path is the "Non-Interactive (`-p`) Sessions" mode the docs call fully supported, not something closer to the managed-web mode.
- **OpenHands**: no separate OTel-specific claim confirmed in this pass beyond its testing-tier architecture (section 2c); **UNVERIFIED** for OTel emission specifics.
- **Vercel AI SDK**: `experimental_telemetry: { isEnabled: true }` on `generateText`/`streamText` emits OTel spans following `gen_ai.*` (OTel GenAI semconv) plus AI-SDK-specific `ai.*` attributes; input/output recording is on by default (disable via `recordInputs: false`/`recordOutputs: false` for regulated data). Registration is via `@vercel/otel` or the OTel Node SDK in `instrumentation.ts`. **Documented Edge-runtime limitation**: "custom spans from Edge runtime functions are not currently supported" and `@opentelemetry/instrumentation-undici` is Node-fetch instrumentation, not Edge instrumentation — a real caveat if this spike ever runs AI SDK calls directly inside a Worker (vs. inside the Sandbox container, which is a full container/VM, not the constrained Workers-Edge-runtime — worth distinguishing these two execution contexts when applying this limitation).

Sources: `code.claude.com/docs/en/monitoring-usage` (WebFetch, full, 2026-08-11); `anthropics/claude-code` issue #32364 (GitHub API, 2026-08-11); WebSearch synthesis of SigNoz/futureagi/Vercel-ecosystem docs for AI SDK telemetry, 2026-08-11 (secondary sources for the Vercel AI SDK claims — did not independently confirm against Vercel's own docs page in this pass).

### 3.3 Native Cloudflare Workers tracing (directly relevant to this product's runtime)

Two distinct, real Cloudflare features found:

1. **Workers automatic tracing (OTLP), open beta.** Announced `blog.cloudflare.com/workers-tracing-now-in-open-beta/`, published **2025-10-28**. Automatically traces binding calls (KV, R2, **Durable Object invocations**, and more), outbound fetch calls, and handler calls (fetch/scheduled/queue). Exports via OTLP to a dashboard-configured destination (Honeycomb, Grafana, Sentry confirmed as supported destinations) with per-Worker `wrangler.jsonc`/`wrangler.toml` opt-in (`[observability.traces] enabled = true`). **Limitations as of the source date**: no custom spans/attributes yet (listed as future work); no W3C trace-context propagation across distributed services yet ("coming soon"); metrics export unavailable during beta; **pricing begins 2026-01-15** (viewing is free in beta, exporting requires Workers Paid, $0.05/million batched events beyond 10M/month). **Workflows are not explicitly mentioned as a traced primitive** in this post — flagged as an open question below.
2. **Agent traces for Think, Flue, and AI SDK, instrumented by Agents SDK.** Changelog entry `developers.cloudflare.com/changelog/post/2026-08-04-agent-tracing/`, dated **2026-08-04** (one week before this research). Captures "model calls, tool runs, approvals, token usage, and Workers runtime operations" per agent turn, for apps built with the Agents SDK (Think, Flue) and for direct AI SDK calls (v6/v7) via a `wrapAISDK(ai, { storeMessages, storeTools })` wrapper. Enabled the same way as (1): `[observability.traces] enabled = true`, then inspected via the Agents tab in the Cloudflare dashboard. **Coverage of Durable Objects/Workflows specifically is not stated in this changelog entry either** — it's framed around "agent turns," which conceptually matches this product's per-turn Workflow, but the primitive-level attribution (DO vs. Workflow vs. container) was not confirmed.

**Braintrust integration confirmed for Cloudflare Agents**: Braintrust's own blog (`braintrust.dev/blog/cloudflare-agents`, referenced via WebSearch, not independently fetched in full — **secondary confirmation**) states two integration paths: (a) route Cloudflare's own OTel spans straight to Braintrust as an OTLP destination in Workers Observability with **no SDK in the Worker**, or (b) first-class Braintrust SDK instrumentation for the Agents SDK / `@cloudflare/ai-chat` / `@cloudflare/think` / Flue, and confirmed to run *in* the Workers runtime (not just call it from outside).

### 3.4 Third-party LLM observability platforms — edge/Workers compatibility

Kept brief per the coordinator's instruction; findings from WebSearch (not independently code-verified beyond what's stated):

- **Braintrust**: JS SDK confirmed to run inside the Workers runtime itself (see 3.3); also supports OTLP-destination ingest with zero in-Worker SDK, via Cloudflare's own tracing beta. Two real, distinct integration paths.
- **Langfuse**: no Workers-specific edge SDK confirmed in this pass; standard approach for edge runtimes generally is plain-HTTP OTLP or REST ingest rather than a heavy SDK, but I did **not** find/confirm a Langfuse-specific "edge-compatible SDK" claim with a primary source — **UNVERIFIED**.
- **LangSmith**: confirmed via LangChain's own support portal (`support.langchain.com`, referenced via WebSearch) that `traceable()` works in Cloudflare Workers with an explicit `tracingEnabled: true` flag (auto-detection that works in Node apparently doesn't trigger in Workers), and that **you must manually flush all runs before the Worker's execution context ends** (a Workers-specific serverless-lifecycle caveat, analogous to needing `ctx.waitUntil()`). This is a real, Workers-specific gotcha, not generic advice.
- **Honeycomb**: not independently re-verified beyond being named as a supported OTLP destination for Cloudflare's native Workers tracing (3.3) — since Honeycomb's ingest is plain OTLP/HTTP, edge-compatibility is structurally not in question, but no Workers-specific SDK claim was checked.

### 3.5 The "evidence ledger" pattern — prior art for append-only run ledgers with provenance

No dedicated named "evidence ledger" library or framework was found as prior art (this appears to be this codebase's own vocabulary — the founder's stated discipline of "never trust an agent's self-report; assert on an evidence ledger" reads as this org's own principle, consistent with the referenced repo's existing `lessons-learned.md`/CLAUDE.md conventions rather than an external pattern). The closest structural analogs found in this research:

- **SWE-bench's `fail_to_pass`/`pass_to_pass` test lists** function as a provenance-bearing evidence structure: a fixed, versioned record of what must be true before/after, checked deterministically rather than self-reported (section 2c/2d).
- **`@modelcontextprotocol/conformance`'s `results/<scenario>-<timestamp>/checks.json`** is a structured, append-friendly evidence artifact per scenario run (array of pass/fail checks with detail), plus captured stdout/stderr — directly analogous to "run id, structured events" (section 1.3).
- **Cloudflare's own conformance baseline YAMLs** (`baseline-*.yml` in both `workers-oauth-provider` and `cloudflare/agents`) are an append-only, reviewable ledger of *known* deviations from a clean pass, with inline justification comments — a real precedent for "acceptable known gaps get a dated, reviewed entry, not a silent skip."
- No prior art was found for an actual *runtime* evidence ledger (run id / container id / exit codes as a queryable store, as opposed to a test-results artifact) that matches the product's own Durable-Object-SQLite-backed append-only event/decision ledger concept. This appears to be a design the product needs to build, not adopt.

---

## Proposed M0 e2e suite

**PROPOSED — synthesized by this research, not found as an off-the-shelf product.** Grounded in sections 1-3 above; each scenario names the concrete tooling it would reuse.

1. **Scripted-MCP-client round trip (create worker → task with fake brain → poll status → assert ledger rows + workspace diff).**
   - Tooling: MCP TypeScript SDK client (§1.2) or MCP Inspector `--cli --format json` (§1.1) as the driving client; `paultyng/testagent` (§2a) swapped in as the `claude` binary inside the Sandbox container so the "turn" produces deterministic tool-use frames and hook payloads; `createTestHarness()` (§1.6) or `wrangler dev` + real workerd (as `cloudflare/agents`' own e2e/conformance tests do, §1.4) to run the actual Worker/DO/Workflow stack, not a mock of it.
   - Asserts: MCP tool-call response shape (via Inspector `--format json` exit codes or SDK client assertions); Durable Object SQLite ledger rows (run id, event sequence, decision records) queried directly via a debug/introspection binding or RPC; workspace diff produced by the Sandbox container compared byte-for-byte against testagent's scripted `/fake-tool` outputs (fully deterministic, no LLM variance).

2. **Hibernation-wake e2e.**
   - Tooling: `evictDurableObject`/`evictAllDurableObjects` from `cloudflare:test` (`@cloudflare/vitest-pool-workers` ≥0.16.20, §3.3/changelog 2026-06-25) as the primary, fast, in-process mechanism; `cloudflare/agents`' `fiber-eviction.test.ts` pattern (real `wrangler dev` + `SIGKILL` + restart, relying on workerd's alarm persistence, §1.4) as a heavier, closer-to-production fallback for the cases eviction-helper mocking can't reach (e.g. actual process restart, not just in-memory object removal).
   - Asserts: task graph and event ledger identical before eviction and after wake (no lost decisions); any in-flight Workflow step resumes rather than restarting from scratch; wake latency captured as a ledger timestamp delta.

3. **Restore-after-sleep e2e.**
   - Tooling: same DO eviction helpers as (2), combined with Sandbox container lifecycle assertions — specifically confirming the Sandbox's own state (files, running processes) round-trips through whatever snapshot/restore mechanism the spike uses. No off-the-shelf tool found for asserting *container* filesystem state across a sleep cycle; this leg needs bespoke assertions (e.g. checksum a fixture file before sleep, assert identical checksum after restore).
   - Asserts: workspace file tree hash unchanged; task graph state unchanged; ledger contains explicit sleep/wake events with timestamps and (once available) container id.

4. **OAuth DCR handshake e2e.**
   - Tooling: `@cloudflare/workers-oauth-provider`'s own `conformance/` suite (§1.6) adapted to point at the product's real `/mcp` route instead of the stub fixture — this is close to a direct lift: `createTestHarness()` + synthetic-consent authorization handler + `support/oauth-client.ts`'s dual pre-registered-RPC/scripted-DCR-over-HTTP pattern. Layer the official `@modelcontextprotocol/conformance client --suite auth` (§1.3) on top as an independent, spec-authored check that doesn't share test-authoring bias with the hand-written suite.
   - Asserts: full DCR → PKCE authorization-code → token exchange succeeds for a fresh, unregistered scripted client; token carries correct scope/audience; a client with a stored token skips interactive consent (MCP Inspector `--stored-auth-only`, §1.1, is a good manual/CI cross-check here); malformed/replayed requests are rejected per RFC 6749/7636/7591 (the hand-written suite already encodes these negative cases — reuse rather than re-derive).

5. **(Not explicitly requested but strongly indicated by evidence) A negative/failure-injection pass.** `@msfeldstein/mcp-test-servers`' `broken-tool`/`crash-on-startup` fixtures (§1.5) and testagent's documented scope boundaries (§2a: no `Type="agent"` hooks, no `Notification`/`SubagentStop`) suggest the M0 suite should include at least one deliberately-broken-tool and one crash-mid-turn scenario, asserting the ledger records the failure with the right evidence (exit code, error event) rather than silently losing the turn — directly serving the founder's "never trust self-report" principle.

---

## Test-tooling credentials

Scoped to what the **e2e tooling itself** needs, not Cloudflare-side credentials (covered by a sibling researcher per the task brief).

| Need | When required | Notes |
|---|---|---|
| **None** | Fake-brain runs (testagent-based, §2a) | Explicitly "No model, no network, no tokens" — this should be the default mode for the entire deterministic M0 suite. |
| **None** | MCP conformance / OAuth conformance suites (§1.3, §1.6) | Both run against locally-started fixture Workers via `createTestHarness()`/`wrangler dev`; no external API keys involved. |
| **GitHub PAT (or GitHub App installation token) for a fixture repo** | Any scenario where the Sandbox container needs to clone/push/PR against a real repo | Not directly evidenced in this research pass (out of scope of the sources fetched) — **flagging as a likely need, not a confirmed one**, since the product's stated shape ("workspace diff, PR-equivalent output") implies git remote access somewhere in the loop. The sibling GitHub-App-focused research (if any) should confirm scope (repo-scoped fine-grained PAT vs. GitHub App installation token) and whether a disposable test org/repo is warranted, mirroring this repo's own `authenticated-ui-smoke` pattern of a disposable test identity. |
| **One real Anthropic API key, for exactly one real-brain canary test** | Explicitly requested by the founder's framing ("the ONE real-brain canary test") | No prior-art tool found that specifically brokers "one real call, rest faked" as a first-class test mode — this is a design choice for the M0 harness, not something to adopt off the shelf. `OpenHands`' tiered strategy (§2c: ~$0.5–$3/run, <5 min for its LLM-based tier) is the closest cost/cadence precedent: budget similarly small, run infrequently (e.g. pre-merge or nightly, not per-commit). |
| **OTel/observability backend credentials (OTLP endpoint + auth header), if exporting traces during test runs** | Only if M0 wires Claude Code's beta traces (§3.2) or Cloudflare's native Workers tracing (§3.3) into a real backend during test runs, rather than just asserting locally | Cloudflare's native tracing viewing is **free in beta**; **exporting** requires Workers Paid (§3.3) — a plan-tier consideration, not a secret, but worth the founder knowing it's not zero-cost once exported. `evalite`/`evals`-style runs (§2c) additionally need whichever real-model provider key is configured (`ANTHROPIC_API_KEY` etc.) — same key as the canary test above, not a separate credential. |

No evidence was found requiring credentials for: MCP Inspector CLI mode against a local server (§1.1), the DO eviction test helpers (§3.3), or `evictDurableObject`/`vitest-pool-workers` generally.

---

## Open questions

- **Which specific class/import path does `StreamableHTTPClientTransport` (or its equivalent) live under in the newly-split `@modelcontextprotocol/client@2.0.0` package?** Confirmed the package split exists; did not confirm the exact API surface in this pass (§1.2).
- **Does Cloudflare's native Workers tracing (open beta) or the newer Agent-traces feature (2026-08-04) cover Workflows as a first-class traced primitive**, or only Durable Object *invocations* as one binding-call type among many? Neither source read explicitly confirmed or denied Workflows coverage (§3.3).
- **Is there a maintained, Workers/edge-native LLM HTTP-cassette (VCR-style) library**, as opposed to Python-only (`vcrpy`, `vcr-langchain`) or generic-Node (`nock`/`polly.js`) tools that would need Workers-runtime verification? Not confirmed either way (§2b) — worth a dedicated follow-up search focused specifically on "Workers-compatible fetch interception for tests" rather than "LLM cassette."
- **Does `mock-llm`'s MCP OAuth emulation (`docs/mcp-oauth.md`) offer anything `@cloudflare/workers-oauth-provider`'s own conformance suite doesn't**, given the latter is purpose-built for the exact library this product uses? Not compared in depth (§2a) — likely redundant given §1.6's stronger fit, but not confirmed redundant.
- **Does Anthropic publish any first-party "testing agents built on Claude Code" guidance** beyond the OTel/monitoring docs? Not found in this pass (§2c) — possible the guidance exists under a different doc section (e.g. Agent SDK docs) not reached.
- **Is `mcp-testing-kit`'s repo/package name mismatch (`thoughtspot/mcp-therapy`) a red flag or benign renaming?** Not investigated (§1.5) — treat with caution until clarified.
- **What primary-source confirmation exists for the OTel GenAI semconv "moved to unreleased repo" claim** beyond secondary blog/community posts? Recommend directly reading `open-telemetry/semantic-conventions-genai`'s own README/CHANGELOG before this becomes load-bearing for implementation (§3.1).
- **How does SWE-bench-style tooling protect the oracle test suite itself from drift/flakiness** independent of agent changes? Not found in this pass (§2d) — likely needs the product's own answer (e.g. pin the fixture repo to a commit, run the oracle suite once pre-change to confirm it's green before trusting a post-change run against it).

---

## Sources

All fetched 2026-08-11 unless a different access/publish date is noted inline above.

- [`modelcontextprotocol/inspector`](https://github.com/modelcontextprotocol/inspector) — GitHub repo, README.md and `clients/cli/README.md` (raw). Official. Accessed 2026-08-11.
- [`modelcontextprotocol/typescript-sdk`](https://github.com/modelcontextprotocol/typescript-sdk) — GitHub repo, README.md and `examples/` directory listing. Official. Accessed 2026-08-11.
- [`@modelcontextprotocol/client` on npm](https://www.npmjs.com/package/@modelcontextprotocol/client) — registry metadata (v2.0.0). Official. Accessed 2026-08-11.
- [`@modelcontextprotocol/sdk` on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — registry metadata (v1.30.0, published 2026-07-27). Official. Accessed 2026-08-11.
- [`modelcontextprotocol/conformance`](https://github.com/modelcontextprotocol/conformance) — GitHub repo README.md (raw, full). Official. Accessed 2026-08-11; repo pushed 2026-08-10.
- [`@modelcontextprotocol/conformance` on npm](https://www.npmjs.com/package/@modelcontextprotocol/conformance) — registry dist-tags (latest 0.1.16, alpha 0.2.0-alpha.11). Official. Accessed 2026-08-11.
- [`cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) — GitHub repo, `conformance/README.md`, `conformance/client-registration.test.ts`, `conformance/support/harness.ts` (raw, full/substantial). Vendor (Cloudflare official). Accessed 2026-08-11.
- [`@cloudflare/workers-oauth-provider` on npm](https://www.npmjs.com/package/@cloudflare/workers-oauth-provider) — registry metadata (v0.10.3, published 2026-08-10). Vendor. Accessed 2026-08-11.
- [Cloudflare Docs: `createTestHarness()`](https://developers.cloudflare.com/workers/testing/test-harness/) — WebFetch summary. Official. "Last updated July 27, 2026," accessed 2026-08-11.
- [`cloudflare/claude-managed-agents`](https://github.com/cloudflare/claude-managed-agents) — GitHub repo, README.md, VALIDATION.md, `tests/helpers.ts`, `tests/api-microvm-custom-tools.test.ts` (raw). Vendor (Cloudflare official). Accessed 2026-08-11; repo pushed 2026-08-11 (same day).
- [`cloudflare/agents`](https://github.com/cloudflare/agents) — GitHub repo, `packages/agents/package.json`, `packages/agents/conformance/README.md`, `packages/agents/evals/README.md` + `scheduling.eval.ts`, `packages/agents/src/e2e-tests/fiber-eviction.test.ts` (raw, substantial). Vendor (Cloudflare official). Accessed 2026-08-11.
- [`paultyng/testagent`](https://github.com/paultyng/testagent) — GitHub repo README.md (raw, full) + GitHub API metadata. Community, real code, MIT license, 6 stars. Accessed 2026-08-11; repo pushed 2026-07-22.
- [`dwmkerr/mock-llm`](https://github.com/dwmkerr/mock-llm) — GitHub repo README.md (raw, partial) + GitHub API metadata. Community, real code, 13 stars. Accessed 2026-08-11; repo pushed 2026-07-28.
- [npm registry search API](https://registry.npmjs.org/-/v1/search) — queries for `mcp-test`, `mcp-testing`, "model context protocol testing"; individual package metadata for `mcp-testing-kit`, `@dotsetlabs/bellwether`, `@msfeldstein/mcp-test-servers`, `promptfoo`. Official (npm registry data). Accessed 2026-08-11.
- [Cloudflare changelog: Durable Object eviction test helpers](https://developers.cloudflare.com/changelog/post/2026-06-25-durable-object-eviction-test-helpers/) — WebFetch summary. Official. Dated 2026-06-25, accessed 2026-08-11.
- [Cloudflare changelog: Agent traces for Think, Flue, and AI SDK](https://developers.cloudflare.com/changelog/post/2026-08-04-agent-tracing/) — WebFetch summary. Official. Dated 2026-08-04, accessed 2026-08-11.
- [Cloudflare blog: Workers automatic tracing, open beta](https://blog.cloudflare.com/workers-tracing-now-in-open-beta/) — WebFetch summary. Vendor-blog. Published 2025-10-28, accessed 2026-08-11.
- [Claude Code docs: Monitoring & OTel configuration](https://code.claude.com/docs/en/monitoring-usage) — WebFetch, full. Official. Accessed 2026-08-11.
- [`anthropics/claude-code` issue #32364](https://github.com/anthropics/claude-code/issues/32364) — GitHub API, issue body. Official repo, community-filed issue, open. Opened 2026-03-09, accessed 2026-08-11.
- [arXiv 2511.03690 — "The OpenHands Software Agent SDK"](https://arxiv.org/html/2511.03690v1) — WebFetch summary of Section 5.1/8.17. Third-party (academic). Accessed 2026-08-11.
- OpenTelemetry GenAI semantic conventions status — WebSearch synthesis of `opentelemetry.io/blog/2026/genai-observability/`, `john-hodge.com`, `dev.to` community posts. Mixed official-blog + community, secondary/aggregated. Dated through 2026-07-17, accessed 2026-08-11.
- Vercel AI SDK telemetry — WebSearch synthesis of SigNoz, futureagi.com, Sentry cookbook, Vercel-ecosystem docs. Third-party/community, secondary. Accessed 2026-08-11.
- SWE-bench / tests-as-oracle — WebSearch synthesis of arXiv paper abstracts/snippets (2606.20683, 2605.27922, etc.) and benchmarkingagents.com. Third-party (academic + community), secondary. Accessed 2026-08-11.
- Braintrust + Cloudflare Agents integration — WebSearch synthesis of `braintrust.dev/blog/cloudflare-agents` and `braintrust.dev/articles/*`. Vendor-blog, secondary (not independently fetched in full). Accessed 2026-08-11.
- LangSmith + Cloudflare Workers — WebSearch synthesis of `support.langchain.com` article and `docs.langchain.com/langsmith/trace-without-env-vars`. Vendor support content, secondary. Accessed 2026-08-11.
- LLM record/replay (VCR/cassette) prior art — WebSearch synthesis referencing `vcr-langchain`, `langchain-replay`, generic VCR/nock/polly.js community write-ups. Community, secondary, not independently repo-verified. Accessed 2026-08-11.
