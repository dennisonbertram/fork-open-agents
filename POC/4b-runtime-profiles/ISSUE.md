<!-- TITLE: feat: managed-runtime profiles for Python, Go, Rust, and Docker-in-sandbox -->

## Why this matters

The platform ships essentially one managed-runtime profile today — `web-bun-agent-browser` in `packages/sandbox/managed-runtime-profiles.ts` — so it only serves JavaScript/TypeScript web repos. A user who points the agent at a Python service, a Go CLI, a Rust crate, or anything needing Docker gets a sandbox with no `python`, no `go`, no `cargo`, no `docker`: the pain is felt at the front door, and the entire non-JS developer population (the majority of professional repos) bounces. POC 4b proved that adding a runtime is **purely declarative** — a `ManagedRuntimeProfile` object of `setupCommands` + `verificationCommands` + `expectedTools` — and that all four new runtimes install and **actually run a real program** in a clean Linux container (`PYTHON_OK 3 12`, `GO_OK` real compile, `RUST_OK` real compile + link, `DOCKER_OK` `docker run` against an in-sandbox daemon), with the platform's resolution, listing, and observability layers absorbing them with **zero consumer code change**. This is the cheapest, highest-ROI item of the three: each profile is a few command strings and opens an entire language ecosystem of repos. This issue scopes the production build — registering the language profiles, a repo-aware runtime-profile **picker with auto-detect**, and an honest **setup/verify status** surface — and sequences Docker-in-sandbox alongside the privileged-tier work.

## User/operator path protected

The repo/session provisioning path for non-JS repos: a user connecting a GitHub repo (or creating a session) and getting a sandbox that arrives with the **right toolchain already installed and verified**, with the profile auto-detected from the repo (`pyproject.toml`/`requirements.txt` → Python, `go.mod` → Go, `Cargo.toml` → Rust, `Dockerfile`/`compose.yaml` → Docker), per-command setup/verify progress surfaced honestly (including the long poles), and required-command failures turned into actionable signals (e.g. "Docker needs a privileged tier") rather than dead ends. Operators must be able to attribute every profile run to `userId`/`sessionId`/`profileId`, see per-command setup/verify status and durations, and see the typed failure kind when a profile cannot complete on the active base/tier.

## Behavior contract

- Given a connected repo with a `go.mod`, When the runtime-profile picker opens, Then `go-toolchain` is auto-detected and pre-selected with a "Detected `go.mod` — Go selected" hint, and the user can confirm or override.
- Given the user selects `python-uv`, When the session provisions, Then the setup checklist streams each setup command with live status/duration ("Installing uv… ✓ 8s", "Installing CPython 3.12… ✓ 31s") and the verify checklist shows pass/fail per `verificationCommand`.
- Given a profile's `setupCommands` all succeed and its `verificationCommands` all pass, When provisioning completes, Then the panel shows "Ready" with resolved tool versions and the agent can start.
- Given the `rust-cargo` profile, When setup runs, Then it installs `gcc` before rustup and the required `verify-linker` (`cc`) check passes, so a later `cargo run` (real compile + link) succeeds — the linker is not assumed present.
- Given a `docker-in-sandbox` profile on a non-privileged tier, When the required `verify-docker-daemon` command runs, Then it fails by design and the UI surfaces "This repo needs Docker, which requires a privileged sandbox tier — upgrade or pick a different profile" with a typed `wrong-tier` signal.
- Given any profile run, When each setup/verify command completes, Then one `ManagedRuntimeCommandObservation` (`commandId`/`label`/`status`/`required`/`exitCode`/`durationMs`/`summary`) is recorded on the `managedRuntimeProfileRuns` row.
- Given a registered built-in profile id and a user `savedProfile` of the same id, When `resolveManagedRuntimeProfile` runs, Then the registered built-in takes precedence (existing resolution order is preserved).
- Given a repo the agent reopens on a profile that is slow to install (Rust ~4 min cold), When 4c snapshotting is available, Then the toolchain is restored from snapshot instead of reinstalled (compounding behavior, gated on 4c).

## Product and design spec

### UX — how users use it & how it's exposed

A **runtime-profile picker** at repo connect / session creation: "What does this repo need?" listing the catalog (Web/Bun default, Python, Go, Rust, Docker) sourced from `listManagedRuntimeProfiles()`. An **auto-detect** reads the repo and pre-selects the right profile (`pyproject.toml`/`requirements.txt` → Python, `go.mod` → Go, `Cargo.toml` → Rust, `Dockerfile`/`compose.yaml` → Docker), highlighting the match ("Detected `go.mod` — Go selected") while letting the user override. The selection is remembered per repo. Power users can clone a built-in into a saved/custom profile (the POC notes the new profiles are valid `savedProfiles` drafts as-is). Each card states what it installs ("Python — uv + managed CPython 3.12") and a typical setup time so expectations are honest up front.

### UX — how the feature demonstrates & explains its value to the user

The value is made obvious by seeing **Python/Go/Rust/Docker repos actually supported on day one**: the user connects a FastAPI repo and the agent runs its tests immediately; points at a Go module and the agent compiles and runs real code; opens a Rust crate and `cargo build`/`cargo test` just works. The honest setup/verify status surface — a live checklist that says "Installing CPython 3.12… ✓ 31s" rather than a spinner that lies, and is upfront that Rust is the slow one (~4 min cold) — converts the historically opaque first session into a legible, trustworthy "your toolchain is ready" moment. Auto-detect removes the single biggest first-session failure ("the agent can't even run my code").

### UX — how it's clear what the feature is doing (states & feedback)

Per-command, honest states mirroring `managedRuntimeProfileRuns` rows:

- **Picker** — cards per profile (what it installs + typical setup time); auto-detected profile highlighted.
- **Installing (per setup command)** — live checklist, each command with status + duration; the long pole (Rust ~4 min cold, Docker 165–335s) named, not hidden.
- **Verifying (per verification command)** — pass/fail per check ("uv on PATH ✓", "python on PATH ✓", "linker `cc` present ✓").
- **Ready** — resolved tool versions shown; agent can start.
- **Failed (actionable, per command)** — the failing required command named with the typed reason (e.g. Docker `verify-docker-daemon` → "needs a privileged tier"); the failure is a signal, not a dead end.

### UX — how to test the UX, including regressions

Concrete plan:

- **Profile-selection smoke**: with repos containing `go.mod` / `Cargo.toml` / `pyproject.toml` / `Dockerfile`, assert auto-detect pre-selects the matching profile, the user can override, and the choice persists per repo.
- **Setup/verify status smoke**: run a profile and assert the live checklist renders one row per setup and verify command with status + duration, reaches "Ready" on success, and shows the actionable failure copy on a required-command failure.
- **UX regressions to lock down (fail-before/pass-after)**: (1) Rust's `verify-linker` must be a required check and surfaced — add a failing test that a missing `cc` blocks "Ready" (the POC's real bug: `cargo run` failed with `linker 'cc' not found`); (2) Docker on a non-privileged tier must show the "needs privileged tier" signal rather than a generic error — assert the typed `wrong-tier` copy; (3) auto-detect must not silently override an explicit user selection — assert override sticks.

## Integration spec

- **Profile registry (the single seam)**: add the four profile literals (`python-uv`, `go-toolchain`, `rust-cargo`, `docker-in-sandbox`) as entries of the `MANAGED_RUNTIME_PROFILES` array in `packages/sandbox/managed-runtime-profiles.ts` (the `as const satisfies ManagedRuntimeProfile[]` declaration). Because that array is the single registry, this automatically flows them through `getManagedRuntimeProfile(id)` (`:154`), `listManagedRuntimeProfiles()` (`:168`, the picker), `isManagedRuntimeProfileId()` (`:172`), `normalizeManagedRuntimeProfileId()` (`:181`), and `getManagedRuntimeSnapshotCommands()` (`:189`) — no consumer change.
- **Resolution**: `apps/web/lib/managed-runtime/profile-resolution.ts` `resolveManagedRuntimeProfile()` already calls `isManagedRuntimeProfileId` → `getManagedRuntimeProfile(id)` first, then user `savedProfiles`, then default; registered built-ins take precedence with no change.
- **Observability / run tracking**: `apps/web/lib/observability/managed-runtime-profile-runs.ts` is profile-shape agnostic. `startManagedRuntimeProfileRun()` copies `expectedTools`/`optionalTools`/`profileVersion` off the profile; `appendManagedRuntimeSetupResult` / `appendManagedRuntimeVerificationResult` record one `ManagedRuntimeCommandObservation` per command. The POC runner emits the identical observation shape, so eval reports equal real `managedRuntimeProfileRuns` rows.
- **Saved profiles**: `apps/web/lib/db/managed-runtime-saved-profiles.ts` stores user-authored profiles with the identical column set; a built-in can be cloned into a saved profile with no transformation.
- **Auto-detect (net-new)**: a repo-inspection helper (read `pyproject.toml`/`requirements.txt`/`go.mod`/`Cargo.toml`/`Dockerfile`/`compose.yaml`) that maps to a profile id and feeds the picker default; colocated under `apps/web/lib/managed-runtime/`.
- **Setup-script option**: the POC profiles use inline `setupCommands` (no `setupScript`), fully supported by `getManagedRuntimeSnapshotCommands`. Optionally each could later add a `packages/sandbox/profiles/<id>/setup.sh` mirroring the inline commands.
- **Docker tier seam**: `docker-in-sandbox` requires a privileged sandbox tier and `dockerd --storage-driver vfs`; its required `verify-docker-daemon` failure on an unprivileged tier is the explicit "wrong tier" signal.

## In scope

- Register `python-uv`, `go-toolchain`, `rust-cargo` in `MANAGED_RUNTIME_PROFILES` (validated against the real base image).
- Repo-aware auto-detect mapping repo markers → profile id, feeding the picker default; remember selection per repo.
- The setup/verify status surface (live per-command checklist + states) driven by the existing `managedRuntimeProfileRuns` observation shape.
- Register `docker-in-sandbox` and wire its required `verify-docker-daemon` failure to the typed `wrong-tier` UX signal (privileged-tier gating sequenced alongside).
- Observability passthrough for the new profiles (no new code; verify the existing path records the new ids).
- Regression harness: profile-selection + setup/verify status smoke + Rust-linker + Docker-tier tests.

## Out of scope

- Snapshot/pre-bake caching of slow toolchains (Rust/Docker) — depends on 4c; this slice surfaces honest progress and remembers the profile, but does not amortize installs.
- Building the privileged sandbox tier itself / billing tiering — adjacent infra; this slice only emits the `wrong-tier` signal when Docker can't run.
- An egress allowlist/mirror for the four install endpoints (astral.sh, go.dev, sh.rustup.rs, get.docker.com) — noted as a follow-up for locked-down sandboxes.
- Additional runtimes beyond the four (Java, Ruby, .NET, etc.) — the pattern generalizes but each is its own slice.
- User-authored custom profile editor UX beyond cloning a built-in into a `savedProfile`.

## Research and context sources

- POC PR #89 and the `POC/4b-runtime-profiles/` folder (this branch): `README.md`, `PRODUCT-BRIEF.md`, `profiles/{python,go,rust,docker,types,index}.ts`, `runner/runner.ts`, `runner/docker-executor.ts`, `eval/{programs,run-eval}.ts`.
- POC eval evidence (per-profile verify transcripts + reports): `evidence/python-transcript.txt` + `python-report.json` (~40.1s, `PYTHON_OK 3 12`), `evidence/go-transcript.txt` + `go-report.json` (~27.4s, `GO_OK`, go1.26.3), `evidence/rust-transcript.txt` / `rust-transcript-pass2.txt` + `rust-report*.json` (241–359s, `RUST_OK` after the linker fix), `evidence/docker-transcript.txt` + `docker-report.json` (165–335s, `DOCKER_OK` via vfs, privileged), `evidence/summary-final.json`. Two real blind spots caught: Rust missing C linker; dind overlay-on-overlay (needs vfs).
- Codebase seams: `packages/sandbox/managed-runtime-profiles.ts` (registry + `ManagedRuntimeProfile` shape), `apps/web/lib/managed-runtime/profile-resolution.ts`, `apps/web/lib/observability/managed-runtime-profile-runs.ts`, `apps/web/lib/db/managed-runtime-saved-profiles.ts`.
- `docs/process/managed-runtime-proof-standard.md`, `docs/process/feature-ticket-format.md`.

## Agent todo checklist

- [ ] Read `packages/sandbox/managed-runtime-profiles.ts` and confirm the four POC objects satisfy `ManagedRuntimeProfile` byte-for-byte against the real type.
- [ ] Write the failing tests first: profile-registration/resolution/listing, auto-detect mapping, setup/verify status surface, Rust-`verify-linker`-required, Docker `wrong-tier` signal.
- [ ] Confirm red on all.
- [ ] Validate each language profile against the **real** sandbox base image (glibc/musl, package manager, preinstalled curl); adjust base-family-aware installs as needed.
- [ ] Register `python-uv`, `go-toolchain`, `rust-cargo` in `MANAGED_RUNTIME_PROFILES`.
- [ ] Implement repo auto-detect → profile id; feed the picker default; persist per-repo selection.
- [ ] Build the setup/verify status surface (live per-command checklist + states) over the existing observation shape.
- [ ] Register `docker-in-sandbox`; wire its required `verify-docker-daemon` failure to the typed `wrong-tier` UX.
- [ ] Confirm observability records the new profile ids with no code change.
- [ ] Make tests pass; run the adjacent suite, `git diff --check`, and `bun --bun run ci`.
- [ ] Capture Managed Runtime Proof evidence (per-profile verify transcripts on the real base) and update the profile-catalog docs.

## Tests to add first

- **Profile registration/resolution/listing (red first)**: the four ids resolve via `getManagedRuntimeProfile`, appear in `listManagedRuntimeProfiles`, validate via `isManagedRuntimeProfileId`, and a registered built-in beats a same-id `savedProfile`. Fails before registration.
- **Auto-detect mapping (red first)**: repo markers map to the correct profile id and an explicit user override is not silently replaced. Fails before the detector.
- **Setup/verify status surface (red first)**: one checklist row per setup and verify command with status/duration; reaches "Ready"; shows actionable failure copy on a required failure. Fails before the surface.
- **Rust `verify-linker` required (red first)**: a missing `cc` blocks "Ready" and surfaces the linker check (the POC's real bug). Fails if the profile omits the required linker check.
- **Docker `wrong-tier` signal (red first)**: `docker-in-sandbox` on a non-privileged tier produces the typed `wrong-tier` signal and the actionable copy, not a generic error. Fails before the signal wiring.

## Observability and user feedback

- **User-visible status**: per-command setup/verify checklist with status + duration; "Ready" with versions; actionable failure copy per required command.
- **Named service**: `managed-runtime` / `managed-runtime-profile-runs` emits structured events. Examples:
  - `profile-run-started` (info) `{ userId, sessionId, profileId, profileVersion, sandboxName }`
  - `setup-command-result` (info) `{ sessionId, profileId, commandId, label, status, required, exitCode, durationMs }`
  - `verification-command-result` (info) `{ sessionId, profileId, commandId, label, status, required, exitCode, durationMs }`
  - `profile-run-failed` (warn) `{ sessionId, profileId, commandId, errorKind }`
- **Typed error kinds**: `setup-command-failed`, `verification-failed`, `linker-missing`, `docker-daemon-unavailable` (`wrong-tier`), `egress-blocked`, `base-image-incompatible`.
- **Correlation IDs**: `userId`, `sessionId`, `profileId`, `profileVersion`, `sandboxName`, `commandId`/`runId`.
- **Redaction**: never log provider tokens, install-endpoint credentials, repo contents, or env values pulled into setup; redact command output via the existing `summarizeManagedRuntimeCommandOutput` / harness redaction path.
- **Grep-able debug recipe**: `grep '"sessionId":"<id>"' logs | grep '"service":"managed-runtime"' | grep '"profileId":"rust-cargo"'`; for failures `... | grep '"errorKind":"linker-missing"'`.
- **Evidence expectation (Managed Runtime Proof Standard)**: capture per-profile verify transcripts on the **real** sandbox base (install + verify + a real program run: `PYTHON_OK`/`GO_OK`/`RUST_OK`/`DOCKER_OK`), mirroring `POC/4b-runtime-profiles/evidence/<profile>-transcript.txt` and `<profile>-report.json`.

## Regression harness plan

- **Existing coverage**: `managed-runtime-profile-runs.test.ts` covers the observation shape; the default profile resolves today. No coverage for the four new ids, auto-detect, or the status surface.
- **New durable signals**: (1) a contract test that each new id resolves/lists/validates and that built-ins beat same-id `savedProfiles`; (2) an auto-detect unit test over repo-marker fixtures; (3) a setup/verify status surface integration/UI smoke; (4) the Rust-linker and Docker-tier tests; (5) a managed-runtime proof artifact per profile on the real base.
- **Fixtures**: repos containing `pyproject.toml` / `go.mod` / `Cargo.toml` / `Dockerfile`; a stub profile-run feeding the status surface; the POC `runner` + clean-container executor for the proof artifacts.
- **Fail-before/pass-after**: each test fails on `main` (ids unregistered, no detector, no surface) and passes after the slice.
- **Limits not caught**: the harness cannot catch base-image drift on the **real** sandbox (validate against the real base before GA), upstream install-script changes (astral.sh/go.dev/rustup/docker), or real cold-install latency — those need the gated real-base proof and ongoing maintenance.

## TDD audit trail

- Planned red commit: `test(managed-runtime): failing profile registration/resolution + auto-detect + setup-verify status + rust-linker + docker-tier` (observed red).
- Planned green commit: `feat(managed-runtime): register python/go/rust/docker profiles, repo auto-detect, honest setup-verify surface` (suite green after red).
- If a profile cannot be validated pre-merge on the real base (credentials/tier gating), record the exception and the manual per-profile proof captured in the PR per the Managed Runtime Proof Standard.

## Regression risks and concerns

- **Real base-image compatibility**: the eval used Debian-family images; the real sandbox base may differ (glibc vs musl, package manager, preinstalled curl). The Rust `gcc` install and apt fallbacks assume Debian/Alpine/RHEL families — validate each profile against the real base before GA.
- **Slow Rust/Docker installs**: Rust ~4 min cold and Docker 165–335s undercut the interactive promise without snapshot caching/pre-bake (4c); surface honest staged progress meanwhile.
- **dind privilege**: Docker-in-sandbox requires a privileged (or rootless-userns) sandbox and the vfs storage driver — a real infra/security/cost decision; the required `verify-docker-daemon` failure is the explicit wrong-tier signal.
- **Egress lockdown**: every profile fetches from the public internet (astral.sh, go.dev, sh.rustup.rs, get.docker.com); a locked-down sandbox needs an allowlist/mirror, and any endpoint being unreachable breaks setup.
- **Maintenance surface**: auto-detecting latest versions keeps toolchains current but can drift/break when upstreams change; each profile carries a `version` string for cache-busting and is an ongoing maintenance commitment.

## Deploy or migration impact

- **No schema migration** for the language profiles (declarative registry entries; `managedRuntimeProfileRuns` is shape-agnostic). If auto-detect persists a per-repo profile choice in a new column, generate the Drizzle migration and commit the `.sql`.
- **Managed-runtime profile registration**: `python-uv`, `go-toolchain`, `rust-cargo`, `docker-in-sandbox` ship in the registry; if `setupScript`s are added, ship `packages/sandbox/profiles/<id>/setup.sh`.
- **Privileged sandbox tier for dind**: `docker-in-sandbox` requires a privileged tier with `--storage-driver vfs`; gate it behind that tier and document it. Until the tier exists, the profile is selectable but reports `wrong-tier`.
- **Egress**: document the four install endpoints for any locked-down/egress-restricted deployment.
- **No production data backfill**; existing JS/TS sessions are unaffected.

## Definition of done

- [ ] Red test written first and observed failing (behavior proof red).
- [ ] Red-test commit recorded (or documented exception per the Managed Runtime Proof Standard).
- [ ] Green commit after the red, implementing the smallest change to pass.
- [ ] Targeted tests pass (registration/resolution/listing, auto-detect, status surface, rust-linker, docker-tier).
- [ ] Adjacent suite passes.
- [ ] `git diff --check` clean.
- [ ] `bun --bun run ci` passes (format, lint, typecheck, tests).
- [ ] Regression harness implemented (contract + auto-detect + status surface + rust-linker + docker-tier + per-profile proof artifacts).
- [ ] Docs updated (profile catalog, auto-detect, per-profile setup times, Docker tier note).
- [ ] Observability evidence captured (per-command setup/verify events on the new ids, typed errors, redaction verified).
- [ ] Deploy notes included (registration, optional per-repo column migration, privileged tier, egress endpoints).
- [ ] Managed Runtime Proof Standard evidence captured (per-profile verify transcripts on the real base: `PYTHON_OK`/`GO_OK`/`RUST_OK`/`DOCKER_OK`).
