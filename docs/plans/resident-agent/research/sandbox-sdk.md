# Sandbox SDK

**TL;DR:** Cloudflare Sandbox SDK (`@cloudflare/sandbox`) is a GA (since 2026-04-13) TypeScript SDK that gives every named sandbox a Durable Object identity backed by an isolated Linux container (Ubuntu, Node 20, Bun, Python 3.11 variant, git, full network egress by default). It fits the resident-agent shape well: one sandbox per task, `exec`/`startProcess` with streaming, background processes, PTY terminals, programmatic egress proxying for credential injection (a GitHub App token never has to enter the container), R2/S3 bucket mounts via s3fs-FUSE, and squashfs backup/restore to R2. The two hard caveats: **container filesystems are fully ephemeral — sleep (default 10 min idle) wipes all state**, and the **true VM-level disk snapshots announced at GA ("coming weeks") still have no shipped documentation as of August 2026**, so persistence today means bucket mounts or backup/restore. The SDK is mid-churn: a June 2026 deprecation removed HTTP/WebSocket transports, the desktop feature, `exposePort()`, default sessions, and the stream-specific APIs (effective 2026-07-09), and a thinner 1.0 preview (`@next`, argv-based process handles, RPC-only, no sessions) is the recommended starting point for new projects.

**Status / maturity:** GA since **2026-04-13** (beta since June 2025). Current stable: **0.12.5** (published 2026-08-07). 1.0 preview on `@next`: **0.13.0-next.724.1** (2026-08-07), recommended by Cloudflare for new projects. Built on Cloudflare Containers (also GA 2026-04-13); requires the Workers Paid plan ($5/mo). Production users cited at GA include Figma (Figma Make). All facts below verified against developers.cloudflare.com and the GitHub repo on **2026-08-11**.

## Status: GA, versions, and the June 2026 deprecation

### GA and version line

- Beta launched June 2025; **GA announced 2026-04-13** in [Agents have their own computers with Sandboxes GA](https://blog.cloudflare.com/sandbox-ga/) during Agents Week 2026, at SDK version 0.8.9. Containers GA'd the same day.
- Version history from the npm registry (checked 2026-08-11): 0.12.2 (2026-06-25), 0.12.3 (2026-07-01), 0.12.4 (2026-07-21), **0.12.5 (2026-08-07, current `latest`)**; 1.0 preview line **0.13.0-next.724.1 (2026-08-07, current `@next`)**.
- The GitHub repo README still says "Beta — APIs may change before v1.0" (stale relative to the GA announcement).

### June 2026 deprecation (announced 2026-06-09, effective 2026-07-09)

Per the [deprecation changelog](https://developers.cloudflare.com/changelog/post/2026-06-09-deprecating-sandbox-sdk-features/) and the [2026 deprecation migration guide](https://developers.cloudflare.com/sandbox/guides/2026-deprecation/), these were removed from releases after **2026-07-09**:

1. **HTTP and WebSocket transports → RPC only.** The transport governs how the container talks to the Durable Object. RPC shipped April 2026, is the recommended default since 2026-06-09, and is the *only* transport in the 1.0 preview. Migrate via `SANDBOX_TRANSPORT: "rpc"` in wrangler vars or `getSandbox(env.Sandbox, id, { transport: "rpc" })`. RPC requires SDK ≥ 0.9.1 and matters for subrequest limits (HTTP transport = one Worker subrequest per SDK call; RPC multiplexes over one persistent connection).
2. **Desktop feature removed** (in 0.10.2). It ran a full Linux desktop (VNC/noVNC) for computer-use automation; low adoption after Cloudflare Browser Run shipped. Replacement: build it yourself with extensions.
3. **`exposePort()` → Cloudflare Tunnel API.** Tunnels fix local-dev and `workers.dev` preview URL problems. Quick tunnels (`*.trycloudflare.com`) for dev/demos; named tunnels for production/stable hostnames. Requires RPC transport:

   ```ts
   const sandbox = getSandbox(env.Sandbox, "my-sandbox", { transport: "rpc" });
   const server = await sandbox.startProcess("python -m http.server 8080");
   await server.waitForPort(8080);
   const tunnel = await sandbox.tunnels.get(8080);   // → https://<random>.trycloudflare.com
   ```

   Quick-tunnel URLs do not survive container restarts; `get()` is idempotent per port (cached in DO storage); `*.trycloudflare.com` buffers SSE but WebSockets work.
4. **Default sessions deprecated.** Previously `exec()` calls shared shell state (a `cd` persisted across calls) — this "confused agents and caused hard-to-trace bugs." `enableDefaultSession: false` (added in 0.10.3) opts out; the concept and flag will be removed. Current pattern: explicit sessions or per-call `cwd`/`env`:

   ```ts
   const build = await sandbox.createSession({ id: "build", cwd: "/workspace/app" });
   await build.exec("npm install");
   await build.exec("npm test");
   // or one-off:
   await sandbox.exec("npm test", { cwd: "/workspace/app", env: { NODE_ENV: "test" } });
   ```
5. **Stream-specific APIs consolidated.** `execStream()`, `readFileStream()`, `writeFileStream()` are removed; the base `exec()`/`readFile()`/`writeFile()` take streaming options (`stream: true`, `onOutput` callback, `ReadableStream` bodies, `encoding: "none"` for binary reads).

Also announced as under exploration: moving the code interpreter, terminal, and git APIs out of core into helpers/extensions.

### Sandbox SDK 1.0 preview (`@next`) — the current recommended target for new work

From the [1.0 preview docs](https://developers.cloudflare.com/sandbox/1-0-preview/): a thinner SDK on the same Containers foundation. Key contract changes vs stable:

- `exec()` takes **argv** (`["npm", "test"]`, or `['/bin/bash', '-lc', '...']` for shell features) and resolves when the process **launches**, returning one process handle used for both short commands and long-running services: `output()`, `logs()`, `waitForExit()`, `waitForLog()`, `waitForPort()`, `kill(signal)` (numeric, default 15).
- **No sessions at all** — each `exec()` is independent; pass `cwd`/`env` per launch; isolate users with separate sandboxes, not sessions.
- **RPC transport always** — no `SANDBOX_TRANSPORT`, `transport` option, or `setTransport()`.
- Terminals are first-class PTY resources (`createTerminal`, `terminal.connect(request)`); code interpreter is an opt-in extension on your `Sandbox` subclass.
- Unchanged: files/file-watching, storage and backups, ports and tunnels, lifecycle/sandbox options, outbound traffic controls.
- Worker package and container image must come from the same line (don't mix stable image with `@next` package).
- Migration guide explicitly inventories stable-line call sites to port: `exec`, `execStream`, `startProcess`, string kill signals, process stdin, `createSession`, `enableDefaultSession`, `SANDBOX_TRANSPORT`, `sandbox.terminal`, `createCodeContext`/`runCode`, `gitCheckout`.

Cloudflare ships agent skills for this: `sandbox-stable`, `sandbox-next`, `sandbox-migrate-to-next`.

## Core API

Entry point ([docs index](https://developers.cloudflare.com/sandbox/), [API reference](https://developers.cloudflare.com/sandbox/api/)):

```ts
import { getSandbox } from "@cloudflare/sandbox";
export { Sandbox } from "@cloudflare/sandbox"; // DO class must be re-exported

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sandbox = getSandbox(env.Sandbox, "user-123"); // named, created on first use
    const result = await sandbox.exec("python --version");
    return Response.json({ output: result.stdout, exitCode: result.exitCode, success: result.success });
  },
};
```

**Commands** ([Execute commands guide](https://developers.cloudflare.com/sandbox/guides/execute-commands/)): `exec(cmd, opts)` waits and buffers; full shell support (pipes, redirects, `&&`); timeouts via per-call `timeout` ms, session `commandTimeoutMs`, or global `COMMAND_TIMEOUT_MS` (most specific wins; default none). Failure model: non-zero exit → `result.success === false`; couldn't start → throws. Streaming (post-consolidation form, from the migration guide):

```ts
await sandbox.exec("npm install", {
  stream: true,
  onOutput: (stream, data) => console.log(`[${stream}] ${data}`),
});
```

**Background processes** ([GA blog](https://blog.cloudflare.com/sandbox-ga/)): `startProcess()` returns immediately with a handle; readiness via `waitForPort()` / `waitForLog(regex)`:

```ts
const server = await sandbox.startProcess("npm run dev", { cwd: "/workspace" });
await server.waitForLog(/Local:.*localhost:(\d+)/);
```

**Files**: `writeFile` / `readFile` / `listFiles`; large/binary via streams with RPC transport:

```ts
await sandbox.writeFile("/workspace/archive.tar.gz", request.body);         // ReadableStream in
const file = await sandbox.readFile("/workspace/archive.tar.gz", { encoding: "none" }); // binary out
```

**Sessions** (stable line): `createSession({ id, cwd, commandTimeoutMs })` gives an isolated shell context with its own cwd/env; being phased out in 1.0.

**Terminals**: `sandbox.terminal(request, { cols, rows })` upgrades a WebSocket to a real PTY (shipped Feb 2026), xterm.js-compatible via `@cloudflare/sandbox/xterm`; per-terminal isolated shell; server-side output buffering replays on reconnect.

**Code interpreter**: `createCodeContext({ language: "python" })` + `runCode(...)` — persistent Jupyter-like state across calls, rich outputs (charts, tables, HTML).

**File watching**: `sandbox.watch(path, { recursive, include })` → SSE stream backed by inotify.

**Git**: `gitCheckout("https://github.com/org/repo", { targetDir: "/workspace", depth: 1 })` (example from the GA blog); see the [git workflows guide](https://developers.cloudflare.com/sandbox/guides/git-workflows/).

**Preview URLs / ports**: legacy `exposePort(port)` → deprecated; current path is `sandbox.tunnels.get(port)` (quick tunnels) or named tunnels; `proxyToSandbox(request, env)` in the Worker fronts the preview-URL routing (note `normalizeId: true` or lowercase IDs, since preview URL hostnames are lowercased by DNS).

## Container specs

**Images** ([Dockerfile reference](https://developers.cloudflare.com/sandbox/configuration/dockerfile/)): Ubuntu 22.04-based variants, version-locked to the npm package (SDK warns on version mismatch):

| Image | Tag | Contents |
| --- | --- | --- |
| Default | `docker.io/cloudflare/sandbox:0.12.5` | Ubuntu 22.04, Node.js 20 LTS + npm, Bun 1.x, curl, wget, **git**, jq, zip/unzip, procps, ca-certificates |
| Python | `...-python` | default + Python 3.11, pip, venv, matplotlib, numpy, pandas, ipython |
| OpenCode | `...-opencode` | default + OpenCode CLI (AI coding agent) |

Custom images: extend the base (`FROM docker.io/cloudflare/sandbox:...` + `RUN apt-get/pip/npm install`), wrangler builds and pushes on deploy; or graft the `/sandbox` control-plane binary onto any image with `COPY --from`. Runtime installs also work (`apt-get install`, `pip install`, `npm install`).

**Instance types** ([Containers limits](https://developers.cloudflare.com/containers/platform-details/limits/), current as of 2026-07-03 page update):

| Instance type | vCPU | Memory | Disk |
| --- | --- | --- | --- |
| lite | 1/16 | 256 MiB | 2 GB |
| basic | 1/4 | 1 GiB | 4 GB |
| standard-1 | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |

Custom instance types allowed (1–4 vCPU, ≤ 12 GiB, ≤ 20 GB disk, ≥ 3 GiB/vCPU, ≤ 2 GB disk per GiB memory). Account-level: 6 TiB concurrent memory, 1,500 concurrent vCPU, 30 TB concurrent disk, 50 GB total image storage. GA blog cites capacity of 15,000 concurrent lite / 6,000 basic / 1,000+ larger instances on the standard plan.

**Network egress** ([outbound traffic guide](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)): **open by default** (`enableInternet` defaults to true) — `curl`, `pip install`, `npm install`, `git clone https://github.com/...` all work out of the box, so the container can call external model APIs and clone from GitHub. Controls, evaluated in order: `deniedHosts` → `allowedHosts` (allowlist mode) → per-instance handlers → class handlers. With `enableInternet = false`, only ports 80/443 and Cloudflare DNS leave the sandbox. HTTPS is intercepted by default (`interceptHttps = true`) with an ephemeral CA auto-trusted by Node/curl/Python-requests/git. Only HTTP/HTTPS (80/443) goes through outbound handlers; other ports are never proxied. **Credential injection**: `outboundByHost` / `outbound` handlers run in the Workers runtime (outside the sandbox) and can attach secrets per-host, per-instance (`ctx.containerId`), so a GitHub token or Anthropic key can be injected at the network layer without ever existing inside the container. Runtime mutation: `setOutboundByHost()`, `allowHost()`, `denyHost()`, etc.

**Inbound**: localhost works inside the sandbox; sandboxes are isolated from each other; public inbound requires tunnels/preview URLs. Cannot load kernel modules or access host hardware.

**Max lifetime**: no hard maximum documented. Idle sleep (default 10 min, `sleepAfter`) is the normal end; `keepAlive: true` heartbeats every 30 s and prevents eviction indefinitely (you pay provisioned memory/disk while alive). Container start timeouts: `instanceGetTimeoutMS` default 30 s (provisioning), `portReadyTimeoutMS` default 90 s (API ready). UNVERIFIED: whether Cloudflare force-recycles very long-lived containers.

## Lifecycle & persistence

From the [sandbox lifecycle concept](https://developers.cloudflare.com/sandbox/concepts/sandboxes/) — the single most important page for this design:

- **Create-on-reference**: `getSandbox(env.Sandbox, "user-123")` starts the container on first call; same ID routes to the same instance from anywhere (first request pins geography).
- **Sleep**: after `sleepAfter` inactivity (default `"10m"`, accepts `"30s"`/`"5m"`/`"1h"` or seconds), the container stops. **On the next request a fresh container starts and ALL previous state is lost** — files, processes, sessions, interpreter contexts. Docs are blunt: "All files are deleted. All processes terminate. All shell state resets."
- **`keepAlive: true`**: never sleeps; 30-second heartbeats; persists across DO hibernation; toggle with `setKeepAlive(false)`; must eventually `destroy()` or it runs (and bills) forever.
- **`destroy()`**: explicit permanent teardown.
- Recommended patterns from the docs: per-user long-lived sandbox (`user-${userId}`), ephemeral task sandbox + `destroy()` in `finally`, idempotent task sandbox (`build-${repo}-${commit}`), and code that **re-initializes on wake** (check for expected files, recreate if missing).

### Snapshot/restore support

Three tiers, in increasing fidelity:

1. **True VM-level disk snapshots — announced, NOT verifiably shipped (UNVERIFIED).** The GA blog (2026-04-13) described `persistAcrossSessions = { type: "disk" }` for automatic snapshot-on-sleep, `snapshot()` / `start({ snapshot })` for manual checkpoint/fork, stored in R2, with live-memory capture "in future releases" — all under "rolling out in the coming weeks." As of 2026-08-11 there is **no snapshots page in the Sandbox SDK docs** (the full docs sitemap lists only backup/restore), and the current lifecycle page still says sleep wipes all state. Treat disk snapshots as vaporware until confirmed; do not design around them.
2. **Backup/restore — shipped** (changelog ~Feb 2026; [guide](https://developers.cloudflare.com/sandbox/guides/backup-restore/)). `createBackup({ dir: "/workspace", name, ttl, useGitignore })` → compressed **squashfs** archive uploaded to your R2 bucket (`backups/{id}/data.sqsh` + `meta.json`) via presigned URL; `restoreBackup(handle)` mounts it as a read-only **FUSE overlayfs** lower layer with a writable upper (copy-on-write). Handles are serializable (stash in KV/D1/DO storage). Default TTL 3 days, enforced at restore time only — expired objects linger until you delete them or set an R2 lifecycle rule. `useGitignore: true` (via `git ls-files`) skips `node_modules/` etc. Gotchas documented: `mksquashfs` must read every file (watch `0600`/`0700` tool dotfiles like `~/.claude`; fix with `chmod -R a+rX`); the FUSE mount is ephemeral — **re-restore after every container restart**; stop writers before restore. GA blog benchmark: boot + clone axios + `npm install` ≈ **30 s** vs restore-from-backup ≈ **2 s**.
3. **Bucket mounts — shipped** ([mount buckets guide](https://developers.cloudflare.com/sandbox/guides/mount-buckets/), [storage API](https://developers.cloudflare.com/sandbox/api/storage/)). `mountBucket()` mounts R2/S3/GCS/any S3-compatible bucket as a filesystem path using **s3fs-FUSE**:

   ```ts
   // Production R2: Worker binding, no credentials in the container (requires `export { ContainerProxy }`)
   await sandbox.mountBucket("MY_BUCKET", "/data");
   // Remote endpoint with credential proxying (DO re-signs SigV4; container holds dummy creds)
   await sandbox.mountBucket("my-bucket", "/data", {
     endpoint: "https://<acct>.r2.cloudflarestorage.com",
     credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
     credentialProxy: true,   // recommended; will become default
   });
   ```

   Options: `prefix` (mount a bucket subdirectory), `readOnly`, `localBucket` (wrangler dev: periodic bidirectional sync instead of FUSE). **Documented caveats**: "File operations on mounted buckets are slower than local filesystem due to network latency" — the docs' own best practice is to **copy hot files to local disk, work locally, copy results back**; production mounts overlay (hide) any image-seeded files under the mount path (relevant if you mount over `/workspace`); explicit-credentials mode writes an s3fs password file on container disk (exfiltratable) — use binding mounts or `credentialProxy`. **Not documented by Cloudflare**: git-repo-on-s3fs fidelity (symlinks, chmod, fsync/rename semantics, concurrent writers). s3fs is famously not fully POSIX; plan for git corruption risk if `.git` lives on the mount — UNVERIFIED against this SDK, needs a spike. Mounting over `/workspace` for the working tree while keeping `.git` on local disk is one workaround pattern.

## Relationship to Durable Objects

The SDK **is** a DO binding pattern ([architecture concept](https://developers.cloudflare.com/sandbox/concepts/architecture/)):

```jsonc
// wrangler.jsonc
{
  "durable_objects": { "bindings": [{ "class_name": "Sandbox", "name": "Sandbox" }] },
  "migrations": [{ "new_sqlite_classes": ["Sandbox"], "tag": "v1" }],
  "containers": [{ "class_name": "Sandbox", "image": "./Dockerfile" }]
}
```

- `export class Sandbox extends DurableObject` (from `@cloudflare/sandbox`) extends Cloudflare's `Container` class; the DO owns container lifecycle, routes SDK calls, manages preview URLs/tunnels, and stores small state (e.g. tunnel cache) in DO SQLite storage.
- `getSandbox(env.Sandbox, "id")` = `idFromName` + `get()` — the sandbox ID is the DO name, giving durable, globally routable identity. This maps 1:1 onto "one Durable Object per resident worker."
- The DO↔container link uses the configured transport (RPC going forward); the Worker↔DO hop is standard DO RPC via the stub.
- Subclassing `Sandbox` is the extension point: `enableInternet`, `allowedHosts`/`deniedHosts`, `outboundByHost`, `sleepAfter`, `envVars`, and (1.0) interpreter extensions live on the subclass.
- Billing consequence: every sandbox bills as Worker + Durable Object + Container.
- Note for the resident-agent design: the SDK's DO is the *container-facing* identity; a separate "resident worker" DO holding MCP-facing state and SQLite memory would be a second DO (or the same subclass extended), coordinating with the sandbox DO by name.

## Pricing

Sandbox bills as underlying Containers usage ([Containers pricing](https://developers.cloudflare.com/containers/pricing/), page dated 2026-04-21) plus Workers + Durable Objects + optional Workers Logs. Requires Workers Paid ($5/mo), which includes monthly allotments.

| Meter | Included (per month) | Overage |
| --- | --- | --- |
| Memory (provisioned) | 25 GiB-hours | $0.0000025 per GiB-second |
| CPU (**active usage only**) | 375 vCPU-minutes | $0.000020 per vCPU-second |
| Disk (provisioned) | 200 GB-hours | $0.00000007 per GB-second |

- Billed per 10 ms while the container is running; charges start on first request/manual start and stop at sleep → **scales to zero**.
- **Memory and disk are billed on provisioned instance-type size; CPU is billed only while actively executing** (GA change: "Active CPU Pricing" — idle-waiting-on-the-LLM time costs memory/disk but ~no CPU).
- Egress: NA/EU $0.025/GB (1 TB included); Oceania/Korea/Taiwan $0.05/GB (500 GB incl.); elsewhere $0.04/GB (500 GB incl.).
- R2 storage/operations for mounts, backups, and snapshots are billed separately at standard R2 rates (R2 has zero egress fees).

## Running coding agents inside

Documented, first-party:

- **Claude Code** — official tutorial [Run Claude Code on a Sandbox](https://developers.cloudflare.com/sandbox/tutorials/claude-code/) and a repo example (`examples/claude-code`): Worker takes `{repo, task}`, clones into a sandbox, runs Claude Code headless with `ANTHROPIC_API_KEY`, returns logs + git diff. Works today; ~5-minute setup.
- **OpenCode** — dedicated `-opencode` image variant and a repo example (web UI or SDK in a sandbox).
- **Devin** — official tutorial [Run Devin Outposts on Cloudflare](https://developers.cloudflare.com/sandbox/tutorials/devin-outposts/): each Devin session in an isolated Cloudflare container.
- **OpenAI Agents SDK** — official tutorial + example (`Shell`/`Editor` tools); OpenAI's April 2026 Agents SDK update lists Cloudflare as a launch sandbox partner.
- **Claude Managed Agents** — tutorial for running Anthropic's managed agents on self-managed Cloudflare environments.
- Also: code-review bot, automated testing pipeline (clone → install → test → report), Workers AI code interpreter tutorials.

No first-party Pi or Aider examples found (UNVERIFIED either way), but any npm/pip-installable CLI runs — the container is a full Ubuntu with open egress; `npm i -g <agent-cli>` at boot or baked into a custom Dockerfile.

**Cold-start timing (documented/reported numbers):**

- First `wrangler deploy` / local `docker build`: 2–3 minutes one-time (image build + provisioning), per the repo README.
- GA blog: boot sandbox + `git clone` axios + `npm install` ≈ **30 s**; restore from R2 backup ≈ **2 s**.
- Third-party comparisons report 1–5 s container cold starts (UNVERIFIED, not Cloudflare-published).
- Container start timeout defaults (30 s provisioning / 90 s port-ready) imply Cloudflare expects sub-30 s starts normally.
- Baking the agent CLI + dependencies into the image (`RUN npm install -g ...`) moves install cost to deploy time; per-task cost is then container start + shallow clone (~seconds).

## Fit for resident agent service

**(a) Workspace-on-R2 with ephemeral containers ("containers are cattle") — good fit, with one sharp edge.** The platform is explicitly designed for this: sleep wipes state, docs tell you to design for re-initialization, and the persistence answers are R2 bucket mounts (live FUSE view of the workspace) and backup/restore (2 s warm restore vs 30 s cold rebuild). The sharp edge: s3fs is the mount engine, and Cloudflare's own docs steer you to copy-hot-files-locally. A git working tree *with `.git`* on the mount is a corruption/consistency risk that is undocumented — spike it before committing. Safer composition: workspace files on the mount (or restored from backup), `.git` and agent scratch on local disk, backup on sleep/turn end. If/when the announced disk snapshots ship, this gets much better.

**(b) Third-party coding agent CLI per task — strong fit.** This is literally the reference use case (Claude Code, OpenCode, Devin, OpenAI Agents all have first-party examples). Full Ubuntu userland, open egress to model APIs, PTY support for TUI-style CLIs, background processes for dev servers the agent spins up, and file-watching for reactive loops. The credential-injection egress proxy is the standout feature: the agent CLI can call `api.anthropic.com` or `github.com` without the raw key ever existing inside the container.

**(c) Worker-clones-repo flow — strong fit.** Default-open egress covers `git clone https://github.com/...`; git is preinstalled; `gitCheckout` exists on stable (moving to a helper in 1.0). For GitHub App tokens: either pass an installation token as env (simple, but the token is readable inside the container) or — better — use `outboundByHost: { "github.com": ... }` to inject the token in the Worker, scoped per-sandbox via `ctx.containerId`, revocable at runtime with `removeOutboundByHost`. This matches the resident-agent trust model where the container is semi-trusted.

**(d) Cold-start latency for "ask the worker" — acceptable, needs engineering.** Warm path (sandbox awake, default 10-min idle window): one DO RPC + exec, no meaningful added latency. Cool path (backup restore): ~2 s + process spawn — fine for an async turn, borderline for interactive. Cold path (fresh boot + clone + install): ~30 s — too slow for interactive; mitigate with a custom image pre-baking the agent CLI and common deps, shallow clones, and eager restore-on-wake. The announced-but-unshipped disk snapshots target exactly this gap; until they land, `keepAlive: true` on active workers (paying provisioned memory/disk, near-zero idle CPU) is the pragmatic latency fix.

Overall: Sandbox SDK is the most natural execution substrate on Cloudflare for this architecture — it *is* one-DO-per-named-sandbox already. The main design work is persistence discipline (ephemeral disk + R2 mount/backup choreography) and tracking the 1.0 migration (start new code on `@next` or be ready to port `exec`/session/git call sites).

## Open questions

1. **Did VM-level disk snapshots (`persistAcrossSessions`, `snapshot()`/`start({snapshot})`) actually ship?** Announced "coming weeks" at GA (2026-04-13); no docs page as of 2026-08-11. Check the changelog/Discord or test on a live account before relying on them.
2. **Git fidelity on s3fs bucket mounts**: symlink/chmod/fsync/rename behavior, `.git` corruption risk, performance on large repos. No Cloudflare documentation; requires a hands-on spike (clone a real repo onto a mount, run git status/commit/fsck, measure).
3. **Hard maximum container lifetime** with `keepAlive: true` — is there forced recycling? Not documented.
4. **Real container cold-start distribution** (p50/p95) on paid accounts, and whether sandbox images are cached per-region after first pull. Third-party says 1–5 s; unverified.
5. **1.0 GA date** for `@cloudflare/sandbox` — `@next` is active (builds through 2026-08-07) but 1.0 stable is undated; how long will the 0.12.x stable line receive fixes?
6. **Named tunnels for per-worker preview URLs**: quota/limits of tunnels per account when every resident worker may expose one?
7. **Backup/restore of the whole container root** vs per-directory only — `createBackup({ dir })` is directory-scoped; capturing agent dotfiles + workspace means multiple backups or a common parent.
8. **Concurrent mount writers**: two sandboxes mounting the same bucket/prefix — documented as possible ("shared storage") but consistency semantics on conflicting writes are unspecified.

## Sources

Primary (fetched 2026-08-11):

- [Sandbox SDK docs index](https://developers.cloudflare.com/sandbox/) and [llms.txt page inventory](https://developers.cloudflare.com/sandbox/llms.txt)
- [GA blog: Agents have their own computers with Sandboxes GA](https://blog.cloudflare.com/sandbox-ga/) (2026-04-13)
- [Changelog: Deprecating Sandbox SDK features](https://developers.cloudflare.com/changelog/post/2026-06-09-deprecating-sandbox-sdk-features/) (2026-06-09) and [Sandbox SDK changelog](https://developers.cloudflare.com/changelog/product/sandbox/)
- [2026 deprecation migration guide](https://developers.cloudflare.com/sandbox/guides/2026-deprecation/)
- [Sandbox SDK 1.0 preview](https://developers.cloudflare.com/sandbox/1-0-preview/) and [Migrate to 1.0](https://developers.cloudflare.com/sandbox/1-0-preview/migrate/)
- [Concepts: Architecture](https://developers.cloudflare.com/sandbox/concepts/architecture/), [Sandbox lifecycle](https://developers.cloudflare.com/sandbox/concepts/sandboxes/), [Container runtime](https://developers.cloudflare.com/sandbox/concepts/containers/)
- [Guides: Execute commands](https://developers.cloudflare.com/sandbox/guides/execute-commands/), [Mount buckets](https://developers.cloudflare.com/sandbox/guides/mount-buckets/), [Backup and restore](https://developers.cloudflare.com/sandbox/guides/backup-restore/), [Handle outbound traffic](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)
- [Configuration: Sandbox options](https://developers.cloudflare.com/sandbox/configuration/sandbox-options/), [Dockerfile reference](https://developers.cloudflare.com/sandbox/configuration/dockerfile/)
- [Platform: Sandbox limits](https://developers.cloudflare.com/sandbox/platform/limits/), [Sandbox pricing](https://developers.cloudflare.com/sandbox/platform/pricing/), [Containers pricing](https://developers.cloudflare.com/containers/pricing/), [Containers limits and instance types](https://developers.cloudflare.com/containers/platform-details/limits/)
- [Tutorial: Run Claude Code on a Sandbox](https://developers.cloudflare.com/sandbox/tutorials/claude-code/); also referenced: Devin Outposts, OpenAI Agents SDK, Claude Managed Agents tutorials in the same section
- [GitHub: cloudflare/sandbox-sdk](https://github.com/cloudflare/sandbox-sdk) (README; examples incl. claude-code, opencode, openai-agents)
- npm registry `@cloudflare/sandbox` dist-tags/timestamps (0.12.5 latest, 0.13.0-next.724.1 next, both 2026-08-07)

Secondary (snippets only, used for cross-checks, not load-bearing): [InfoQ GA writeup](https://www.infoq.com/news/2026/04/cloudflare-sandboxes-ga/) (2026-04-22), [Modal sandbox comparison](https://modal.com/resources/best-code-execution-sandbox-llamaindex), third-party cold-start figures (1–5 s) from community comparison posts — all marked UNVERIFIED where used.
