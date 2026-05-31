# Product Brief: Virtual Desktop in the Sandbox (watch-and-take-over)

> Status: Proof-of-concept complete (eval-backed). This brief argues whether to productize it.

## TL;DR
We can stand up a live, streamable graphical desktop inside the per-session microVM and embed it in the chat UI as a viewport the user can watch and take control of. The POC proved the full chain end-to-end (Xvfb → metacity → TigerVNC → websockify/noVNC, real RFB handshake, non-blank screenshot) on a faithful Amazon Linux 2023 stand-in, booting in ~10s. This turns "headless coding agent" into "agent you can watch operate a real GUI, and grab the wheel from." It is the highest-wow, highest-cost item of the three — recommend building it after 4b/4c, gated on a concrete GUI use case.

## The gap today
Today the agent is invisible and headless. It can edit code and run CLI commands, but it cannot operate anything graphical, and the user cannot watch it work in real time or intervene mid-task at the GUI level. Three groups feel this:
- **Users debugging GUI/browser behavior** — front-end work where the bug is visual, a headed-browser flow, an OAuth popup, a canvas/WebGL render, or an Electron app. The agent can run a headless browser but the human cannot see what it sees, and cannot click the thing the agent is stuck on.
- **Users who don't fully trust autonomous agents** — they want to watch a risky operation unfold and stop it, not read a transcript after the fact. There is no "shoulder-surf the agent" mode.
- **Tasks that require a human handoff** — a CAPTCHA, a login wall, a manual file pick, a "click confirm in this UI." Today the agent simply gets stuck; there is no surface to hand control to the human and hand it back.

## What we'd build
A **Desktop panel** in the session: an opt-in live virtual desktop running inside the sandbox, rendered as a noVNC viewport next to the chat, with a **watch / take-control** toggle. The agent drives GUI apps (headed Chromium, Electron, GUI tooling) on a virtual X display; the same framebuffer is streamed to the user's browser so they can watch, and — on demand — take over keyboard and mouse against the *same live session* the agent is automating, then return control.

The POC proved the mechanism: a `desktop-xvfb-novnc` managed-runtime profile (matching the real `ManagedRuntimeProfile` type) whose setup installs the X stack on AL2023 via `dnf` + pip + a pinned noVNC tarball, and a detached `start-desktop.sh` that boots Xvfb → metacity → x0vncserver → websockify/noVNC and emits a `status.json` shaped like a `sandboxServices` row. The noVNC port (6080) rides the platform's existing port-exposure path (`domain(port)` → `*.vercel.run`); raw RFB (5900) stays loopback-only. Multi-client (`-AlwaysShared`) is what makes simultaneous agent+human on one framebuffer possible.

## How users experience it
### Where it lives (exposure)
A **"Desktop" tab/panel** in the session view, beside chat. It is **opt-in** — either the user enables it at session start (a "GUI desktop" toggle on the runtime profile) or the agent requests it when a task needs a GUI ("I need a headed browser to debug this — open the desktop?"). When inactive it's a collapsed strip ("Desktop off — enable to watch the agent operate a GUI"). When active it's a live viewport with a control toggle in the panel header.

### Sample UI
A resizable **noVNC viewport** embedded in the session, with a header bar carrying the mode toggle and status. States:
- **Provisioning** — skeleton viewport, "Starting desktop… (installing X stack / booting display)" with the readiness-gated steps surfaced (X up → WM → VNC → bridge). First-time setup shows the one-time install; subsequent resumes are fast.
- **Watching (default)** — live 1280x800 framebuffer, agent's cursor visible, a subtle "WATCHING — agent in control" badge, viewport is `view_only`. User sees every window, click, and keystroke the agent makes.
- **Take control** — user clicks **"Take control."** Badge flips to "YOU are in control"; `view_only` is cleared; keyboard/mouse now inject into the same X session. The agent is told control was taken (so it pauses GUI actions). A "Return control to agent" button hands it back.
- **Contended** — if both try to act, a cursor-ownership indicator shows who's driving; "Request control" surfaces when the other party holds it.
- **Error / degraded** — "Desktop crashed — restart" with the failing readiness check named (e.g. "X server not up"); the rest of the session keeps working since the desktop is an opt-in service.
- **Secured access** — the viewport loads through a gated URL (token/signed URL), never a bare `-nopw` port; a small lock indicator confirms the stream is access-controlled.

### UX walkthrough
1. User is debugging a visual bug; the agent says it needs to see the rendered page and offers to open the desktop. User accepts (or had it on already).
2. Panel shows **Provisioning**; the X stack comes up (~10s after first install). The viewport fills with a desktop and a headed browser the agent launches.
3. User **watches** the agent navigate, reproduce the bug, and narrate findings in chat — all live, in `view_only`.
4. The agent hits a login wall it can't pass. User clicks **Take control**, types the password directly in the viewport, clicks through, then **Return control to agent**.
5. Agent resumes against the now-authenticated session, fixes the code, and re-verifies in the same live browser while the user watches.
6. User collapses the Desktop panel; the service keeps running (tracked as a `sandboxServices` row) or is torn down on idle with the sandbox.

## Value to the user
**Jobs-to-be-done:** "Let me *see* what the agent sees." "Let me *grab the wheel* when it's stuck, without leaving the session." "Let me operate a GUI app/browser the agent can't fully automate." "Let me trust a risky run by watching it happen."

- **Visual front-end debugging:** A canvas/WebGL/CSS bug that only manifests visually — the user and agent look at the same rendered page, point at the same artifact, and fix it together instead of trading screenshots.
- **Auth / CAPTCHA / manual-step handoff:** The agent automates a browser flow up to a login or CAPTCHA, hands control to the human for the 10 seconds only a human can do, and resumes — turning a hard stop into a smooth handoff.
- **Watch-a-risky-run:** A user about to let the agent run a migration tool or a destructive GUI operation watches it live with a finger on "take control," building the trust that makes them comfortable delegating more.

## Value to the product
- **Differentiation:** "Watch your cloud agent operate a real desktop, and take the wheel" is a demo nobody forgets and a capability headless-only competitors don't have. It's the single most screenshot-able feature of the three.
- **Trust → activation/retention:** The watch-and-take-over loop directly attacks the #1 reason people don't delegate to autonomous agents (loss of control). It converts skeptics and deepens engagement on hard tasks.
- **Expansion into GUI/desktop work:** Unlocks headed-browser QA, Electron app development, and GUI tooling as serviceable workloads — categories the headless profile structurally cannot touch.
- **Strategic:** Pairs with 4b (desktop is itself a managed-runtime profile) and 4c (a hibernated session can resume the desktop), so it compounds rather than standing alone.

## The case FOR (strong)
1. **It's proven, not speculative.** The full stack streamed a live, non-blank 1280x800 desktop and passed a real RFB `003.008` handshake over WebSocket end-to-end on a faithful AL2023 reproduction — and the AL2023 package availability was verified empirically (the naive `x11vnc`/`fluxbox`/`novnc` stack does NOT install; the working TigerVNC + metacity + pip + tarball substitutions do). The riskiest unknowns are already burned down.
2. **It rides existing platform seams.** Desktop is just another managed-runtime profile; the noVNC port uses the existing `domain(port)` → `*.vercel.run` exposure path; the service tracks as a `sandboxServices` row with the `status.json` already shaped for it. Minimal new platform machinery.
3. **Fast at runtime.** ~10s readiness-gated startup means it feels like opening a panel, not provisioning a VM (the only slow part is the one-time package install, which 4c snapshotting can amortize away).
4. **Watch-and-take-over is a genuinely new interaction.** Multi-client `-AlwaysShared` lets agent and human share one framebuffer — the technical basis for an interaction pattern (live handoff) that meaningfully changes trust dynamics.
5. **Strategic wedge into GUI workloads.** It's the only one of the three POCs that expands *what kind of work the agent can do at all* (graphical), not just how it's packaged.

## The case AGAINST (strong)
1. **Resource cost in a microVM.** A headed desktop + WM + VNC encode consumes RAM/CPU the headless profile doesn't, and heavy GUI apps (Chromium/Electron) push it further — the POC explicitly flags right-sizing the sandbox tier. This is real per-session cost for a feature many sessions won't use.
2. **VNC security is non-trivial and unforgiving.** The POC ran `-nopw`. A real deployment must gate port 6080 with a password/one-time token/signed URL, prefer TLS, and never expose raw 5900. An exposed remote-control surface is a serious attack surface to get exactly right — the per-sandbox unguessable route is necessary but not sufficient.
3. **The UX is the hard, unproven part.** The transport works; the *product* — watch-vs-control state, "request control," cursor ownership, resync after the agent acts, telling the agent it lost control and having it pause gracefully — is real design and engineering the POC explicitly leaves open. This is where a mediocre version feels broken.
4. **Headed Chromium isn't fully validated.** xterm proved the pipeline; real headed Chromium needs `--no-sandbox`/seccomp handling and more `/dev/shm` in the microVM — a known follow-up, and the browser is the most likely actual use case.
5. **Narrow demand vs. cost.** Most coding tasks are headless and code-centric. If the realistic GUI use cases (visual debugging, auth handoff) are a small slice of sessions, we're carrying meaningful build + per-session cost for an occasional, opt-in feature.

## Effort, dependencies & risk
- **Feasibility verdict (from POC): Medium–Hard.** The runtime stack is proven and fast (~10s), but the full product is gated by UX polish and security hardening, not by transport feasibility.
- **Build size:** Medium. Register the `desktop` profile + scripts in `packages/sandbox`; track the desktop as a `sandboxServices` row (add `kind: "desktop"` to the enum, store port/url/healthPath/pid/status from `status.json`); build the React noVNC panel (iframe or RFB.js) with watch/control state; build the secure access gate for port 6080; handle agent-side "control taken/returned" signaling.
- **Dependencies:** existing managed-runtime-profile system; existing port-exposure path (`domain(port)`, `getRuntimePreviewEnv`); `sandboxServices` schema; a sandbox tier with enough RAM/CPU for a headed desktop. Compounds with 4c (snapshot away the one-time install) and 4b (desktop is a profile).
- **Top risks + mitigations:**
  - *Exposed VNC port* → token/signed-URL gate + TLS, never expose 5900, lean on the per-sandbox unguessable route as defense-in-depth (not the only layer).
  - *Resource cost* → opt-in only, right-sized tier, idle teardown, default off.
  - *Handoff UX feels broken* → invest in cursor-ownership + control-state design up front; agent must pause GUI actions on control loss.
  - *Headed Chromium specifics* → validate `--no-sandbox`/seccomp + `/dev/shm` sizing in a dedicated follow-up before promising browser GUI as the headline use case.

## The decision
**The crisp question:** Do we want "watch your agent operate a live GUI and take the wheel" as a product surface now, given it's the most differentiated but also the most resource-, security-, and UX-expensive of the three?

**Recommended trigger to greenlight:** A concrete, recurring GUI use case with pull — most likely **headed-browser visual debugging / auth-and-CAPTCHA handoff** — plus a sandbox tier sized for a headed desktop. Validate headed Chromium first.

**Success metrics:** desktop-session opt-in rate among eligible (GUI/front-end) tasks; take-control events per desktop session (proof the handoff loop is used); task-success lift on GUI tasks with the desktop vs. without; zero security incidents on the exposed viewport; p50 desktop-ready time (target the proven ~10s, faster with 4c snapshotting).

**Suggested default: BUILD LATER (after 4b and 4c).** It's the most compelling demo and the only true workload-expander, but also the most expensive on every axis. Do 4b first (cheap, broad), 4c next (enables resume and amortizes the desktop install), then build this on top with a real GUI use case in hand. The technical risk is largely retired; the open work is UX, security hardening, and headed-Chromium validation — exactly the kind of polish that benefits from going second.
