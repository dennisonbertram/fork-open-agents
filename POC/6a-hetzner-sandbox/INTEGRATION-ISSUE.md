<!-- TITLE: feat: Hetzner self-hosted sandbox provider — selectable runtime infrastructure option -->

## Why this matters

Today every open-agents session runs on a single sandbox substrate: Vercel
Sandbox. That is an excellent managed default, but it is also a hard dependency
— one vendor, one pricing model, one data-residency story, and no
bring-your-own-infrastructure escape hatch. POC 6a (PR #112) proved that a
self-hosted, Hetzner-VM-backed provider can satisfy the *exact* same `Sandbox`
contract (`packages/sandbox/interface.ts`) — shell exec, detached processes,
port→public-URL exposure, snapshot/restore, lifecycle/timeout — with the genuinely
novel pieces (wildcard port→URL routing and snapshot/restore round-trips) shown
working end-to-end.

Productizing it as a **selectable sandbox provider option** unlocks three things
the current single-provider design cannot:

- **Cost.** Per `RESEARCH.md` §6, a Hetzner Cloud per-VM session (Arch A) is
  **~40× cheaper** per session-hour than Vercel Sandbox Pro (~$0.011 vs ~$0.43
  for a 4 vCPU / 50%-CPU hour), and the recommended dense-Firecracker scale path
  (Arch B) is **~300× cheaper** at 50% host utilization. For teams running many
  long-lived or background-agent sessions, infra cost is a first-order concern.
- **Control & data residency.** "Your code runs on infrastructure you control"
  is a real requirement for security-sensitive and regulated users. Hetzner
  regions (fsn1/nbg1/hel1 in the EU, ash in the US) let an operator pin where
  session data and source code physically execute.
- **Lock-in reduction.** A clean provider abstraction means the platform is no
  longer welded to one vendor's sandbox API. Vercel stays the managed default;
  Hetzner becomes a documented, supported, self-hosted alternative.

**Who benefits:** cost-sensitive operators and teams; security/compliance users
who need EU/US data residency; self-hosters who want BYO-infra; and the platform
itself, which gains a provider-abstraction seam that future substrates can plug
into.

## User/operator path protected

The **Vercel Sandbox path is and remains the default**, and must not regress in
any way. Concretely, these existing user/operator paths are protected and must
behave exactly as they do today when no Hetzner provider is configured:

- **Session create.** A new session with default/no provider configuration
  provisions a Vercel sandbox via `connectVercel` exactly as today
  (`packages/sandbox/factory.ts` → `connectSandbox`).
- **Exec.** `sandbox.exec(...)` shell command execution (cwd handling, 50_000-char
  truncation, timeout-without-throw semantics) is unchanged for Vercel.
- **Preview / port URL.** Dev-server preview URLs via `domain(port)` for the
  standard `DEFAULT_SANDBOX_PORTS` (`[3000, 5173, 4321, 8000]`,
  `apps/web/lib/sandbox/config.ts`) continue to resolve for Vercel sessions.
- **Hibernate / resume lifecycle.** The sandbox lifecycle machine in
  `apps/web/lib/sandbox/lifecycle.ts` (`provisioning → active → hibernating →
  hibernated → restoring → active`) and the `type !== "vercel"` guard at
  `lifecycle.ts:187` continue to operate correctly for Vercel sessions. The guard
  is *generalized*, not removed — Vercel must still be treated as a fully-supported
  lifecycle provider.
- **Persistence.** `sessions.sandboxState` JSONB and the lifecycle columns
  (`lifecycleState`, `lifecycleVersion`, `sandboxExpiresAt`, `hibernateAfter`,
  `lifecycleError`) in `apps/web/lib/db/schema.ts` keep their current meaning for
  Vercel sessions; the Hetzner work adds to the union, it does not reshape Vercel
  state.

The single most important regression to lock down: **a session with no provider
config still provisions on Vercel and behaves identically to today.**

## Behavior contract

- **Given** no provider configuration for the user/org, **When** a new session is
  created, **Then** it provisions on Vercel Sandbox via `connectVercel` and every
  exec/preview-URL/hibernate path behaves exactly as it does today (default-path
  no-regression).
- **Given** a user has selected and configured the Hetzner provider (valid
  encrypted `HCLOUD_TOKEN` or a reachable control-plane endpoint, region, server
  type), **When** a new session is created, **Then** it provisions a Hetzner VM,
  and `exec`, `domain(port)` preview URLs (via the Caddy wildcard), and
  hibernate/resume all work against that VM.
- **Given** a configured Hetzner provider, **When** a sandbox's `getState()` is
  called, **Then** it returns `{ type: "hetzner", sandboxName, expiresAt, ... }`
  — the shape `canOperateOnSandbox` / `getPersistentSandboxName`
  (`apps/web/lib/sandbox/utils.ts`) require (both `sandboxName` and `expiresAt`
  present).
- **Given** a Hetzner-backed session, **When** lifecycle evaluation runs
  (`evaluateSandboxLifecycle`), **Then** the generalized guard at
  `lifecycle.ts:187` recognizes `"hetzner"` as a supported type and hibernate →
  resume restores the session (snapshot taken on hibernate, restored on resume,
  filesystem bytes preserved — hash-match).
- **Given** Hetzner is misconfigured or unreachable (invalid token, quota
  exceeded, SSH unreachable, provisioning timeout), **When** a session is created,
  **Then** session creation fails gracefully with a clear, typed, actionable
  error surfaced in the UI, **and never silently breaks** — it does not corrupt
  session state and does not fall through to a half-provisioned sandbox.
- **Given** a Hetzner sandbox exposes a dev-server port, **When** `domain(port)`
  is called, **Then** it returns a stable wildcard subdomain URL
  (`<sandbox>-<port>.sandbox.<domain>`) that routes through Caddy to the correct
  VM/port, and the route is removed on `stop()`/`snapshot()`.
- **Given** the Hetzner feature flag is OFF, **When** any session is created,
  **Then** the Hetzner option is not selectable and Vercel is used — Hetzner is
  inert until explicitly enabled.
- **Given** a long-running Hetzner provision (Hetzner is slower than Vercel —
  15–30 s SSH-ready per `RESEARCH.md`), **When** the user is waiting, **Then** the
  UI shows provisioning progress and the session does not appear failed while the
  VM is still booting.

## Product and design spec

The capability: an operator can choose **which infrastructure their session
sandboxes run on** — the managed Vercel default, or self-hosted Hetzner —
configure it once with encrypted credentials, verify it with a connection test,
and then see, per session, exactly which provider/region a sandbox is running on
and what lifecycle state it is in. UX is a priority for this ticket: provider
selection must be **visible, trustworthy, and explanatory**, because the user is
making an infrastructure decision with cost, data-residency, and isolation
trade-offs.

### UX — how users use it & how it's exposed

- **Where selection lives.** A new "Sandbox infrastructure / Runtime provider"
  setting in **Settings**, scoped per-user (and structured to extend to per-org
  later). It supports an optional **per-repository** and **per-session override**
  so a user can keep most sessions on the default while routing a specific repo or
  session to Hetzner.
- **Provider picker.** A radio/card selector with two options:
  - **"Vercel Sandbox (managed — default)"** — selected by default, no config
    required.
  - **"Hetzner (self-hosted)"** — gated behind the feature flag; selecting it
    reveals the Hetzner config form.
- **Hetzner config form.**
  - **Credential:** an encrypted `HCLOUD_TOKEN` field (write-only; shows only
    last-4 once saved, mirroring the inference-profile API-key UX), **or** a
    configured control-plane endpoint URL for operators running their own Hetzner
    control plane.
  - **Region:** `fsn1` (Falkenstein, DE), `nbg1` (Nuremberg, DE), `hel1`
    (Helsinki, FI), `ash` (Ashburn, US) — for data-residency choice.
  - **Server type:** e.g. `cx33` (x86) / `cax11` (ARM) etc., with sane defaults.
  - **Wildcard preview domain:** the `*.sandbox.<domain>` the operator has pointed
    at their Caddy proxy (production replacement for the POC's `lvh.me`).
  - **"Test connection" button** — runs a non-destructive hcloud reachability +
    auth check (and proxy/DNS check when a domain is configured) and reports
    success/failure inline.
- **Turning it on / default.** Default for every user is Vercel; the user must
  explicitly select Hetzner *and* complete + pass the connection test before any
  session is allowed to provision on it. If selected-but-unverified, the picker
  shows a "configuration required" state and sessions stay on Vercel.

### UX — how the feature demonstrates & explains its value to the user

- **Cost comparison.** Next to each provider, show an at-a-glance cost estimate
  per session-hour sourced from `RESEARCH.md` §6 (e.g. "~$0.43/hr managed" vs
  "~$0.011/hr self-hosted, ~40× cheaper"), with a clear "estimate" disclaimer.
- **Control / residency framing.** For Hetzner, surface "Your code runs on
  infrastructure you control" plus the selected region's location
  (e.g. "Falkenstein, Germany — EU data residency").
- **First-run / onboarding.** When a user first opens the provider setting, show a
  short explainer of the trade-off (managed convenience + sub-second resume vs
  self-hosted cost/control with longer provisioning), and what they need (an
  hcloud token + a wildcard domain) to enable Hetzner.
- **Connection-test success state.** A clear green "Connection verified — region
  fsn1 reachable, proxy domain resolves" confirmation that proves it works before
  the user commits real sessions to it.

### UX — how it's clear what the feature is doing (states & feedback)

- **Per-session indicators.** A **provider badge** ("Vercel" / "Hetzner") + region
  label + lifecycle status (`provisioning` / `active` / `hibernating` /
  `restoring`) shown on the session, plus the live preview port URL when exposed.
- **Provider-config states.** `unconfigured` (no token/endpoint),
  `configured` (saved but untested), `verified` (test passed),
  `connection-failed` (test failed, with the actionable typed error inline).
- **Provisioning progress.** Because Hetzner provisioning is slower than Vercel
  (15–30 s SSH-ready per `RESEARCH.md`), the session shows an explicit
  "Provisioning Hetzner VM…" progress state with a sense of expected duration,
  rather than appearing hung or failed.
- **Failure & not-ready states.** If a sandbox fails to provision, the session
  shows the typed error kind and a retry/edit-config action. If a port route is
  not yet live (Caddy route still registering), the preview URL shows a
  "preparing route…" state instead of a broken link.

### UX — how to test the UX, including regressions

Tested via the repo's **authenticated-local-UI-smoke** discipline
(`docs/process/development-workflow.md#authenticated-local-ui-smoke`), each test
naming its assertion:

1. **NO-REGRESSION (the key one, fail-before/pass-after).** With default/no
   provider config, create a session → it provisions on **Vercel**, exec runs, a
   `DEFAULT_SANDBOX_PORTS` preview URL loads, and hibernate→resume works — *exactly
   as today*. Asserts: provider resolves to Vercel; no Hetzner code path executes;
   session badge reads "Vercel".
2. **Provider selection + config + Test-connection happy path.** In Settings,
   select Hetzner, enter a (mock/staging) token + region + domain, click "Test
   connection" → success state shown; token persists as last-4 only. Asserts:
   config saved encrypted; verified state rendered.
3. **Hetzner session lifecycle.** Create a session with Hetzner selected → badge
   shows "Hetzner" + correct region + `provisioning`→`active`; exec works; the
   wildcard preview URL loads; hibernate → `hibernating`/`hibernated` → resume →
   `restoring`→`active` restores state. Asserts: badge/region/status correct;
   preview URL serves sandbox content; resume preserves filesystem.
4. **Misconfig surfaces a clear error.** Configure an invalid token → "Test
   connection" fails with `token_invalid`; attempting a session shows the typed
   error and does **not** break session creation (no orphaned/half-provisioned
   state). Asserts: actionable error rendered; session model not corrupted.

## Integration spec

The provider plugs into the existing, verified seams. The POC's
`integration/factory.patch.ts`, `integration/lifecycle.patch.ts`, and
`integration/hetzner-state.ts` are type-checked against the real types and define
the exact edits.

1. **Provider union + dispatch (`packages/sandbox/factory.ts`).** Generalize the
   currently vercel-only `SandboxState`:

   ```ts
   // BEFORE (factory.ts:13)
   export type SandboxState = { type: "vercel" } & VercelState;

   // AFTER
   export type SandboxState =
     | ({ type: "vercel" } & VercelState)
     | ({ type: "hetzner" } & HetznerState);
   ```

   Add a `connectHetzner(state, options)` branch in `connectSandbox` alongside the
   existing `connectVercel` dispatch (the POC's `src/connect.ts` is the working
   shape; keep the exhaustiveness `never` guard so future providers force a
   branch). `SandboxConnectConfig.state` is widened the same way.

2. **Move the POC provider into the package.** Relocate the POC's
   `HetznerSandbox` / `VmDriver` / `HcloudDriver` / `HcloudClient` /
   `CaddyRegistrar` into `packages/sandbox/hetzner/*`
   (`sandbox.ts`, `driver.ts`, `drivers/hcloud-driver.ts`, `drivers/hcloud-client.ts`,
   `proxy/registrar.ts`, `proxy/caddy-container.ts`, `connect.ts`, `state.ts`), and
   delete the POC's byte-copied `interface.ts` in favor of importing the real
   `packages/sandbox/interface.ts`. The compile-time conformance proof
   (`src/conformance.ts`) becomes a package test.

3. **Lifecycle guard generalization (`apps/web/lib/sandbox/lifecycle.ts:187`).**
   Replace the hard-coded `if (sandboxState.type !== "vercel")` skip with an
   allow-list provider check (`isLifecycleSupported(type)` from
   `integration/lifecycle.patch.ts`, supporting `"vercel" | "hetzner"`). No other
   lifecycle change is needed: `getState()` already returns `sandboxName` +
   `expiresAt`, which `canOperateOnSandbox` (`apps/web/lib/sandbox/utils.ts`)
   consumes unchanged.

4. **`getState()` shape.** Hetzner's `getState()` returns
   `{ type: "hetzner", sandboxName, machineId?, snapshotId?, lifecycle?,
   workingDirectory?, expiresAt }` per `integration/hetzner-state.ts` — required
   `sandboxName` + `expiresAt` for `canOperateOnSandbox` /
   `getPersistentSandboxName` / `getSandboxExpiresAt`.

5. **Provider-selection persistence + encrypted credential storage
   (`apps/web/lib/db/schema.ts`).** Add a provider-config table (e.g.
   `sandboxProviderProfiles`) modeled on `inferenceProfiles`: an
   `encryptedHcloudToken` column encrypted with the existing
   `aes-256-gcm` helper pattern in `apps/web/lib/inference/encryption.ts`
   (`encryptInferenceSecret`/`decryptInferenceSecret`, version-prefixed, keyed by
   `ENCRYPTION_KEY`/`BETTER_AUTH_SECRET`), plus `tokenLast4` + `tokenFingerprint`,
   `region`, `serverType`, `previewDomain`, `status`
   (`untested|verified|failed`), and the user/repo/session scoping for provider
   selection. Wire selection into session creation so it sets
   `sessions.sandboxState.type`.

6. **Hetzner control-plane (provisioning + Caddy wildcard DNS/TLS).** Provisioning
   via `HcloudDriver` (create server + cloud-init + poll-until-ready + SSH exec +
   `create_image` snapshot + delete-on-stop). Public preview URLs via a Caddy
   reverse proxy programmed through its admin API (`CaddyRegistrar`), production
   using `*.sandbox.<domain>` (A/AAAA → proxy IP) with Caddy DNS-01 wildcard TLS
   (one cert covers all sandboxes — no per-sandbox issuance). Register the
   `DEFAULT_SANDBOX_PORTS` on `afterStart` so `domain(port)` is live.

**Architecture sequencing (per `RESEARCH.md`).** Start with **Arch A — the
`HcloudDriver` (one Hetzner Cloud VM per sandbox)**: simple, API-driven,
immediately runnable with a token. Treat **Arch B — Firecracker microVMs on a
Hetzner *dedicated* box** (the `RESEARCH.md`-recommended scale path, the only
self-hosted path with sub-second resume parity and ~300× cost at scale) as a
**follow-up**, because it requires a Linux/KVM host (Hetzner Cloud VMs do **not**
expose nested KVM per `RESEARCH.md` §1A).

## In scope

- Generalize the sandbox provider abstraction: `SandboxState` union +
  `connectHetzner` dispatch + exhaustiveness guard in `packages/sandbox/factory.ts`.
- The **HcloudDriver-backed (Arch A) Hetzner provider behind a feature flag**
  (Hetzner OFF by default), moved into `packages/sandbox/hetzner/*` with the real
  interface and a conformance test.
- **Provider selection UX**: Settings provider picker, Hetzner config form,
  "Test connection", per-session/per-repo override, provider badge + region +
  lifecycle status, cost/residency explainers.
- **Encrypted provider config**: `encryptedHcloudToken` + last4/fingerprint +
  region/serverType/previewDomain persistence, modeled on `inferenceProfiles`.
- **Lifecycle generalization**: widen `lifecycle.ts:187` guard to an allow-list so
  Hetzner sessions hibernate/resume.
- **Port-URL exposure via Caddy wildcard**: `domain(port)` →
  `<sandbox>-<port>.sandbox.<domain>` routing, DNS-01 wildcard TLS, route
  add-on-expose / remove-on-stop.

## Out of scope

- **Firecracker-on-dedicated control plane (Arch B)** — vsock guest agent, jailer,
  TAP/DNAT networking, memory snapshots — a follow-up requiring a KVM host.
- Multi-region VM pools / autoscaling / warm-pool prewarming.
- Per-org billing, metering, and cost chargeback.
- Migrating existing in-flight Vercel sessions to Hetzner (provider is chosen at
  session creation; no live migration).
- Per-VM egress filtering / network policy parity with Vercel (tracked separately;
  noted as a remaining isolation gap until Firecracker lands).

## Research and context sources

- **PR #112** — "POC 6a: Self-hosted Hetzner VM sandbox provider [research +
  working eval]" (branch `poc/6a-hetzner-sandbox`):
  https://github.com/dennisonbertram/fork-open-agents/pull/112
- **POC folder `POC/6a-hetzner-sandbox/`** — `README.md`, `RESEARCH.md`,
  `evidence/` (eval + hcloud-mock logs, JUnit, measurements, Caddy curl proof),
  and `integration/` patches (`factory.patch.ts`, `lifecycle.patch.ts`,
  `hetzner-state.ts`).
- **`RESEARCH.md` findings cited:**
  - Hetzner Cloud VMs do **not** support nested KVM (§1A) — Firecracker/QEMU
    cannot run inside a Cloud VM, so Arch B needs a dedicated/KVM host.
  - **Firecracker-on-dedicated (Arch B) is the recommended production scale-out**
    — sub-second (3–28 ms) memory-snapshot restore, ~125 ms cold boot — the only
    self-hosted path with Vercel-parity resume latency.
  - **Cost comparison (§6):** Vercel ~$0.43/session-hr; Hetzner per-VM (Arch A)
    ~$0.011 (~40×); Hetzner Firecracker (Arch B) ~$0.0014 at 50% util (~300×).
  - **Caddy wildcard exposure:** `*.sandbox.<domain>` reverse proxy with DNS-01
    wildcard TLS (one cert for all sandboxes); proven in the POC via a real Caddy
    container and a raw-curl proof (`Via: 1.0 Caddy`).

## Agent todo checklist

- [ ] Read `RESEARCH.md`, `README.md`, and the `integration/` patches; confirm
      the live seams (factory union, `lifecycle.ts:187`, `utils.ts`,
      `config.ts`, `schema.ts`) match the citations.
- [ ] Write the failing **provider-conformance** test (Vercel + Hetzner both
      satisfy the real `Sandbox` interface) and the **Vercel default-path
      no-regression** test; confirm red.
- [ ] Generalize `SandboxState` union + `connectHetzner` dispatch +
      exhaustiveness guard in `packages/sandbox/factory.ts`.
- [ ] Move POC provider into `packages/sandbox/hetzner/*` against the real
      interface; port the conformance proof into a package test.
- [ ] Add `HcloudDriver` + `HcloudClient` mock-API test suite (create payload,
      cloud-init, poll loop, snapshot, delete).
- [ ] Generalize the `lifecycle.ts:187` guard to `isLifecycleSupported`;
      add lifecycle generalization test.
- [ ] Add `sandboxProviderProfiles` schema (encrypted `HCLOUD_TOKEN` modeled on
      `inferenceProfiles`) + generate Drizzle migration; wire provider selection
      into session creation.
- [ ] Build provider-selection UX: Settings picker, Hetzner config form,
      "Test connection", per-session/repo override, badge/region/status,
      cost/residency explainers.
- [ ] Implement Caddy wildcard registrar + `domain(port)` exposure; DNS-01
      wildcard TLS in the control-plane deploy.
- [ ] Add the named `hetzner-sandbox` structured-observability events + typed
      error kinds + redaction.
- [ ] Run the authenticated-local-UI-smoke UX tests (incl. the no-regression
      smoke); capture observability evidence.
- [ ] Behind the flag, run a live Hetzner **staging** provision to satisfy the
      Managed Runtime Proof Standard before enabling the flag.
- [ ] `git diff --check` clean; `bun --bun run ci` passes; commit red→green;
      open PR.

## Tests to add first

Behavior-first FAILING tests (red before implementation):

1. **Provider-abstraction conformance suite** — assert that **both** the Vercel
   provider and the Hetzner provider satisfy the real
   `packages/sandbox/interface.ts` `Sandbox` interface (compile-time
   `satisfies`/assignability proof, ported from the POC's `src/conformance.ts`,
   plus runtime assertions on the public methods).
2. **Vercel default-path no-regression test** — with no provider config,
   `connectSandbox` resolves to `connectVercel`, and exec/`domain(port)`/lifecycle
   behave exactly as today. This is the key regression lock; it must be red before
   the union/guard generalization and green after.
3. **HcloudDriver mock-API tests** — against a faithful mock hcloud HTTP server:
   exact `POST /servers` payload (server_type/image/location/ssh_keys/labels),
   cloud-init contents, poll-until-running loop, `create_image` snapshot + action
   poll, and `DELETE /servers/:id` on stop.
4. **Lifecycle generalization test** — `isLifecycleSupported("hetzner")` is true,
   `"vercel"` stays supported, an unknown type is skipped with
   `unsupported-sandbox-type`; a Hetzner `getState()` with `sandboxName` +
   `expiresAt` passes `canOperateOnSandbox`.
5. **UX smoke for provider selection** — authenticated-local-UI-smoke: select
   Hetzner, save config, "Test connection" success, session badge reflects the
   provider/region.

## Observability and user feedback

**User-visible status (required):** per-session **provider badge** (Vercel/Hetzner)
+ region + lifecycle status (`provisioning`/`active`/`hibernating`/`restoring`),
provider-config state (`unconfigured`/`configured`/`verified`/`connection-failed`),
and the live preview port URL.

**Named service: `hetzner-sandbox`** emitting STRUCTURED events (each with a
`level` and structured `fields`), action-named:

- `provision.requested` (info) — fields: region, serverType, sandboxName.
- `provision.ready` (info) — fields: hcloudServerId, durationMs.
- `provision.failed` (error) — fields: errorKind, hcloudServerId?, durationMs.
- `exec` (debug) — fields: commandId?, exitCode, truncated, durationMs.
- `port.exposed` (info) — fields: port, url.
- `snapshot.created` (info) — fields: snapshotId, sizeBytes?, durationMs.
- `hibernate` (info) — fields: snapshotId, lifecycle.
- `restore` (info) — fields: snapshotId, durationMs, lifecycle.

**Typed error kinds:** `provision_timeout`, `ssh_unreachable`, `quota_exceeded`,
`proxy_route_failed`, `token_invalid` (each maps to a user-facing actionable
message in the config/session UI).

**Correlation IDs on every event:** `userId`, `sessionId`, `sandboxName`,
`hcloudServerId`, `region`, `requestId`.

**Redaction rules (hard requirement):** NEVER log `HCLOUD_TOKEN` or SSH private
keys (or any decrypted secret). Tokens appear only as last-4 in any
log/UI; the encryption helper output is never logged.

**Grep-able debug recipes:** filter the structured stream by
`service=hetzner-sandbox action=provision.failed` to find provisioning failures;
`service=hetzner-sandbox sessionId=<id>` to trace a single session's full
lifecycle; `errorKind=token_invalid` to find misconfigured providers.

**Screenshot / evidence expectation:** capture the authenticated-UI-smoke
screenshots (provider picker, verified connection state, session provider badge),
and cite the POC evidence as the runtime proof basis — the eval logs
(`evidence/eval-test.log`, 6/6), the hcloud mock logs (`evidence/hcloud-mock-test.log`,
5/5), the **Caddy wildcard curl proof** (`evidence/caddy-wildcard-curl-proof.txt`,
`Via: 1.0 Caddy`), and the snapshot **hash-match** round-trip — plus, before the
flag is enabled, a live Hetzner staging provision log per the Managed Runtime
Proof Standard.

## Regression harness plan

**New tests/smokes (named):**

- **Provider-conformance suite** — both Vercel + Hetzner satisfy the real
  `Sandbox` interface (compile-time + runtime).
- **Vercel default-path no-regression** — no provider config → Vercel, behavior
  identical to today (the critical lock).
- **HcloudDriver mock suite** — create/cloud-init/poll/snapshot/delete against a
  mock hcloud HTTP server.
- **Lifecycle generalization** — guard allow-list + `canOperateOnSandbox` with a
  Hetzner `getState()`.
- **Provider-selection UX smoke** — authenticated-local-UI-smoke.

**Fixtures:** a **mock hcloud HTTP server** (the POC's `test/hcloud-driver.test.ts`
mock as the basis); a **local Docker/Caddy stand-in** (the POC's
`LocalDockerDriver` + `CaddyRegistrar`, as used in `test/eval.test.ts`) to drive
the full `Sandbox` interface and the real wildcard-URL routing without live
Hetzner.

**Fail-before/pass-after:** the conformance + Vercel-no-regression tests are
authored red (before the union/guard generalization) and must pass after.

**LIMITS (explicit, per Managed Runtime Proof Standard):** real Firecracker
microVM isolation and **live hcloud provisioning** are **NOT** covered by CI —
they require a KVM host (Arch B) and/or a real Hetzner account/token. CI proves
the API choreography (mock), the interface conformance, the Docker/Caddy eval, and
the no-regression default path; the live runtime path is proven separately on a
staging Hetzner account before the flag is enabled.

## TDD audit trail

- **Planned red commit.** Add the provider-conformance suite + the Vercel
  default-path no-regression test before any union/guard change.
  - Command: `bun --bun run test:verbose packages/sandbox/conformance.test.ts apps/web/lib/sandbox/lifecycle.test.ts`
    (or the targeted Hetzner conformance + lifecycle files).
  - Expected failing output: the Hetzner conformance test fails to compile/assert
    because `{ type: "hetzner" }` is not yet in the `SandboxState` union and
    `connectHetzner` does not exist; the lifecycle generalization assertion fails
    because `isLifecycleSupported("hetzner")` is not implemented (guard still
    hard-codes `type !== "vercel"`). The Vercel no-regression test passes pre-change
    (it pins current behavior) and must continue to pass post-change.
  - Record the red run (red-test commit or a documented exception).
- **Planned green commit.** Implement the union + `connectHetzner` dispatch + the
  `isLifecycleSupported` guard + the Hetzner provider, then re-run the same
  command and confirm green, with the Vercel no-regression test still green.

## Regression risks and concerns

- **Vercel default path breaking** — the highest risk; the union/dispatch change
  must keep `connectVercel` as the resolved default for unconfigured sessions
  (covered by the no-regression test).
- **Lifecycle guard generalization affecting Vercel** — widening the
  `lifecycle.ts:187` guard must not change Vercel hibernate/resume behavior; the
  allow-list must still include `"vercel"` and treat it identically.
- **Secret handling** — `HCLOUD_TOKEN` / SSH private-key leakage via logs, error
  messages, `getState()` serialization, or the JSONB `sandboxState`; redaction +
  encrypted-at-rest storage are mandatory.
- **Provisioning latency/timeouts** — Hetzner is 15–30 s SSH-ready (vs Vercel ~1 s);
  naive timeouts could falsely fail sessions; needs explicit provisioning state +
  generous, typed `provision_timeout`.
- **Caddy wildcard DNS/TLS ops** — misconfigured wildcard DNS or DNS-01 TLS yields
  dead preview URLs; `proxy_route_failed` must be surfaced, and route lifecycle
  (add-on-expose/remove-on-stop) must be correct.
- **Isolation/egress weaker than Vercel until Firecracker** — Arch A Cloud VMs and
  the Docker eval share weaker boundaries than a Vercel sandbox / a Firecracker
  microVM; egress filtering is unimplemented. This must be communicated in the UX
  (it is a self-hosted trade-off) and not enabled by default.

## Deploy or migration impact

- **Schema migration** — new `sandboxProviderProfiles` table (provider selection +
  `encryptedHcloudToken` + last4/fingerprint + region/serverType/previewDomain +
  status) generated via `bun run --cwd apps/web db:generate`; migrations apply
  automatically during `bun run build` per repo policy.
- **New env/secrets + encryption key** — relies on `ENCRYPTION_KEY` /
  `BETTER_AUTH_SECRET` for the `aes-256-gcm` helper; operators supply
  `HCLOUD_TOKEN` (stored encrypted) and SSH key material via the control plane.
- **Wildcard DNS + TLS cert** — `*.sandbox.<domain>` A/AAAA → proxy IP and Caddy
  DNS-01 wildcard TLS provisioning as a deploy prerequisite for live preview URLs.
- **Hetzner control-plane deployment** — a provisioning + Caddy host (Arch A) the
  operator stands up; documented as part of enabling the provider.
- **Feature flag** — Hetzner **OFF by default**, Vercel remains the default
  provider; the flag gates both the UI option and the dispatch.
- **Managed Runtime Proof Standard** — a live Hetzner staging run (provision →
  exec → preview URL → hibernate/restore) with captured evidence is required for
  the runtime path before the flag is enabled in any shared environment.

## Definition of done

- [ ] Red test observed first (provider-conformance + Vercel default-path
      no-regression authored failing).
- [ ] Behavior proof captured red before implementation.
- [ ] Red-test commit recorded (or a documented exception).
- [ ] Green commit after red (union + dispatch + guard + provider implemented).
- [ ] Targeted tests pass (conformance, no-regression, HcloudDriver mock,
      lifecycle generalization, UX smoke).
- [ ] Adjacent suite passes.
- [ ] `git diff --check` clean.
- [ ] `bun --bun run ci` passes.
- [ ] Regression harness implemented **including the Vercel default-path
      no-regression test**, with the mock hcloud + Docker/Caddy fixtures.
- [ ] Docs updated (provider setup, control-plane/Caddy DNS-TLS, lessons-learned).
- [ ] Observability evidence captured (`hetzner-sandbox` structured events, UI
      badge/states, redaction verified, screenshots + POC evidence cited).
- [ ] Deploy/migration notes included (schema migration, env/secrets, DNS/TLS,
      control-plane, feature flag).
- [ ] **Managed Runtime Proof Standard** evidence captured for a live Hetzner
      **staging** run before the flag is enabled.
