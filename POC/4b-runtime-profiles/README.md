# POC 4b — New managed-runtime profiles

## Goal

The Open Agents platform ships essentially **one** managed-runtime profile today:
`web-bun-agent-browser` (Bun + agent-browser, defined in
`packages/sandbox/managed-runtime-profiles.ts`). That profile only serves
JavaScript/TypeScript web repos. This POC proves the cheap, high-ROI extension:
**add new declarative runtime profiles** — Python, Go, Rust, and
Docker-in-sandbox — that are nothing more than `setupCommands` +
`verificationCommands` + `expectedTools` against the existing
`ManagedRuntimeProfile` type. No new platform machinery; new profiles widen the
kinds of repos the platform can serve.

The extension point is the `MANAGED_RUNTIME_PROFILES` array in
`packages/sandbox/managed-runtime-profiles.ts`.

## What was built

Four new `ManagedRuntimeProfile` objects, each matching the **real** TS type
byte-for-byte (verified — see Integration plan), plus a runner and a Docker eval
harness.

| File | Purpose |
|------|---------|
| `profiles/types.ts` | Verbatim copy of the real `ManagedRuntimeProfile` / `ManagedRuntimeProfileCommand` types (self-contained, zero import of app/package source). |
| `profiles/python.ts` | `python-uv` — installs Astral **uv** + a managed **CPython 3.12** (`uv python install 3.12`). |
| `profiles/go.ts` | `go-toolchain` — installs the **latest stable Go** from go.dev/dl (version auto-detected via `go.dev/VERSION?m=text`, extracted to `/usr/local/go`). |
| `profiles/rust.ts` | `rust-cargo` — installs the **stable Rust toolchain via rustup** (`rustc`, `cargo`) plus a C linker (`gcc`). |
| `profiles/docker.ts` | `docker-in-sandbox` — installs **Docker Engine + CLI** via get.docker.com and best-effort starts `dockerd --storage-driver vfs` (dind). |
| `profiles/index.ts` | Exports `NEW_MANAGED_RUNTIME_PROFILES` (the four objects, ready to register). |
| `runner/runner.ts` | Profile runner: executes setup → verify, resolves `expectedTools` on PATH, emits per-command observations and a pass/fail report **mirroring the real `managed-runtime-profile-runs` observability shape**. |
| `runner/docker-executor.ts` | Boots a clean Linux container and runs every profile command via `docker exec` with persistent env (installs from setup visible to verify). |
| `eval/programs.ts` | Tiny real programs per runtime (`PYTHON_OK`, `GO_OK`, `RUST_OK`, `DOCKER_OK`) used to prove the toolchain actually *works*. |
| `eval/run-eval.ts` | The meaningful eval: clean container per profile → run profile → run program proof → capture transcript + JSON report + timings to `evidence/`. |

All profiles follow the existing default profile's conventions exactly:
`set -e`, a `profile_bin_dir` (`$HOME/.open-agents/bin`) placed on PATH up
front, idempotent `command -v` guards, symlinking the resolved binary into
`profile_bin_dir` + `/usr/local/bin`, and a final `command -v <tool>` +
version print so the transcript proves success. Profiles declare their own
toolchain and assume nothing beyond the base image (and `curl`).

## How it was tested + evidence

Docker **was used** (Docker 29.4.0). Each profile ran in a **clean Linux
container** — `buildpack-deps:bookworm-curl` (ships curl + ca-certificates but
none of python/go/rust/docker; a realistic stand-in for a managed sandbox base)
for Python/Go/Rust, and a **privileged** `debian:bookworm` for the
Docker-in-sandbox profile (dind needs a privileged container).

For each profile the eval ran the profile's `setupCommands`, then its
`verificationCommands`, asserted every required command exited 0 and every
`expectedTool` resolved on PATH, then ran a **tiny real program** to prove the
toolchain compiles/runs — not just that the binary exists.

Evidence per profile in `evidence/`:
- `<profile>-transcript.txt` — full setup + verify + program-proof transcript.
- `<profile>-report.json` — the runner's structured pass/fail report (a
  `managedRuntimeProfileRuns`-shaped row).
- `summary.json` — machine-readable roll-up; `eval-run.log` — the live console.

### Results (measured)

| Profile | Base image | Setup status | Verify | Tools on PATH | Program proof | Setup time |
|---------|-----------|--------------|--------|---------------|---------------|------------|
| `python-uv` | buildpack-deps:bookworm-curl | passed | 3/3 | `uv`, `python` ✅ | **`PYTHON_OK 3 12`** ✅ | **40.1 s** |
| `go-toolchain` | buildpack-deps:bookworm-curl | passed | 3/3 | `go`, `gofmt` ✅ | **`GO_OK`** ✅ | **27.4 s** |
| `rust-cargo` | buildpack-deps:bookworm-curl | passed | 4/4 (incl. `verify-linker`) | `rustc`, `cargo`, `cc` ✅ | **`RUST_OK`** ✅ (after linker fix) | **241–359 s** |
| `docker-in-sandbox` | debian:bookworm (privileged) | passed | CLI ✅, daemon ✅, run ✅ | `docker` ✅ | **`DOCKER_OK`** ✅ (vfs driver) | **165–335 s** |

Program-proof commands actually executed:
- **Python**: wrote `hello.py`, `python hello.py` → `PYTHON_OK 3 12` (CPython 3.12.13).
- **Go**: `go mod init` + `go run main.go` (real compile) → `GO_OK` (go1.26.3).
- **Rust**: `cargo new` + `cargo run` (real compile + link) → `RUST_OK`.
- **Docker**: `docker run --rm hello-world` against the in-sandbox daemon → `DOCKER_OK`.

### Two real blind spots the eval caught (and fixed)

These are exactly the failures a smoke test would have missed:

1. **Rust needs a C linker.** First pass: rustup install + `rustc --version`
   passed, but `cargo run` failed with `error: linker 'cc' not found`. The
   `--profile minimal` rustup install does **not** bundle a linker and
   `buildpack-deps` has no `cc`. Fix: the profile now installs `gcc` via the
   system package manager before rustup, adds a required `verify-linker`
   command, and lists `cc` in `expectedTools`. Re-run: `RUST_OK`.
2. **Nested Docker can't use overlay2.** First pass: `dockerd` started and
   `docker info` passed inside the privileged container, but
   `docker run hello-world` failed mounting overlay-on-overlay
   (`fstype: overlay … invalid argument`). Fix: start
   `dockerd --storage-driver vfs`. Re-run: `DOCKER_OK`.

## Integration plan (into the real codebase)

The four objects satisfy the **real** `ManagedRuntimeProfile` type — verified by
compiling `NEW_MANAGED_RUNTIME_PROFILES` against the type imported directly from
`packages/sandbox/managed-runtime-profiles.ts` (`tsc --noEmit` clean). They drop
in with no edits:

1. **Register in the profile array.** In
   `packages/sandbox/managed-runtime-profiles.ts`, add the profile literals as
   additional entries of the `MANAGED_RUNTIME_PROFILES` array (the
   `as const satisfies ManagedRuntimeProfile[]` declaration). Because that array
   is the single registry, this automatically makes the new ids flow through
   every consumer:
   - `getManagedRuntimeProfile(id)` resolves them.
   - `listManagedRuntimeProfiles()` lists them (profile picker UI).
   - `isManagedRuntimeProfileId()` / `normalizeManagedRuntimeProfileId()`
     recognize them.
   - `getManagedRuntimeSnapshotCommands()` returns their setup+verify commands.
2. **Resolution.** `apps/web/lib/managed-runtime/profile-resolution.ts`
   `resolveManagedRuntimeProfile()` already calls `isManagedRuntimeProfileId` →
   `getManagedRuntimeProfile(id)` first, falling back to user `savedProfiles`
   then the default. Registered built-ins take precedence with no change.
3. **Observability / run tracking.** No change needed:
   `apps/web/lib/observability/managed-runtime-profile-runs.ts` is profile-shape
   agnostic. `startManagedRuntimeProfileRun()` copies `expectedTools`,
   `optionalTools`, `profileVersion`, etc. straight off the profile;
   `appendManagedRuntimeSetupResult` / `appendManagedRuntimeVerificationResult`
   record one `ManagedRuntimeCommandObservation` per command
   (`commandId`/`label`/`status`/`required`/`exitCode`/`durationMs`/`summary`).
   The runner in this POC produces the same observation shape, so the eval
   reports are equivalent to what `managedRuntimeProfileRuns` rows would hold.
4. **`savedProfiles`.** `apps/web/lib/db/managed-runtime-saved-profiles.ts`
   stores user-authored profiles with the identical column set
   (`setupCommands`, `verificationCommands`, `expectedTools`, …). A built-in
   profile can be cloned into a saved profile with no transformation; the new
   profiles are valid saved-profile drafts as-is.
5. **Optional: `setupScript`.** The default profile ships a checked-in
   `setup.sh` under `packages/sandbox/profiles/<id>/`. These POC profiles use
   inline `setupCommands` (no `setupScript`), which is fully supported —
   `getManagedRuntimeSnapshotCommands` handles both branches. If desired, each
   could later add a `profiles/<id>/setup.sh` mirroring the inline commands.

## Feasibility verdict

**Feasible and cheap.** Adding a new runtime is purely declarative — a profile
object plus install/verify command strings — and the platform's resolution,
listing, and observability layers absorb new profiles with zero code change. All
four runtimes install and **actually run a program** in a clean Linux container.
Measured setup times (cold, single network, aarch64):

- Python (uv + CPython 3.12): **~40 s**
- Go (latest stable tarball): **~27 s**
- Rust (rustup stable + gcc): **241–359 s** (rustup toolchain download + gcc apt install dominate)
- Docker-in-sandbox (Engine + dind, vfs): **165–335 s** (apt install of
  docker-ce + containerd dominates; requires a privileged sandbox tier)

## Blind spots eliminated

- **Install time per runtime** measured end-to-end (above). Rust is the outlier
  by an order of magnitude (rustup component download); Go is the fastest.
- **Base-image deps**: all installers need `curl` + `ca-certificates`; Rust
  additionally needs a **C linker (`cc`/gcc)** to link binaries — caught by the
  program proof, not the version check. Docker needs apt + a privileged
  container.
- **Version pinning / currency**: Go and uv-Python auto-detect the latest
  (go1.26.3, CPython 3.12.13, uv 0.11.17 observed) rather than pinning a stale
  version; Rust pins `stable`. Each profile carries a `version` string for
  cache-busting in `managedRuntimeProfileRuns`.
- **"Binary exists" ≠ "toolchain works"**: proven — `rustc --version` passed
  while `cargo run` failed; `docker info` passed while `docker run` failed.
  Required the program proofs to surface.
- **dind viability**: the daemon **does** start in a privileged container and
  `docker info` succeeds; container execution needs the **vfs** storage driver
  for overlay-on-overlay.

## Remaining risks

- **Sandbox base-image compatibility.** The eval used Debian-family bases. The
  real Vercel/managed sandbox base may differ (glibc vs musl, available package
  manager, preinstalled curl). The Rust `gcc` install and any apt fallbacks
  assume Debian/Alpine/RHEL families; an unknown base could need adjustment.
- **Docker-in-sandbox privilege requirement.** dind requires a **privileged**
  (or rootless-with-userns) sandbox. If the managed sandbox runs unprivileged,
  the `verify-docker-daemon` (required) command will fail by design — that
  failure is the explicit signal that this profile needs a privileged runtime
  tier. The vfs storage driver also trades speed for compatibility.
- **Rust setup latency.** ~4 min cold is long for an interactive session;
  consider caching the rustup toolchain in the sandbox snapshot or pre-baking it
  into a base layer.
- **Network egress.** Every profile fetches from the public internet
  (astral.sh, go.dev, sh.rustup.rs, get.docker.com). A locked-down sandbox would
  need an allowlist or a mirror.

## Running the eval

```bash
cd POC/4b-runtime-profiles
bun install
bun run eval/run-eval.ts python go rust docker   # or any subset
# evidence written to evidence/
```
