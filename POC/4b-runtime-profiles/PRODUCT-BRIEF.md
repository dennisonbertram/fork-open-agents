# Product Brief: New Managed-Runtime Profiles (Python, Go, Rust, Docker)

> Status: Proof-of-concept complete (eval-backed). This brief argues whether to productize it.

## TL;DR
The platform ships essentially one runtime profile today (`web-bun-agent-browser`), so it only serves JavaScript/TypeScript web repos. This POC proved that adding new languages is **purely declarative** — a profile object of `setupCommands` + `verificationCommands` + `expectedTools` against the existing `ManagedRuntimeProfile` type — and that all four new runtimes (Python, Go, Rust, Docker-in-sandbox) actually install and **run a real program** in a clean Linux container, with zero new platform machinery. This is the cheapest, highest-ROI item of the three: it multiplies the addressable repo population for near-trivial cost. **Build it now.**

## The gap today
The agent can only meaningfully work on JS/TS web repos. A user who points it at a Python service, a Go CLI, a Rust crate, or anything that needs Docker gets a sandbox without the right toolchain — no `python`, no `go`, no `cargo`, no `docker`. The pain is felt at the front door: the platform looks like a JS-only tool, so the entire non-JS developer population (a large majority of professional repos) either bounces or has a degraded experience. Every Python data team, Go backend team, and Rust systems team is currently out of scope despite the underlying agent being language-agnostic.

## What we'd build
**A runtime-profile catalog** — first-class, declarative runtime profiles for Python, Go, Rust, and Docker-in-sandbox, selectable per repo/session, so the sandbox arrives with the right toolchain already installed and verified. Each profile is the existing default profile's pattern applied to a new language: install the toolchain, verify the tools resolve on PATH, and (in the POC's eval) compile-and-run a tiny real program to prove the toolchain *works*, not merely that a binary exists.

The POC proved the mechanism end-to-end: four `ManagedRuntimeProfile` objects that satisfy the **real** type byte-for-byte (compiled against the type imported directly from `packages/sandbox/managed-runtime-profiles.ts`, `tsc --noEmit` clean). Because `MANAGED_RUNTIME_PROFILES` is the single registry, registering them automatically flows them through `getManagedRuntimeProfile`, `listManagedRuntimeProfiles` (the picker UI), id-validation, snapshot commands, resolution, and observability — **no consumer code changes**.

## How users experience it
### Where it lives (exposure)
A **runtime-profile picker** at repo connect / session creation: "What does this repo need?" with the catalog (Web/Bun default, Python, Go, Rust, Docker, …) and ideally an **auto-detect** that reads the repo (`pyproject.toml`/`requirements.txt` → Python, `go.mod` → Go, `Cargo.toml` → Rust, `Dockerfile`/`compose.yaml` → Docker) and pre-selects the right profile. The selection is remembered per repo. Power users can clone a built-in into a saved/custom profile (the POC notes the new profiles are valid `savedProfiles` drafts as-is).

### Sample UI
A **profile selector card** plus a **setup/verify status** strip that surfaces the profile run honestly. States:
- **Picker** — radio/cards for each profile, each with what it installs (e.g. "Python — uv + managed CPython 3.12") and a typical setup time. Auto-detected profile is highlighted ("Detected `go.mod` — Go selected").
- **Provisioning / setup running** — a live checklist mirroring the real `managedRuntimeProfileRuns` observation rows: each setup command with status/duration ("Installing uv… ✓ 8s", "Installing CPython 3.12… ✓ 31s"). Honest about the long pole (Rust ~4 min cold) instead of a spinner that lies.
- **Verifying** — the `verificationCommands` checklist with pass/fail per check ("uv on PATH ✓", "python on PATH ✓", "linker `cc` present ✓").
- **Ready** — "Python 3.12 ready" with resolved tool versions; agent can start.
- **Setup failed (actionable)** — e.g. Docker's required `verify-docker-daemon` fails on a non-privileged tier → "This repo needs Docker, which requires a privileged sandbox tier. Upgrade or pick a different profile." The failure is a *signal*, not a dead end.

### UX walkthrough
1. User connects a GitHub repo with a `Cargo.toml`. Auto-detect highlights **Rust**; user confirms (or overrides).
2. Session provisions; the **setup checklist** streams: rustup stable install, gcc/linker install, each with a live duration. The UI is upfront that Rust is the slow one (~4 min cold) and notes it'll be faster next time once cached.
3. **Verify** runs: `rustc`, `cargo`, and `cc` all resolve — including the linker check that the POC's eval added precisely because `cargo run` failed without it.
4. **Ready.** The agent now has a real Rust toolchain and can `cargo build`/`cargo test` the user's crate.
5. Next session on the same repo reuses the remembered profile; with 4c snapshotting, the installed toolchain can be restored instead of reinstalled.

## Value to the user
**Jobs-to-be-done:** "Use the agent on *my* repo, whatever language it's in." "Have the toolchain just be there, correctly, without me scripting a Dockerfile." "Trust that the environment actually compiles my code, not just that some binary is present."

- **Python service team:** Connects a FastAPI repo; the `python-uv` profile lands uv + CPython 3.12 in ~40s, and the agent can run tests and the service immediately — no JS-shaped workaround.
- **Go backend team:** Points the agent at a Go module; latest-stable Go installs in ~27s (version auto-detected from go.dev), and the agent compiles and runs real code (`go run` proven in the eval).
- **Repo needing containers:** A repo whose tests need Docker selects `docker-in-sandbox`; the agent runs `docker run` against an in-sandbox daemon (proven with `hello-world` on the vfs driver) — on a privileged tier, with the UI saying so plainly if the tier is wrong.

## Value to the product
- **Cheap addressable-market expansion:** This is the lever that turns a "JS web app tool" into a "polyglot coding agent." Each profile is a few command strings; each one opens an entire language ecosystem of repos. The ROI ratio (repos unlocked per line of code) is the best of the three POCs by a wide margin.
- **Activation:** Auto-detect + "your toolchain is ready" removes the single biggest first-session failure ("the agent can't even run my code"). Higher connect-to-first-success conversion across non-JS repos.
- **Expansion & positioning:** A growing profile catalog (and user-authored `savedProfiles`) is a natural surface for tiering — Docker-in-sandbox naturally maps to a privileged/paid tier. It positions the product as language-agnostic by design, not JS-first.
- **Compounds with 4c:** profile setup is exactly the expensive one-time work that snapshotting amortizes, making slow installs (Rust) a one-time cost.

## The case FOR (strong)
1. **Lowest cost, highest leverage.** Adding a runtime is *purely declarative* — a profile object plus install/verify strings — and the platform's resolution, listing, and observability layers absorb new profiles with **zero code change** (proven: the four objects satisfy the real type and flow through every consumer automatically).
2. **It actually works, not just "binary exists."** Every profile installed *and ran a real program* in a clean container: `PYTHON_OK 3 12`, `GO_OK` (real compile), `RUST_OK` (real compile + link), `DOCKER_OK` (`docker run` against the in-sandbox daemon). The eval caught two real bugs a smoke test would miss — Rust's missing C linker and dind's overlay-on-overlay failure — and fixed both.
3. **Directly removes the front-door bounce.** Today non-JS repos are effectively unsupported; this is the difference between "can't use it" and "works on day one" for the majority of professional repos.
4. **Fast for the common cases.** Python ~40s, Go ~27s — interactive-grade. Only Rust (~4 min cold) and Docker are slow, and both are bounded and improvable (caching/snapshot/pre-bake).
5. **Honest, observable failure modes.** Required-command failures are designed signals (e.g. Docker on a non-privileged tier), surfaced through the existing `managedRuntimeProfileRuns` observation shape — so the UI can tell the user exactly what to do.

## The case AGAINST (strong)
1. **Base-image compatibility is assumed, not proven on the real base.** The eval used Debian-family images; the real managed/Vercel sandbox base may differ (glibc vs musl, package manager, preinstalled curl). The Rust `gcc` install and apt fallbacks assume Debian/Alpine/RHEL families — an unknown base could need per-profile adjustment.
2. **Slow tails hurt the interactive promise.** Rust at ~4 min cold (and Docker at 165–335s) is long for an interactive session. Without snapshot caching or pre-baking, first-run latency on those profiles undercuts the "just works" feel.
3. **Docker-in-sandbox needs privilege and trades speed.** dind requires a privileged (or rootless-userns) sandbox and the vfs storage driver. That's a real infrastructure/security/cost decision (a privileged tier), not a free profile — and arguably belongs behind 4c/tiering work.
4. **Network egress dependence.** Every profile fetches from the public internet (astral.sh, go.dev, sh.rustup.rs, get.docker.com). A locked-down sandbox needs an allowlist or mirror, and any of those endpoints being unreachable breaks setup.
5. **Maintenance surface grows.** Auto-detecting latest versions keeps toolchains current but means setup can drift/break when upstreams change; each profile is a small ongoing maintenance commitment (version strings, install-script changes upstream).

## Effort, dependencies & risk
- **Feasibility verdict (from POC): Easy / declarative.** New runtimes are profile objects + command strings; the platform absorbs them with zero consumer changes. This is the explicitly cheap, high-ROI POC.
- **Build size:** Small for Python/Go/Rust (register the literals in `MANAGED_RUNTIME_PROFILES`; they already satisfy the type). Medium incremental for the *picker UX + auto-detect*, which is net-new product work (the picker UI exists via `listManagedRuntimeProfiles`, but repo-based auto-detect and the live setup/verify status surface are worth building well). Docker-in-sandbox carries the extra privileged-tier work.
- **Dependencies:** the existing managed-runtime-profile registry, resolution (`profile-resolution.ts`), and observability (`managed-runtime-profile-runs.ts`) — all profile-shape-agnostic. Docker depends on a privileged sandbox tier. Slow installs depend on 4c snapshotting (or pre-baked base layers) to feel fast on re-entry.
- **Top risks + mitigations:**
  - *Real base differs from Debian eval* → validate each profile against the actual sandbox base before GA; keep installs base-family-aware.
  - *Slow cold installs (Rust/Docker)* → cache toolchains in the snapshot (4c) or pre-bake into a base layer; show honest, staged progress meanwhile.
  - *dind privilege/security* → gate Docker behind a privileged/paid tier; treat the required `verify-docker-daemon` failure as the explicit "wrong tier" signal.
  - *Egress lockdown* → ship an allowlist/mirror story for the four install endpoints.

## The decision
**The crisp question:** Do we want the platform to be polyglot (Python/Go/Rust/Docker) instead of JS-only — given that the language profiles are nearly free and only Docker carries real infrastructure cost?

**Recommended trigger to greenlight:** Now. The only precondition is validating the three language profiles against the **real** sandbox base image; Docker can follow once a privileged tier exists.

**Success metrics:** share of connected repos that are non-JS (the addressable-market lever); connect-to-first-success conversion on non-JS repos; profile auto-detect accuracy; setup-run pass rate per profile and p50 setup time per profile (target the proven Python ~40s / Go ~27s, and drive Rust/Docker down via caching); adoption of Docker profile on the privileged tier.

**Suggested default: BUILD NOW — this is the cheap, high-ROI one.** Ship Python, Go, and Rust first (declarative, fast to land, validated against the real base), with auto-detect and an honest setup/verify status surface. Sequence Docker-in-sandbox alongside the privileged-tier/tiering work. Lean on 4c to amortize the slow installs. Of the three POCs, this returns the most addressable market per engineering hour and should lead the roadmap.
