# Brains, Computer & Precedents

**TL;DR.** `@cloudflare/computer` (preview, shipped 2026-08-03) is not a VM — it is a SQLite-backed virtual filesystem living inside a Durable Object, with a single pluggable execution surface (`workspace.runtime.exec`) and three backends: a full Linux container (via a FUSE-mounting `computerd` daemon inside a Cloudflare Sandbox container), a bash-only Dynamic Worker (`just-bash`), and an isolated ECMAScript-module Dynamic Worker. It is explicitly **PREVIEW ONLY / not for production**, but its architecture is a near-exact match for the resident agent service's "durable, addressable worker per task" model — Cloudflare itself frames it as "one agent per task" infrastructure. For models, the Vercel AI SDK (`generateText`/`streamText`/`ToolLoopAgent`) runs natively on the Workers runtime (Cloudflare's own `Think` harness and `@cloudflare/computer/tools` are built on it), Cloudflare AI Gateway gives BYOK + unified billing + caching + observability for external providers, and Workers AI now hosts genuinely strong coding models (GLM-5.2, Kimi K2.7-code, gpt-oss-120b) at Neurons-metered prices. Precedents — Project Think, Claude Managed Agents on Cloudflare, the official Claude-Code-in-Sandbox tutorial — prove the DO-per-agent + sandboxed-brain pattern works; what remains unproven is doing it with *third-party* brains (Pi, Claude Code CLI) as interchangeable MCP-addressable workers, and doing it on Computer rather than raw Sandbox SDK.

**Status/maturity (all dates 2026):** `@cloudflare/computer` — public repo created 2026-06-05; npm 0.1.0/0.1.1 published 2026-08-03 during Agents Week; **0.2.0 published 2026-08-11** (verified against the npm registry today); README banner: "PREVIEW ONLY … NOT suitable for production use." Sandbox SDK — GA 2026-04-13. Agents SDK + Project Think (`@cloudflare/think`) — announced 2026-04-15, experimental/preview. AI Gateway — GA, available on all plans. Workers AI — GA, Neurons pricing.

---

## 1. @cloudflare/computer

### What it actually is

Per the [GitHub README](https://github.com/cloudflare/computer) and the [announcement post](https://blog.cloudflare.com/cloudflare-computer/) (2026-08-04):

> Cloudflare Computer is a virtual filesystem that lives inside a Durable Object. The Durable Object holds the authoritative state in SQLite and exposes one pluggable execution surface through `workspace.runtime`.

Key structural facts:

- **The Durable Object's SQLite is the source of truth.** Files are rows in the DO's own database, not a disk the DO points at. Whatever executes code gets a *projection* of that state, and writes flow back into SQLite.
- **One execution entry point:** `workspace.runtime.exec(source, { backend })`. The selected backend decides whether `source` is a shell command or an ECMAScript module. Backends connect lazily on first use; a Workspace may register multiple backends under stable IDs, or none at all (filesystem-only).
- **Three backends ship in the preview:**
  1. **Container** — projects SQLite state into a Cloudflare Sandbox container as a real FUSE mount. A sandbox-side daemon, `computerd`, mounts the state and syncs changes back over a [capnweb](https://github.com/cloudflare/capnweb) RPC channel. Full Linux userland, real binaries, real network.
  2. **Isolate shell** — runs [`just-bash`](https://www.npmjs.com/package/just-bash) in a Dynamic Worker, reaching the authoritative Workspace over Workers RPC. No second store, no sync round trip. No Linux binaries.
  3. **Isolate JavaScript** — runs an ECMAScript module in a fresh Dynamic Worker with structured input/results, durable relative imports, Workspace-backed `node:fs/promises`, and trusted `ws:git` / `ws:artifacts` modules.
- **Tooling is AI-SDK-native:** `createAITools` from `@cloudflare/computer/tools` returns a Vercel AI SDK `ToolSet` (`read`, `write`, `edit`, `ls`, `exec`), where the `exec` tool takes a `backend` argument and its description steers the model to pick isolate vs container. Cloudflare reports frontier models are "very good" at this routing decision in their testing.
- **Governance story:** all read/write/edit/shell operations are "gated, audited, and observed" (per the [changelog entry](https://developers.cloudflare.com/changelog/post/2026-08-03-cloudflare-computer/)) — a paper trail of agent changes, which matters for a product exposing workers to external agents.

### API sketch (from the announcement post)

```ts
import { Workspace } from "@cloudflare/computer";

export class Agent {
  workspace = new Workspace({ storage: this.ctx.storage });
}

// Direct filesystem access
await this.workspace.fs.mkdir("/workspace", { recursive: true });
await this.workspace.fs.writeFile("/workspace/BUG_REPORT.md", "...");
await this.workspace.git.clone({ url: report.repoUrl, dir: "/workspace/repo" });
```

Container backend wiring:

```ts
import { Workspace, WorkspaceProxy } from "@cloudflare/computer";
import {
  CloudflareContainerBackend,
  withWorkspaceContainer,
} from "@cloudflare/computer/backends/container";

export class Agent extends withWorkspaceContainer(Think) {
  override workspace = new Workspace({
    storage: this.ctx.storage,
    backends: [
      new CloudflareContainerBackend({
        container: () => this,
        workspace: { binding: "Agent", id: this.ctx.id.toString() },
      }),
    ],
  });
}
```

### Repo layout and maturity signals

The repo is a monorepo ([README](https://github.com/cloudflare/computer)):

- `packages/dofs` → `@cloudflare/dofs` — the DO SQLite-backed VFS, sync-protocol building blocks, and a `@platformatic/vfs` provider for Node.
- `packages/rpc` → `@cloudflare/computer-rpc` — capnweb wire types shared between DO and `computerd`.
- `packages/computerd` → `@cloudflare/computerd` — the FUSE-mount + HTTP/WebSocket RPC daemon that runs inside the container.
- `packages/computer` → `@cloudflare/computer` — the top-level package consumed by Durable Objects. Marked "work in progress."

Runtime deps of `0.2.0` are tiny: `acorn`, `capnweb`, `just-bash` (verified via npm registry, 2026-08-11). Examples shipped: `container`, `worker-shell`, `worker-javascript`, `egress` (per-backend egress policies: `none`/`all`/custom), `think` (a `@cloudflare/think` chat agent using the workspace), `think-compare-runtimes`, `tutorial`, `artifacts`, `assets`.

npm publish history (verified 2026-08-11 against registry.npmjs.org): `0.0.0` 2026-07-29 → `0.1.0-alpha.1` 2026-07-30 → `0.1.0` 2026-08-03 12:19 UTC → `0.1.1` 2026-08-03 13:01 UTC → **`0.2.0` 2026-08-11** (`dist-tags.latest = 0.2.0`). The pace (0.2.0 eight days after launch) confirms active iteration and unstable APIs.

### Why Cloudflare built it

The [announcement post](https://blog.cloudflare.com/cloudflare-computer/) is explicit: the industry pattern of "one container per agent" cannot scale to hundreds of millions of concurrent agents — "there's nowhere near enough compute in the world." Isolates are Cloudflare's answer: hibernatable, milliseconds to start, near-zero idle cost. The design goal stated in the post: **a container should be needed for less than 10% of an agent's work**; file manipulation, git, document creation, and coding tasks should mostly run in isolates against the durable workspace. This continues the "hands vs brain" separation — the sandbox is a tool the agent loop calls, not the agent's home.

### Relationship to the Sandbox SDK

Computer does **not** replace the Sandbox SDK — its container backend is built *on* Cloudflare Containers/Sandbox (the `computerd` daemon runs inside a sandbox container; the README's perf doc compares against `cloudflare/sandbox-sdk` `npm install` numbers). The difference is where authoritative state lives:

- **Raw Sandbox SDK:** state lives in the container's filesystem; you handle persistence (R2 sync, snapshots) yourself.
- **Computer:** state lives in DO SQLite; the container is a disposable projection synced via FUSE + capnweb. Container death loses nothing.

### Roadmap signals

- "PREVIEW ONLY … APIs are unstable and the design is subject to change… The specification under `docs/` is forward-looking — read it for intent, not as description of the code today."
- The blog's example code carries `useThink: true, // soon will not be needed` — implying imminent Think integration cleanup.
- The `egress` example and "gated, audited, observed" framing point at policy/egress control as a first-class roadmap item.
- Cloudflare says they already run agents internally that "exclusively use isolates to build, test, and deploy JavaScript applications" — dogfooding is underway, but external production usage is explicitly discouraged today.

---

## 2. Model access from Cloudflare

### (a) Vercel AI SDK on the Workers runtime

**Verdict: works, and is the de-facto standard on the platform.** Evidence:

- Cloudflare's own docs ship an official integration: [`workers-ai-provider`](https://developers.cloudflare.com/workers-ai/configuration/ai-sdk/) adapts the `AI` binding into an AI SDK `LanguageModel`, with `generateText`, `streamText`, and `generateObject` examples running inside a Worker `fetch` handler.
- Cloudflare's `Think` harness runs its whole agentic loop on `streamText` inside a Durable Object ([Project Think post](https://blog.cloudflare.com/project-think/)), and `@cloudflare/computer/tools` exports AI SDK `ToolSet`s. Cloudflare's own [chat-agents docs](https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/) document in-process subagents built on the AI SDK's `ToolLoopAgent`. So `ToolLoopAgent` on Workers is not just compatible — it's the pattern Cloudflare documents.
- The AI SDK core is fetch-based TypeScript; the `ai` package itself has no hard Node dependency. Caveats to verify per-provider: some provider packages or telemetry exporters historically assume Node builtins — enable `nodejs_compat` and pin versions. **UNVERIFIED:** no first-party source found enumerating which AI SDK v6/v7 provider packages fail without `nodejs_compat`; treat individual provider packages as check-before-use. One concrete third-party data point: a July 2026 write-up of AI SDK 7 migration covers `ToolLoopAgent` behavior around streaming interruption/Cloudflare 524 timeouts ([xbstack.com](https://www.xbstack.com/)) — relevant because long agent turns in a Worker can hit platform request-duration limits; Durable Object alarms/fibers or Workflows are the standard mitigation.

Practical implication for this repo: the existing `packages/agent` `openAgent` (a `ToolLoopAgent`) pattern ports to a Worker/DO context architecturally, but anything Node-flavored in the dependency tree needs `nodejs_compat` validation.

### (b) Cloudflare AI Gateway

From the [AI Gateway docs](https://developers.cloudflare.com/ai-gateway/) and [pricing page](https://developers.cloudflare.com/ai-gateway/reference/pricing/) (checked 2026-08-11):

- **What it is:** a proxy in front of OpenAI, Anthropic, Google, Workers AI, and others — one line of code to adopt. Features: analytics (requests, tokens, cost), logging, caching, rate limiting, request retries, model fallback, guardrails, DLP.
- **BYOK (Store Keys):** store provider API keys with Cloudflare; the gateway injects them at runtime so code never carries secrets. Multiple keys per provider with aliases (`cf-aig-byok-alias` header selects non-default keys) — useful for per-customer key separation in a multi-tenant resident-agent product. ([BYOK docs](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/))
- **Unified Billing:** alternatively buy credits through Cloudflare; provider per-token prices are passed through with **no markup**, but a **5% fee applies to credit purchases** ($100 of credits costs $105). Spend limits work with both Unified Billing and BYOK.
- **Pricing of the gateway itself:** core features (analytics, caching, rate limiting) are free on all plans. Persistent logs free within limits (Free: 100k logs total; Paid: 10M logs/gateway). On Workers Paid: 10M requests/month included, then $0.05/million. Guardrails runs `@cf/meta/llama-guard-3-8b` on Workers AI and is billed as Workers AI inference.
- **AI SDK integration:** there is a community provider (`cloudflare-ai-gateway`) plus official [integration docs](https://developers.cloudflare.com/ai-gateway/integrations/vercel-ai-sdk/), so gateway routing is a baseURL/provider-config change, not an architecture change.

### (c) Workers AI

From the [pricing/model pages](https://developers.cloudflare.com/workers-ai/platform/pricing/) (checked 2026-08-11):

- **Metering:** Neurons — $0.011 per 1,000 Neurons; docs also give per-token equivalents. Free allocation on all plans.
- **Catalog highlights relevant to coding agents** (per-token equivalents from the pricing table):

  | Model | Input $/M | Output $/M | Note |
  |---|---|---|---|
  | `@cf/zai-org/glm-5.2` | 1.40 (0.26 cached) | 4.40 | Strong agentic-coding open model; used in Computer's own examples |
  | `@cf/moonshotai/kimi-k2.7-code` | 0.95 (0.19 cached) | 4.00 | Coding-specialized Kimi |
  | `@cf/moonshotai/kimi-k2.6` | 0.95 (0.16 cached) | 4.00 | |
  | `@cf/openai/gpt-oss-120b` | 0.35 | 0.75 | Open-weight OpenAI model |
  | `@cf/qwen/qwen2.5-coder-32b-instruct` | 0.66 | 1.00 | Older coding specialist |
  | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 0.293 | 2.253 | General purpose |

- **When sufficient vs external:** Workers AI is sufficient for routing, summarization, memory compaction, simple tool loops, and cost-sensitive default brains (GLM-5.2/Kimi are credible mid-tier coding agents at a fraction of frontier prices). It is **not** a substitute for frontier models (Claude/GPT-5.x-class) on hard, long-horizon coding tasks — for those, route through AI Gateway to Anthropic/OpenAI with BYOK. Note the April 2026 Agent Cloud press release also promised proprietary models (OpenAI GPT-5.4) "through a single pane of glass" post-Replicate-acquisition — the exact delivery mechanism for proprietary models on Workers AI vs AI Gateway passthrough is **UNVERIFIED** in detail.

---

## 3. Precedents

### Cloudflare's own positioning: Agent Cloud (2026-04-13)

The [press release](https://www.cloudflare.com/press/press-releases/2026/cloudflare-expands-its-agent-cloud-to-power-the-next-generation-of-agents/) is the canonical statement of intent. Cloudflare claims the stack is for moving agents "from experimental demos on local laptops to robust, production-grade workloads." Components announced together: **Dynamic Workers** (isolate sandboxing, "100x the speed and a fraction of the cost of containers"), **Artifacts** (Git-compatible agent-scale storage), **Sandboxes GA** (persistent Linux microVMs), **Think** (Agents SDK framework for long-running persistent agents), and an expanded model catalog. Matthew Prince: agents need "a home that is secure by default, scales to millions instantly, and persists across long-running tasks." OpenAI is quoted endorsing it for Codex/GPT-5.4 workloads. This is exactly the resident agent service's thesis, stated by the platform vendor.

### Project Think / Agents SDK (2026-04-15)

The [Project Think post](https://blog.cloudflare.com/project-think/) is the strongest direct precedent for "long-lived agent per task":

- **Actor model, one agent per task:** "Instead of 'one expensive agent per power user,' you can build 'one agent per customer' or **'one agent per task'** or 'one agent per email thread.' The marginal cost of spawning a new agent is effectively zero." Each agent = a Durable Object with identity, SQLite state, hibernation, wake-on-message (HTTP, WebSocket, alarm, **inbound email**).
- **Durable execution without Workflows:** `runFiber()` registers durable function invocations in SQLite with `stash()` checkpoints and `onFiberRecovered` restart — an alternative/complement to Cloudflare Workflows for surviving 30s+ LLM calls. (The Agents SDK also ships `AgentWorkflow` extending Workflows with bidirectional agent communication per the [Workflows durable-agents docs](https://developers.cloudflare.com/workflows/get-started/durable-agents/).)
- **Sub-agents (Facets):** child DOs colocated with the parent, isolated SQLite each, typed RPC — a native pattern for resident-worker hierarchies.
- **Execution ladder:** Tier 0 Workspace (SQLite+R2 filesystem, `@cloudflare/shell`) → Tier 1 Dynamic Worker (`@cloudflare/codemode`) → Tier 2 +npm (`@cloudflare/worker-bundler`) → Tier 3 Browser Run → Tier 4 full Sandbox. "The agent should be useful at Tier 0 alone." `@cloudflare/computer` is essentially this ladder productized (Aug 2026).
- **Session API:** tree-structured messages, forking, non-destructive compaction, FTS5 search — a reference design for worker memory beyond a flat transcript.
- Status: experimental/preview; Cloudflare states they use it internally "to build our own background agent infrastructure." Roadmap tracked in [cloudflare/agents#1439](https://github.com/cloudflare/agents/issues/1439).

### Third-party brains inside Cloudflare sandboxes

- **Claude Code in Sandbox SDK — official tutorial** ([docs](https://developers.cloudflare.com/sandbox/tutorials/claude-code/), 2026-05): "Build a Worker that takes a repository URL and a task description and uses Sandbox SDK to run Claude Code to implement your task." Ships as a template (`cloudflare/sandbox-sdk/examples/claude-code`). Direct proof that the "Claude Code as pluggable brain in a container" leg of the architecture is supported by the vendor.
- **Claude Managed Agents on Cloudflare** ([blog](https://blog.cloudflare.com/claude-managed-agents/), 2026-05-19): Anthropic's agent loop ("brain") runs on Anthropic's platform while Cloudflare supplies the "hands" — sandboxed execution (MicroVM **or** isolate backend selectable per agent), egress proxies with zero-trust credential injection, private connectivity via Workers VPC/Mesh, browser tools with session recording, per-agent email. This is the brain/hands split done as a first-party partnership, and it validates running *someone else's* agent loop against Cloudflare execution. Its "isolate" backend option shows even Anthropic's production agents don't always need a container.
- **Community:** independent write-ups of autonomous Claude Code in Cloudflare sandboxes exist (e.g. [WellDunDun/claude-code-sandbox](https://github.com/WellDunDun/claude-code-sandbox) referenced in community skill docs, with cost breakdowns of ~$15–40/month typical usage); containerized multi-agent sandboxes for Claude Code/OpenCode (e.g. [avenga/coding-agent-sandbox](https://github.com/avenga/coding-agent-sandbox)) prove the pattern off-Cloudflare too. **UNVERIFIED:** no production-grade open-source project found yet that runs *multiple interchangeable brain CLIs* (Pi + Claude Code + Codex) behind one Cloudflare DO-per-task control plane exposed over MCP — that specific combination appears to be open territory.
- **Computer ecosystem:** Computer's own `examples/think` and `think-compare-runtimes` show a full chat agent working against a workspace on both runtimes; third-party analyses ([MoClaw](https://moclaw.ai/blog/ai-agent-sandbox-explained), [Flavio Copes](https://flaviocopes.com/cloudflare-computer/), [developersdigest](https://www.developersdigest.tech/blog/cloudflare-computer-agent-runtime-preview-2026)) all read it as "filesystem first, execution pluggable" — consistent with this document.

---

## Fit for resident agent service

**(a) Computer vs raw DO+Sandbox as the foundation.** Architecturally, Computer is the better-shaped foundation for a resident worker: identity + SQLite memory in the DO, workspace as rows in that same SQLite (no R2 sync code to write for the fs layer), container only when the brain needs Linux, and a governance story (gated/audited operations) that an MCP-facing multi-tenant service needs. The match is almost suspiciously exact — because Cloudflare designed it for precisely this product category. The blocker is maturity: it is 8 days old, self-declared not-for-production, APIs churning (0.1.1 → 0.2.0 in a week), docs explicitly "intent, not description." Recommendation: **prototype the resident worker on Computer now** (its `Workspace` + `exec` surface maps 1:1 onto the planned DO+Sandbox+R2 design), but **keep the raw Sandbox SDK + R2 path warm** as the production fallback; do not ship paying-customer traffic on Computer until it drops the PREVIEW banner. Note Computer's container backend presumes you can run `computerd` in the image — third-party brain CLIs (Pi, Claude Code) would be baked into that same image, which is exactly what the official Claude Code sandbox template already does.

**(b) Model-access strategy.** For a model-neutral, brain-pluggable product:

1. **Abstract at the AI SDK `LanguageModel` level** inside the worker's own loop (routing, memory compaction, status summaries) — it's the runtime-native choice and keeps the door open to every provider.
2. **Default cheap leg: Workers AI** (GLM-5.2 / Kimi K2.x / gpt-oss) for internal bookkeeping and budget brains — no external keys, Neurons billing, zero egress.
3. **Frontier leg: AI Gateway with BYOK** — customers' Anthropic/OpenAI keys stored at the gateway (aliases enable per-tenant keys), giving caching, spend limits, and token/cost observability for free. Avoid Unified Billing's 5% credit fee unless the operational simplification is worth it.
4. **Brains that bring their own model auth** (Claude Code with a subscription/API key inside the container) bypass the gateway by design — plan egress policy and cost attribution accordingly; the gateway only sees what the *worker* calls, not what the *brain* calls.

**(c) What precedents prove vs don't.** Proven: DO-per-agent with SQLite memory and hibernation at scale (Agents SDK, "thousands of production agents"); running a real third-party coding brain (Claude Code) inside Cloudflare Sandboxes (official template); the brain/hands split across organizations (Claude Managed Agents); durable multi-minute execution despite Worker limits (fibers, Workflows, `AgentWorkflow`); isolate-vs-container cost math (Dynamic Workers claims, Computer's design goal). Unproven: Computer itself in production; MCP exposure of per-task workers to *external* agent clients (Claude Code/Codex/ChatGPT as clients) on this stack — no public precedent found; multi-brain interchangeability behind one worker contract; and Computer's FUSE sync under heavy `npm install`-style workloads versus plain sandbox disk (their own benchmarks admit it "trails on large sequential I/O").

## Open questions

1. When does `@cloudflare/computer` lose the PREVIEW banner, and will 0.2.x → 1.0 break the `Workspace` constructor/`backends` API the resident worker would build on?
2. Can the container backend image carry arbitrary brain CLIs (Pi, Claude Code, Codex) alongside `computerd`, and who owns image builds/updates? (The Claude Code sandbox template suggests yes; not yet demonstrated *through* Computer.)
3. Does Computer's SQLite-backed fs hold up for repo-scale checkouts (node_modules, build outputs) versus syncing R2-backed workspaces manually? Their `docs/19_performance.md` admits sequential-I/O regressions — need a spike with a real monorepo.
4. MCP front-door: what is the current best practice for streaming MCP from a DO to external clients (Claude Code, ChatGPT) — Agents SDK `McpAgent` with hibernation? Any auth pattern blessed by Cloudflare for third-party-agent clients?
5. Workers AI long-context/tool-calling reliability of GLM-5.2 / Kimi K2.7-code versus Anthropic-direct for hour-long coding turns — benchmark needed before making Workers AI the default brain.
6. Proprietary models via Cloudflare post-Replicate (GPT-5.4 "single pane of glass") — is that AI Gateway passthrough or Workers AI hosting? Affects whether one billing path can cover everything.
7. If a brain (Claude Code CLI) holds its own provider credentials inside the container, how do we attribute and cap model spend per resident worker? AI Gateway can't see those calls.

## Sources

- https://github.com/cloudflare/computer
- https://blog.cloudflare.com/cloudflare-computer/
- https://developers.cloudflare.com/changelog/post/2026-08-03-cloudflare-computer/
- https://registry.npmjs.org/@cloudflare/computer (publish dates and 0.2.0 deps, verified 2026-08-11)
- https://moclaw.ai/blog/ai-agent-sandbox-explained
- https://www.developersdigest.tech/blog/cloudflare-computer-agent-runtime-preview-2026
- https://flaviocopes.com/cloudflare-computer/
- https://rohitraj.tech/de/notes/cloudflare-computer-vs-sandbox-agent-guide-2026
- https://ionsec.io/resources/ai-agent-runtime-forensics
- https://developers.cloudflare.com/workers-ai/configuration/ai-sdk/
- https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/
- https://developers.cloudflare.com/ai-gateway/
- https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/
- https://developers.cloudflare.com/ai-gateway/features/unified-billing/
- https://developers.cloudflare.com/ai-gateway/reference/pricing/
- https://developers.cloudflare.com/ai-gateway/integrations/vercel-ai-sdk/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://www.cloudflare.com/press/press-releases/2026/cloudflare-expands-its-agent-cloud-to-power-the-next-generation-of-agents/
- https://blog.cloudflare.com/project-think/
- https://github.com/cloudflare/agents/issues/1439
- https://blog.cloudflare.com/claude-managed-agents/
- https://developers.cloudflare.com/sandbox/tutorials/claude-code/
- https://developers.cloudflare.com/sandbox/tutorials/claude-managed-agents/
- https://developers.cloudflare.com/workflows/get-started/durable-agents/
- https://developers.cloudflare.com/agents/
- https://vercel.com/i/vercel-ai-gateway-vs-cloudflare-ai-gateway (competitor source; used only for the 5% Unified Billing fee, which Cloudflare's own pricing page confirms)
