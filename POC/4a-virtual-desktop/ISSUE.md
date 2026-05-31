<!-- TITLE: feat: virtual desktop in the sandbox (Xvfb + noVNC) with watch / take-control -->

## Why this matters

Today the agent is invisible and headless: it can edit code and run CLI commands, but it cannot operate anything graphical, and a user cannot watch it work or intervene at the GUI level. That blocks three real jobs — visual front-end/browser debugging (canvas/WebGL/CSS bugs, headed-browser flows, OAuth popups), trust-building "shoulder-surf the agent" on risky runs, and human handoff for steps only a human can do (CAPTCHA, login wall, manual file pick). POC 4a proved the full transport end-to-end on a faithful Amazon Linux 2023 stand-in: `Xvfb → metacity → TigerVNC x0vncserver → websockify/noVNC`, a real `RFB 003.008` WebSocket handshake, and a non-blank 1280x800 screenshot, booting in ~10s. This issue scopes the production build: a per-session **Desktop panel** rendering a live noVNC viewport beside chat with a **watch / take-control** toggle, so users can see the agent operate a real GUI and grab the wheel from it. It is the only one of the runtime POCs that expands *what kind of work the agent can do at all* (graphical), and the most differentiated demo of the three.

## User/operator path protected

The session GUI-operation and human-handoff path: a user opening (or the agent requesting) a Desktop panel inside a managed-runtime sandbox session, watching the agent drive a GUI in real time (view-only), taking keyboard/mouse control of the *same live X session*, and returning control — with the desktop tracked as a first-class sandbox service that survives panel collapse and is gated behind an access-controlled URL (never a bare `-nopw` port). Operators must be able to attribute every desktop to a `sessionId` / `sandboxName` / `desktopServiceId`, see its readiness-gated boot states, and confirm the exposed `6080` route is secured and raw `5900` is never exposed.

## Behavior contract

- Given a managed-runtime session and a user who enables the `desktop-xvfb-novnc` profile (or accepts the agent's "open the desktop?" request), When the desktop service is requested, Then the platform installs the X stack (first time) and runs the detached `start-desktop.sh`, surfacing readiness-gated steps (X up → WM → VNC → bridge) and exposing `domain(6080) + "/vnc.html"` through a gated URL.
- Given the desktop service has started, When `start-desktop.sh` exits 0, Then a `sandboxServices` row of `kind: "desktop"` is recorded with `port: 6080`, `url`, `healthPath: "/vnc.html"`, `pid`/`commandId`, `logPath`, and `status: "running"`, and the panel renders a live viewport in **Watching** mode (`view_only`).
- Given the desktop is live in Watching mode, When the agent performs GUI actions, Then the user sees every window, cursor move, click, and keystroke in real time and a "WATCHING — agent in control" badge is shown.
- Given the user clicks "Take control", When control is handed over, Then `view_only` is cleared, keyboard/mouse inject into the same X session, the badge flips to "YOU are in control", and the agent is signaled that control was taken so it pauses GUI actions.
- Given the user holds control, When they click "Return control to agent", Then control reverts, the agent is signaled to resume, and the viewport returns to Watching mode.
- Given both the agent and the user attempt to act simultaneously, When contention is detected, Then a cursor-ownership indicator shows who is driving and the non-holder sees a "Request control" affordance.
- Given a readiness check fails (e.g. X server not up), When the desktop boot fails, Then the panel shows "Desktop crashed — restart" naming the failing check, the rest of the session keeps working (desktop is opt-in), and a typed error is recorded.
- Given the viewport URL is loaded, When the stream is established, Then it loads only through the access-controlled (token/signed) URL with a lock indicator, and raw RFB `5900` is never reachable off-loopback.

## Product and design spec

### UX — how users use it & how it's exposed

A **"Desktop" tab/panel** in the session view, beside chat. It is **opt-in**: the user enables it via a "GUI desktop" toggle on the runtime profile at session start, or the agent requests it mid-task when a task needs a GUI ("I need a headed browser to debug this — open the desktop?"). When inactive it is a collapsed strip ("Desktop off — enable to watch the agent operate a GUI"). When active it is a resizable noVNC viewport (default 1280x800) with a header bar carrying the **watch / take-control** toggle, the current-driver badge, a secured-access lock indicator, and a "Return control to agent" / "Request control" button as appropriate. Collapsing the panel leaves the desktop service running (tracked as a `sandboxServices` row); idle teardown disposes it with the sandbox.

### UX — how the feature demonstrates & explains its value to the user

The value is made obvious by *watching the agent click a real GUI*: the user sees a desktop appear, the agent launch and drive a headed browser, reproduce a visual bug, and narrate findings in chat — all live. The single most screenshot-able moment is the **take-control handoff**: the agent hits a login wall, the user clicks "Take control", types the password directly in the viewport, clicks through, then hands control back and the agent resumes against the now-authenticated session. The collapsed strip copy ("enable to watch the agent operate a GUI") sells the capability before it's used; the provisioning checklist makes the one-time setup legible rather than a mystery spinner.

### UX — how it's clear what the feature is doing (states & feedback)

Every state is explicit:

- **Provisioning / connecting** — skeleton viewport, "Starting desktop…" with readiness-gated steps surfaced (installing X stack → X up → WM → VNC → bridge); first-time shows the one-time install, resumes are fast.
- **Live / Watching (default)** — live framebuffer, agent cursor visible, "WATCHING — agent in control" badge, `view_only` set.
- **Take control (control mode)** — "YOU are in control" badge, `view_only` cleared, input injects into the same X session; agent told control was taken and pauses GUI actions.
- **Contended** — cursor-ownership indicator showing the active driver; "Request control" surfaced to the non-holder.
- **Disconnected / error / degraded** — "Desktop crashed — restart" with the failing readiness check named (e.g. "X server not up"); rest of session unaffected.
- **Secured access** — lock indicator confirming the stream loads through a gated (token/signed) URL, never a bare `-nopw` port.

View-only vs control is always unambiguous from the badge + the input-enabled state of the viewport.

### UX — how to test the UX, including regressions

Concrete plan:

- **noVNC viewport smoke**: with a desktop service up, assert the panel renders the viewport, completes the WebSocket/RFB handshake (mirrors POC `ws-rfb-probe.py` → `RFB 003.008`), and shows the **Watching** badge with `view_only` engaged; capture a non-blank screenshot (mirrors POC `desktop.png` / `assert-image.py`, >1 distinct color).
- **Take-control assertion**: click "Take control", assert the badge flips to "YOU are in control", `view_only` is cleared on the RFB connection, the agent receives the control-taken signal, and "Return control to agent" reverts both the badge and the agent-resume signal.
- **UX regressions to lock down (fail-before/pass-after)**: (1) a bare `-nopw` / unauthenticated viewport URL must be rejected — add a failing test that the panel refuses an ungated URL and only loads a token/signed URL; (2) raw `5900` must never be exposed — assert only `6080` appears in declared/exposed ports; (3) on a failed readiness check the panel must name the failing check and the rest of the session must remain interactive — assert the error state copy and that chat still works.

## Integration spec

- **Profile registration**: add `desktopProfile` (`id: "desktop-xvfb-novnc"`) to the `MANAGED_RUNTIME_PROFILES` array in `packages/sandbox/managed-runtime-profiles.ts` (it already satisfies the `ManagedRuntimeProfile` shape: `setupCommands`, `verificationCommands`, `expectedTools: ["Xvfb","x0vncserver","websockify"]`, `defaultPorts: [6080, 5900]`). Copy `profile/setup.sh` and `scripts/start-desktop.sh` from the POC to `packages/sandbox/profiles/desktop/` and point a `setupScript.repoPath`/`sandboxPath` at them, mirroring the `web-bun-agent-browser` template.
- **Port exposure**: the noVNC port rides the existing exposure path — `VercelSandbox.domain(port)` in `packages/sandbox/vercel/sandbox.ts` (delegating to `session.domain(port)` at `:1019`) returns the public `https://<sub>.vercel.run` URL; `getPreviewPorts()` / `getRuntimePreviewEnv()` inject `SANDBOX_URL_6080`. The web app builds the viewer URL as `domain(6080) + "/vnc.html"`. websockify binds `0.0.0.0:6080`; x0vncserver stays loopback-only (`-localhost yes`), so `5900` is never exposed.
- **Service tracking**: model the desktop on the existing `sandboxServices` table in `apps/web/lib/db/schema.ts` (`:327`). Add `"desktop"` to the `kind` enum (`["dev_server","code_editor","custom"]` → add `"desktop"`) and populate `port: 6080`, `url`, `healthPath: "/vnc.html"`, `pid`/`commandId` (from the detached exec), `logPath`, `status`. `start-desktop.sh` already emits a `status.json` shaped exactly to these columns. Set `relaunchOnResume: true` so a resumed session (4c) restarts the desktop.
- **Chat panel**: render `vnc.html` in an `<iframe>` (or noVNC RFB.js mounted into a React component) inside a colocated session panel + colocated `useDesktopService` hook. The `view_only` query param distinguishes watch vs control; clearing it hands control.
- **Access gate**: introduce a token/signed-URL gate in front of `6080` (per-sandbox `*.vercel.run` route is unguessable but is defense-in-depth only, not the only layer); store/issue the token alongside the `sandboxServices` desktop row.
- **Agent signaling**: a control-taken / control-returned signal path so the agent pauses GUI actions while the human drives (wire through the session event stream).

## In scope

- Register the `desktop-xvfb-novnc` profile + checked-in `setup.sh` / `start-desktop.sh` in `packages/sandbox`.
- Add `kind: "desktop"` to `sandboxServices` and persist the desktop service row from `status.json`.
- React Desktop panel (iframe/RFB.js) with provisioning/watching/control/contended/error/secured states and the watch/take-control toggle.
- Token/signed-URL access gate for port `6080`; never expose `5900`.
- Agent control-taken/returned signaling so the agent pauses GUI actions while the human drives.
- Observability events + typed errors for desktop lifecycle and control handoff.
- Regression harness: noVNC viewport smoke + take-control assertion + secured-URL/`5900`-not-exposed tests.

## Out of scope

- Headed-Chromium-specific hardening (`--no-sandbox`/seccomp, `/dev/shm` sizing) — validated in a dedicated follow-up before promising browser GUI as the headline use case (xterm proves the pipeline here).
- Multi-user concurrent control arbitration beyond single agent + single human (`-AlwaysShared` multi-viewer is supported; rich multi-human control policy is out).
- Snapshot/resume of the desktop across hibernation — depends on 4c; this slice only sets `relaunchOnResume: true`.
- Right-sizing/auto-selecting a heavier sandbox tier for headed GUIs (tier work is adjacent).
- Audio, clipboard sync, file drag-and-drop into the desktop.

## Research and context sources

- POC PR #88 and the `POC/4a-virtual-desktop/` folder (this branch): `README.md`, `PRODUCT-BRIEF.md`, `profile/desktop-profile.ts`, `profile/setup.sh`, `scripts/start-desktop.sh`, `eval/` harness.
- POC eval evidence: `evidence/vnc-handshake.txt` (`RFB 003.008` over WS, `101` + `Sec-WebSocket-Accept` verified), `evidence/desktop.png` + `evidence/image-assert.txt` (1280x800 PNG, 173 distinct colors), `evidence/verification.txt` (4/4 verificationCommands), `evidence/status.json`, `evidence/start-desktop.log`, `evidence/al2023-package-availability.txt` (AL2023 package reality: TigerVNC + metacity + pip websockify + noVNC tarball; `x11vnc`/`fluxbox`/`novnc` NOT packaged).
- Codebase seams: `packages/sandbox/managed-runtime-profiles.ts` (`ManagedRuntimeProfile` shape), `packages/sandbox/vercel/sandbox.ts` (`domain(port)` `:1019`, `getRuntimePreviewEnv` `:470`), `apps/web/lib/db/schema.ts` (`sandboxServices` `:327`, `relaunchOnResume` `:355`).
- `docs/process/managed-runtime-proof-standard.md`, `docs/process/feature-ticket-format.md`.

## Agent todo checklist

- [ ] Read `packages/sandbox/managed-runtime-profiles.ts` and the `web-bun-agent-browser` setupScript pattern; identify the registration seam.
- [ ] Write the failing tests first: noVNC viewport smoke (handshake + Watching badge + non-blank frame), take-control assertion, secured-URL-only + `5900`-not-exposed.
- [ ] Confirm red on all three.
- [ ] Register `desktop-xvfb-novnc` in `MANAGED_RUNTIME_PROFILES`; copy `setup.sh` + `start-desktop.sh` into `packages/sandbox/profiles/desktop/`.
- [ ] Add `"desktop"` to the `sandboxServices.kind` enum; generate the Drizzle migration (`bun run --cwd apps/web db:generate`).
- [ ] Persist the desktop service row from `status.json` (port/url/healthPath/pid/commandId/logPath/status, `relaunchOnResume: true`).
- [ ] Implement the token/signed-URL access gate for `6080`; assert `5900` stays loopback-only.
- [ ] Build the Desktop panel + `useDesktopService` hook with all states and the watch/take-control toggle.
- [ ] Wire the agent control-taken/returned signaling through the session event stream.
- [ ] Add the `desktop-service` observability events + typed error kinds + redaction.
- [ ] Make the failing tests pass; run the adjacent suite, `git diff --check`, and `bun --bun run ci`.
- [ ] Capture Managed Runtime Proof evidence (noVNC handshake transcript + desktop.png) and update docs.

## Tests to add first

- **noVNC viewport smoke (red first)**: against a running desktop service, the panel completes the WS/RFB handshake and renders a non-blank frame with the Watching badge and `view_only` engaged. Fails before the panel + handshake wiring exist.
- **Take-control assertion (red first)**: clicking "Take control" clears `view_only`, flips the badge, emits the control-taken signal, and "Return control" reverts. Fails before control signaling exists.
- **Secured-URL-only (red first)**: the panel refuses an ungated `-nopw` URL and only loads a token/signed URL. Fails before the access gate exists.
- **`5900`-not-exposed (red first)**: only `6080` appears in declared/exposed ports for the desktop profile; raw `5900` is never exposed. Fails if the profile naively exposes both.
- **Service row contract (red first)**: a started desktop persists a `sandboxServices` row of `kind: "desktop"` with the `status.json` fields and `relaunchOnResume: true`. Fails before the enum + persistence land.

## Observability and user feedback

- **User-visible status**: provisioning steps, Watching vs control badges, secured-access lock, "Desktop crashed — restart (named check)".
- **Named service**: `desktop-service` emits structured events. Examples:
  - `desktop-provisioning` (info) `{ userId, sessionId, sandboxName, desktopServiceId, profileId, step }`
  - `desktop-ready` (info) `{ userId, sessionId, sandboxName, desktopServiceId, port: 6080, url, bootMs }`
  - `desktop-control-taken` / `desktop-control-returned` (info) `{ userId, sessionId, desktopServiceId, holder: "human"|"agent" }`
  - `desktop-readiness-failed` (warn) `{ sessionId, sandboxName, desktopServiceId, failingCheck, errorKind }`
- **Typed error kinds**: `xserver-not-up`, `wm-not-running`, `vnc-bridge-down`, `novnc-port-unreachable`, `desktop-url-ungated`, `desktop-exec-failed`.
- **Correlation IDs**: `userId`, `sessionId`, `sandboxName`, `desktopServiceId`, `profileId`.
- **Redaction**: never log the VNC password / one-time token / signed-URL signature; redact any framebuffer content and credentials typed during a human handoff (event payloads carry references, not pixels or keystrokes).
- **Grep-able debug recipe**: `grep '"sessionId":"<id>"' logs | grep '"service":"desktop-service"'`; for handoff: `... | grep 'desktop-control-'`.
- **Evidence expectation (Managed Runtime Proof Standard)**: capture the noVNC WebSocket/RFB handshake transcript (`RFB 003.008`, `101` + `Sec-WebSocket-Accept`) and a non-blank `desktop.png` from the real sandbox path, mirroring `POC/4a-virtual-desktop/evidence/vnc-handshake.txt` and `evidence/desktop.png`.

## Regression harness plan

- **Existing coverage**: none for desktop services (new `kind`).
- **New durable signals**: (1) the noVNC viewport smoke + take-control assertion as a browser/integration smoke against a live desktop service fixture; (2) a contract test on the `sandboxServices` desktop-row shape; (3) a port-exposure test asserting `6080` exposed / `5900` loopback-only; (4) an access-gate test rejecting ungated URLs.
- **Fixtures**: a fake desktop service exposing a websockify/noVNC endpoint (or the POC `Dockerfile.runtime-check` runtime image) and a stub `status.json`.
- **Fail-before/pass-after**: each test fails on `main` (no `desktop` kind, no panel, no gate) and passes after the slice.
- **Limits not caught**: the smoke cannot reproduce real Firecracker GUI resource pressure, headed-Chromium seccomp behavior, or real-internet install latency; those require the gated real-sandbox proof and the headed-Chromium follow-up.

## TDD audit trail

- Planned red commit: `test(desktop): failing noVNC viewport smoke + take-control + secured-URL/5900-not-exposed` (observed red).
- Planned green commit: `feat(desktop): register desktop-xvfb-novnc profile, sandboxServices kind=desktop, gated noVNC panel with watch/take-control` (suite green after red).
- If any test cannot be expressed pre-implementation (e.g. live RFB against a real sandbox gated behind credentials), record the exception and the manual proof captured in the PR per the Managed Runtime Proof Standard.

## Regression risks and concerns

- **Resource cost in a microVM**: a headed desktop + WM + VNC encode consumes RAM/CPU the headless profile does not; heavy GUI apps (Chromium/Electron) push further. Mitigate: opt-in only, right-sized tier, idle teardown, default off.
- **Exposed-VNC security**: the POC ran `-nopw`. A real deployment must gate `6080` (token/signed URL, prefer TLS) and never expose `5900`; the per-sandbox unguessable route is necessary but not sufficient. An exposed remote-control surface is unforgiving to get wrong.
- **Headed-Chromium gaps**: xterm proves the pipeline; real headed Chromium needs `--no-sandbox`/seccomp handling and more `/dev/shm` — unvalidated here and the most likely actual use case.
- **Handoff UX correctness**: watch-vs-control state, cursor ownership, resync after the agent acts, and the agent pausing on control loss are the hard, unproven product parts; a mediocre version feels broken.
- **Backgrounded-daemon pipe deadlock**: the POC hit a hang when detached daemons inherited the caller's stdout pipe; the production detached/`execDetached` startup must redirect every daemon's stdio to files.

## Deploy or migration impact

- **Schema migration**: adding `"desktop"` to the `sandboxServices.kind` enum requires a generated Drizzle migration committed alongside the schema change; migrations apply automatically during `bun run build` on every Vercel deploy (preview + prod), each against its own Neon branch.
- **Managed-runtime profile registration**: `desktop-xvfb-novnc` ships in the profile registry and its `setup.sh`/`start-desktop.sh` ship under `packages/sandbox/profiles/desktop/`.
- **Port exposure**: `6080` is declared in `defaultPorts` and exposed via `domain(port)`; the access gate must be live before exposing. `5900` stays loopback-only.
- **Tier**: desktop is opt-in; recommend (not require) a sandbox tier sized for a headed desktop and document the right-sizing guidance.
- **No production data backfill**; existing sessions are unaffected (new opt-in service kind).

## Definition of done

- [ ] Red test written first and observed failing (behavior proof red).
- [ ] Red-test commit recorded (or documented exception per the Managed Runtime Proof Standard).
- [ ] Green commit after the red, implementing the smallest change to pass.
- [ ] Targeted tests pass (viewport smoke, take-control, secured-URL/`5900`, service-row contract).
- [ ] Adjacent suite passes.
- [ ] `git diff --check` clean.
- [ ] `bun --bun run ci` passes (format, lint, typecheck, tests).
- [ ] Regression harness implemented (noVNC smoke + take-control + port-exposure + access-gate).
- [ ] Docs updated (profile catalog, desktop panel usage, security notes; lessons-learned for the daemon pipe/exposure lessons).
- [ ] Observability evidence captured (desktop lifecycle + control-handoff events, typed errors, redaction verified).
- [ ] Deploy notes included (migration, profile registration, port exposure, tier guidance).
- [ ] Managed Runtime Proof Standard evidence captured (real-sandbox noVNC handshake transcript + non-blank `desktop.png`).
