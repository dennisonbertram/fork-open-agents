# Sandbox Runtime Preview And Browser Automation POC

## Summary

Open Agents already has enough Vercel Sandbox primitives to run web services and expose URLs: `exec`, `execDetached`, `domain(port)`, configured exposed ports, persistent named sandboxes, and lifecycle hibernation. The gap is productizing that runtime into first-class service preview records, process logs, browser evidence, explicit network policy, and honest URL security instead of relying on the agent to manually shell into the VM.

This POC keeps the current sandbox abstraction and Vercel-backed implementation. It adds a small runtime layer above it: a persisted sandbox service registry, log capture, browser-run artifacts, and session-level network policy controls. The goal is not to replace the sandbox provider or build a full deployment platform; it is to make "start the app, inspect it in a browser, show proof, and control egress" a supported Open Agents workflow.

## Current System Findings

### Sandbox provider boundary

- `packages/sandbox/interface.ts` defines the narrow provider abstraction. It already supports filesystem operations, `exec(...)`, optional `execDetached(...)`, optional `domain(port)`, `stop()`, `extendTimeout()`, `snapshot()`, and `getState()`.
- `packages/sandbox/vercel/sandbox.ts` implements this over `@vercel/sandbox`. It creates persistent named MicroVMs, exposes configured ports, injects `SANDBOX_HOST` and `SANDBOX_URL_<PORT>` into command environments, and includes `agent-browser` guidance in `environmentDetails`.
- `packages/sandbox/vercel/sandbox.ts` defaults network policy to a broad `allow: { "*": [] }`, with temporary GitHub credential brokering applied only during clone/setup and then cleared.
- `apps/web/lib/sandbox/config.ts` exposes four default ports: `3000`, `5173`, `4321`, and `8000`.
- `apps/web/app/api/sandbox/route.ts` creates/resumes named persistent Vercel sandboxes with `ports: DEFAULT_SANDBOX_PORTS`, a base snapshot when configured, and lifecycle timestamps persisted onto `sessions`.

### Existing service preview behavior

- `apps/web/app/api/sessions/[sessionId]/dev-server/route.ts` can detect a single package with a supported `dev` script, install dependencies when needed, start it via `sandbox.execDetached(...)`, write a sandbox-local state file, track a PID file, and return `sandbox.domain(port)`.
- The route currently supports one chosen dev server, fixed exposed ports, filesystem-local process state, a best-effort PID check, and no log API.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-dev-server.ts` stores readiness/error state in client component state and opens the returned URL in a new tab.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` renders a compact header action for starting/opening/stopping the dev server.

### Existing editor preview behavior

- `apps/web/app/api/sessions/[sessionId]/code-editor/route.ts` launches `code-server` on port `8000` with `--auth none`, checks process state via PID and `ps`, and returns `sandbox.domain(8000)`.
- `apps/web/app/codespace/[sessionId]/page.tsx` embeds the code-server URL in an iframe after authenticating the Open Agents page, but the underlying sandbox URL itself is still a direct public route if copied.

### Existing lifecycle behavior

- `apps/web/SANDBOX-LIFECYCLE.md` documents the current active -> hibernating -> hibernated -> restore state machine.
- Lifecycle state is persisted in `sessions` (`sandboxState`, `lifecycleState`, `lastActivityAt`, `sandboxExpiresAt`, `hibernateAfter`, `lifecycleRunId`, etc.).
- Hibernation stops the runtime. Long-running service processes are not durable across hibernation unless the product records enough metadata to relaunch them after resume.

### Existing agent behavior

- `packages/agent/tools/bash.ts` already supports `detached: true` for long-running processes.
- The agent has no typed `start_preview`, `browser_open`, `browser_snapshot`, `browser_click`, `browser_console`, or `preview_logs` tools. Browser automation is currently implied through the system prompt and shell-accessible `agent-browser`.
- The local `agent-browser` CLI supports realistic browser automation: navigation, interactive snapshots, clicks/fill/press, screenshots, video recording, network request inspection/interception, frames, cookies/storage, viewport/device settings, and JavaScript evaluation.

### Existing observability and redaction precedent

- Verified Build planning already treats browser evidence, screenshots, command output, redaction, artifacts, and final reports as first-class concepts in `docs/plans/verified-build-contracts-v0.md`.
- Harness code under `apps/web/lib/harness/*` already has a redaction helper and logger pattern. A sandbox runtime POC should reuse the same redaction posture: command output, logs, URLs containing tokens, env values, and browser artifacts must be capped and redacted before persistence or display.

## Current Provider Docs Checked

Context7 was used for current Vercel documentation.

- Vercel Sandbox exposes public URLs for configured ports through `domain(port)`. The port must be configured as an exposed port.
- The current Vercel REST docs for updating a sandbox say `ports` can be updated and that each exposed port gets a unique URL, with a documented maximum of 15 exposed ports.
- Vercel Sandbox `runCommand` supports detached commands for long-running servers. It can stream `stdout` and `stderr` to local writable handlers, and a detached command can later be awaited with `command.wait()`.
- Vercel sandbox network policy can be changed after creation. The current docs describe `allow-all`, `deny-all`, custom allowlisted domains/CIDRs, denied CIDRs, and injection rules.

References:

- https://vercel.com/docs/vercel-sandbox/sdk-reference
- https://vercel.com/docs/vercel-sandbox/python-sdk-reference
- https://vercel.com/docs/rest-api/sandboxes/update-a-sandbox
- https://vercel.com/docs/rest-api/sdk/sandboxes/update-network-policy
- https://vercel.com/docs/vercel-sandbox/concepts/firewall
- https://vercel.com/docs/vercel-sandbox/run-commands-in-sandbox

## POC Requirements

1. A user can start, inspect, stop, and relaunch a sandbox-hosted service as a product object, not just a shell process.
2. The system persists enough metadata to show service state after refresh and to relaunch after sandbox resume.
3. A user and the coding agent can see capped, redacted service logs.
4. The coding agent can run a browser proof against a known service URL and return structured evidence: URL, steps, screenshot artifact metadata, console errors, and network failures.
5. A user can see and change the session's outbound network policy at a coarse level.
6. The POC clearly distinguishes owner-gated Open Agents metadata from direct provider preview URLs, which may remain externally reachable unless routed through an authenticated proxy.
7. Lifecycle behavior is explicit: hibernation stops processes, resume can relaunch previously configured services, and stale processes are reconciled.

## Recommended POC Architecture

Add a `sandbox runtime` layer inside `apps/web` and keep `packages/sandbox` as the provider boundary.

```
Session
  -> sandbox runtime DB records
  -> sandbox runtime API routes
  -> @open-agents/sandbox provider
  -> Vercel Sandbox VM
  -> service process + exposed URL
  -> browser evidence runner
```

The POC source of truth should move from sandbox-local dotfiles and client-only state to Postgres records keyed by `sessionId`.

Sandbox-local PID files remain useful as runtime probes, but they should no longer be the only state. The DB record should describe the desired service, last known process, URL, policy, status, and relaunch behavior. The sandbox filesystem can still hold PID/log files because the process runs there.

## Data Model

Add these tables to `apps/web/lib/db/schema.ts` and generate a Drizzle migration.

### `sandbox_services`

One row per session service preview.

Fields:

- `id text primary key`
- `sessionId text not null references sessions(id) on delete cascade`
- `userId text not null references users(id) on delete cascade`
- `kind text enum`: `dev_server`, `code_editor`, `custom`
- `status text enum`: `stopped`, `starting`, `running`, `failed`, `stale`
- `packageDir text`
- `command text not null`
- `port integer not null`
- `url text`
- `pid text`
- `commandId text`
- `logPath text`
- `healthPath text`
- `lastHealthStatus integer`
- `lastStartedAt timestamp`
- `lastSeenAt timestamp`
- `lastStoppedAt timestamp`
- `relaunchOnResume boolean not null default true`
- `failureMessage text`
- `createdAt timestamp not null default now()`
- `updatedAt timestamp not null default now()`

Indexes:

- `(sessionId, kind)`
- `(sessionId, status)`
- unique `(sessionId, kind, port)` for the POC

### `sandbox_browser_runs`

One row per browser proof run.

Fields:

- `id text primary key`
- `sessionId text not null`
- `chatId text`
- `serviceId text references sandbox_services(id) on delete set null`
- `status text enum`: `queued`, `running`, `passed`, `failed`
- `targetUrl text not null`
- `summary text`
- `consoleErrors jsonb not null default []`
- `networkErrors jsonb not null default []`
- `steps jsonb not null default []`
- `artifactRefs jsonb not null default []`
- `redactionStatus text enum`: `pending`, `passed`, `failed`, `blocked`
- `startedAt timestamp`
- `finishedAt timestamp`
- `createdAt timestamp not null default now()`

For the POC, artifact refs can point to sandbox-local paths or future artifact-store IDs. Do not persist raw screenshot bytes in Postgres.

### `sandbox_network_policies`

One row per session.

Fields:

- `sessionId text primary key references sessions(id) on delete cascade`
- `mode text enum`: `allow_all`, `deny_all`, `custom`
- `allowedDomains jsonb not null default []`
- `allowedCIDRs jsonb not null default []`
- `deniedCIDRs jsonb not null default []`
- `injectionRules jsonb not null default []`
- `updatedBy text references users(id)`
- `createdAt timestamp not null default now()`
- `updatedAt timestamp not null default now()`

Default for POC: `allow_all`, matching existing behavior, but make it visible.

## Sandbox Package Changes

### `packages/sandbox/interface.ts`

Add provider-neutral optional methods:

```ts
export interface SandboxNetworkPolicyConfig {
  mode: "allow_all" | "deny_all" | "custom";
  allowedDomains?: string[];
  allowedCIDRs?: string[];
  deniedCIDRs?: string[];
  injectionRules?: unknown[];
}

export interface Sandbox {
  updatePorts?(ports: number[]): Promise<void>;
  updateNetworkPolicy?(policy: SandboxNetworkPolicyConfig): Promise<void>;
  getRoutes?(): Array<{ port: number; url: string }>;
}
```

Rationale:

- `domain(port)` is enough to resolve one URL, but first-class previews need route enumeration and dynamic port updates.
- A product network policy should not be encoded only as GitHub setup credential brokering.

### `packages/sandbox/vercel/sandbox.ts`

Add Vercel implementation:

- `updatePorts(ports)` calls the SDK method if available or uses a small provider helper around Vercel's update-sandbox API. Current docs indicate `PATCH /v2/sandboxes/{name}` can update `ports`.
- `getRoutes()` reads SDK routes and safely resolves `domain(port)` for each route.
- `updateNetworkPolicy(policy)` maps Open Agents modes to Vercel's current policy shape:
  - `allow_all` -> provider allow-all policy
  - `deny_all` -> provider deny-all policy
  - `custom` -> provider custom allow/deny fields
- Preserve current GitHub credential brokering by composing temporary injection rules with the session policy during clone/setup, then restoring the session policy after setup.

Risk:

- The installed dependency is `@vercel/sandbox@2.0.0-beta.11`. Current docs may describe APIs not exposed by this exact beta. The POC should feature-detect SDK methods and fail with an explicit capability error instead of pretending dynamic ports/network policy are always available.

## Runtime API Changes

Create a focused runtime API namespace instead of growing the current dev-server route.

### `apps/web/lib/sandbox/runtime/*`

New modules:

- `service-records.ts`: CRUD for `sandbox_services`
- `service-launch.ts`: command building, dependency install decision, PID/log file paths, health checks
- `service-logs.ts`: log tailing, output caps, redaction
- `service-discovery.ts`: extracted package/script discovery from the current dev-server route
- `network-policy.ts`: DB policy loading, validation, provider mapping
- `browser-runner.ts`: execute `agent-browser` in the sandbox, collect structured results

The current `apps/web/app/api/sessions/[sessionId]/dev-server/route.ts` contains useful logic but is too large and stateful. Extract it rather than extending it in place.

### Service routes

Add:

- `GET /api/sessions/[sessionId]/sandbox-services`
  - Lists service records, reconciles running/stale status with sandbox probes when sandbox is active.
- `POST /api/sessions/[sessionId]/sandbox-services`
  - Starts a detected or explicit service.
  - Request supports `{ kind, packageDir?, command?, port?, relaunchOnResume? }`.
  - If port is not in the current exposed-port set, call `sandbox.updatePorts([...existing, port])` when available.
- `GET /api/sessions/[sessionId]/sandbox-services/[serviceId]`
  - Returns current service metadata plus health status.
- `POST /api/sessions/[sessionId]/sandbox-services/[serviceId]/restart`
  - Stops, launches, updates metadata.
- `DELETE /api/sessions/[sessionId]/sandbox-services/[serviceId]`
  - Stops process and marks row stopped.
- `GET /api/sessions/[sessionId]/sandbox-services/[serviceId]/logs?cursor=...`
  - Returns capped, redacted log chunks from a sandbox-local log file.

Keep the existing dev-server route temporarily as a compatibility wrapper:

- `POST /dev-server` delegates to "start or open dev_server".
- `DELETE /dev-server` delegates to "stop dev_server".
- The hook can migrate later without a breaking UI change.

### Browser routes

Add:

- `POST /api/sessions/[sessionId]/browser-runs`
  - Starts a browser proof against `{ serviceId? targetUrl? instructions? viewport? }`.
  - For POC, run synchronously with a short timeout or asynchronously with status polling if the first route gets too slow.
- `GET /api/sessions/[sessionId]/browser-runs/[runId]`
  - Returns metadata, status, redacted console/network summaries, and artifact refs.
- `GET /api/sessions/[sessionId]/browser-runs/[runId]/artifacts/[artifactId]`
  - Only serves artifact content if redaction passed and the user owns the session.

Browser runner command shape:

```bash
agent-browser --session "open-agents-${sessionId}-${runId}" open "$targetUrl"
agent-browser --session "open-agents-${sessionId}-${runId}" snapshot -i --json
agent-browser --session "open-agents-${sessionId}-${runId}" console/errors-or-equivalent
agent-browser --session "open-agents-${sessionId}-${runId}" network requests --json
agent-browser --session "open-agents-${sessionId}-${runId}" screenshot "/tmp/open-agents-browser-${runId}.png"
```

The exact command set should match the installed `agent-browser` version. The local skill documents snapshots, interaction, screenshot, network requests, viewport/device, and JS evaluation support.

### Network policy routes

Add:

- `GET /api/sessions/[sessionId]/sandbox-network-policy`
  - Returns the DB policy and provider capability flags.
- `PATCH /api/sessions/[sessionId]/sandbox-network-policy`
  - Validates domains/CIDRs, persists the policy, and applies it to the active sandbox if present.
  - If the sandbox is hibernated, persist only and apply on restore/connect.

Validation rules:

- Domains must be host patterns, not full URLs.
- Do not accept credentials in URLs.
- CIDRs must parse as IPv4/IPv6 CIDRs.
- Injection rules are admin-only or disabled in the POC unless there is a concrete product need.

## Agent Tool Changes

Add typed tools instead of asking the model to remember shell incantations.

### `packages/agent/tools/preview.ts`

Tools:

- `preview_start`
  - Input: `{ kind?: "dev_server" | "custom"; packageDir?: string; command?: string; port?: number }`
  - Output: service id, status, URL, port.
- `preview_status`
  - Input: `{ serviceId?: string }`
  - Output: service status, health, URL, recent logs summary.
- `preview_logs`
  - Input: `{ serviceId: string; lines?: number }`
  - Output: redacted log tail.
- `preview_stop`
  - Input: `{ serviceId: string }`

### `packages/agent/tools/browser.ts`

Tools:

- `browser_check`
  - Input: `{ serviceId?: string; url?: string; goal?: string; viewport?: "desktop" | "mobile" }`
  - Output: status, screenshot artifact ref, console errors, network errors, observations.
- `browser_interact` can be deferred until after the POC unless a real task requires multi-step interaction.

Implementation options:

1. Tool calls internal Open Agents API routes with session context.
2. Tool runs `agent-browser` through the sandbox directly.

Recommended POC choice: use internal runtime helpers from the web app for product routes, and expose only high-level agent tools. This keeps browser artifacts, redaction, and ownership checks in one place.

## UI Changes

### Session header

Replace the single dev-server local hook state with service records from `GET /sandbox-services`.

Display:

- Primary service status: stopped, starting, running, failed, stale.
- Open button for running service.
- Logs button.
- Browser check button.
- Restart/stop menu.

### Right panel

Add a `Runtime` panel next to Git and Verified Build.

Sections:

- Services: list all service records, port, URL, status, start/restart/stop.
- Logs: redacted stream/tail for selected service.
- Browser checks: latest run summary, screenshot thumbnail, console/network issues.
- Network: current policy mode and allowlist summary.

### Codespace

For code-server:

- Stop launching with `--auth none` as a permanent posture.
- POC option: generate a per-session random password, store only a secret reference or encrypted server-only value, and launch code-server with password auth.
- At minimum, label the raw provider URL as direct sandbox URL and do not imply the iframe itself makes the backend private.

## Security Design

### URL access reality

Vercel sandbox `domain(port)` returns a provider URL for the exposed port. Open Agents can owner-gate metadata and UI actions, but it cannot automatically owner-gate a direct provider URL unless one of these is added:

1. A reverse proxy through Open Agents that authenticates every request and forwards to the sandbox URL.
2. A sidecar/auth wrapper inside the sandbox that protects the service.
3. App-specific middleware injected into the user's dev server.

POC recommendation:

- Do not build a full reverse proxy first. It is hard to support WebSockets, HMR, streaming, large assets, cookies, redirects, and same-origin assumptions correctly.
- Keep direct sandbox URLs for POC previews.
- Make the UI and docs explicit: "Anyone with this provider URL may be able to access the running preview until the sandbox stops."
- For code-server, add real auth before calling it secure.
- For future production, design an authenticated preview proxy as its own project.

### Log and artifact redaction

Apply redaction before persisting or returning:

- Authorization headers and bearer/basic tokens.
- Token-shaped strings.
- `.env` values and known secret env var names.
- URLs with credentials or sensitive query params.
- Long stdout/stderr chunks.
- Screenshot metadata paths if they reveal absolute host paths.

Use size caps:

- Log response: default 200 lines or 64 KB.
- Stored browser summary: small JSON only.
- Screenshot artifacts: file/blob storage, not DB.

### Network policy

For POC:

- Default visible mode remains `allow_all` to preserve current behavior.
- `deny_all` should be allowed only after dependency install/setup is done, or it will break installs and browser checks.
- `custom` policy should include package registries and provider APIs needed for normal agent work if the user wants the agent to continue operating.

Recommended presets:

- `Open development`: allow all, current behavior.
- `Package install only`: allow GitHub, npm registry, package manager CDNs, Vercel APIs.
- `Locked proof`: deny all or custom allow only the preview target and internal loopback after dependencies are installed.

## Lifecycle And Resume

Service rows survive sandbox hibernation. Processes do not.

Lifecycle behavior:

- On hibernation: mark running services `stale` or `stopped` with `lastSeenAt`.
- On restore: if `relaunchOnResume` is true, relaunch services after sandbox connection succeeds.
- On status polling: reconcile service status using PID and health probes only when sandbox is active.
- On dev-server launch during `restoring`/`hibernated`: return 409 with "Resume the sandbox before running a service", matching current dev-server behavior.

Hook points:

- After sandbox create/restore in `apps/web/app/api/sandbox/route.ts` and `apps/web/app/api/sandbox/snapshot/route.ts`, call a runtime relaunch helper.
- During lifecycle hibernation in `apps/web/lib/sandbox/lifecycle.ts`, update service rows before/after `sandbox.stop()`.
- Do not refresh `lastActivityAt` from passive service status polling. Starting/restarting/stopping a service should count as activity.

## Implementation Phases

### Phase 1: Service registry and logs

Goal: make existing dev-server behavior first-class without changing browser automation yet.

Changes:

- Add `sandbox_services` table and migration.
- Extract dev-server logic into `apps/web/lib/sandbox/runtime/service-*`.
- Add service API routes.
- Redirect existing dev-server route through the new service runtime.
- Launch commands with stdout/stderr redirected to a log file:

```bash
exec <command> > "$LOG_PATH" 2>&1
```

- Add log tail endpoint with redaction and caps.
- Update tests currently covering dev-server route to cover service records, relaunch, stale detection, and logs.

Verification:

- `bun test 'apps/web/app/api/sessions/[sessionId]/dev-server/route.test.ts'`
- New service route tests.
- Manual: create sandbox, start dev server, refresh page, see running service, open URL, view logs, stop service.

### Phase 2: Browser proof runs

Goal: run one deterministic browser smoke and persist evidence metadata.

Changes:

- Add `sandbox_browser_runs` table and migration.
- Add browser-run API route and runtime helper.
- Add a header or runtime-panel action: "Run browser check".
- Add optional agent tool `browser_check`.
- Save screenshot artifact to a sandbox path first; later move to artifact storage.

Minimum browser check:

1. Open service URL.
2. Wait for load/network idle.
3. Capture interactive snapshot.
4. Capture screenshot.
5. Collect console/network error summaries.
6. Mark failed if page cannot load or has severe console/network errors.

Verification:

- Unit test browser-run command construction and redaction.
- Manual with `agent-browser` available in sandbox snapshot.
- Confirm screenshot path is not exposed without ownership guard.

### Phase 3: Network policy UI and provider application

Goal: make current broad egress visible and allow coarse controls.

Changes:

- Add `sandbox_network_policies` table and migration.
- Add sandbox interface method `updateNetworkPolicy`.
- Add Vercel implementation with feature detection.
- Add GET/PATCH network policy routes.
- Apply policy on sandbox create, reconnect, and restore.
- Add Runtime panel controls.

Verification:

- Unit test policy validation.
- Unit test Vercel mapping and GitHub temporary credential composition.
- Manual: switch to custom policy, confirm `curl` to denied domain fails and allowed domain succeeds.

### Phase 4: Runtime panel and agent tools

Goal: expose everything coherently in UI and to the coding agent.

Changes:

- Add Runtime panel to chat UI.
- Replace local dev-server hook with SWR-backed service state.
- Add tools in `packages/agent/tools/preview.ts` and `packages/agent/tools/browser.ts`.
- Update system prompt so the agent uses typed tools for previews and browser proof rather than raw shell when available.

Verification:

- Route/component tests for service list, logs, browser run display, and network policy display.
- End-to-end browser smoke through Agent Browser:
  - create/resume sandbox
  - start service
  - open preview
  - run browser check
  - view screenshot metadata/logs
  - stop service

## Open Questions

1. Should the POC include dynamic port updates immediately, or should it stay within the currently exposed four ports for first delivery?
2. Should code-server be secured in this same POC, or split into a follow-up focused only on editor access?
3. Where should browser screenshots live initially: sandbox filesystem, Vercel Blob, existing artifact route, or harness artifact storage?
4. Does the hosted product need authenticated preview proxying before shipping, or is an explicit "direct sandbox URL" warning acceptable for internal POC use?
5. Should network policy presets be user-facing for everyone, or initially admin/developer-only?

## Recommended First POC Cut

Implement Phases 1 and 2 only:

- Persist services.
- Preserve existing dev-server behavior through compatibility routes.
- Add redacted logs.
- Add one browser proof run for a running service.
- Keep fixed ports.
- Keep network policy read-only in the document/UI as "currently allow all".

This proves the product shape and agent workflow without taking on the hard security/proxying and provider dynamic-port risks too early. Phase 3 should follow once the team confirms the installed `@vercel/sandbox` beta exposes the required update APIs or agrees to use the Vercel REST SDK directly.

