<!-- TITLE: feat: Continue locally — byte-exact sandbox ↔ local state handoff via git bundle -->

## Why this matters

When a developer is mid-flow in a cloud session, the only way to get the work
onto their machine today is a commit and a PR/branch they then fetch and check
out. That moves the *committed* history but abandons everything that makes a
working session a working session: untracked scratch files vanish, the
staged-vs-unstaged split collapses, and deletions/exec-bits/binaries get mangled
by textual patches. Every developer who wants to finish in their own editor
feels this — sharpest for the person who has been iterating for twenty minutes
and just wants to "keep going in VS Code" without losing a single uncommitted
edit.

This ticket scopes the production build of **"Continue locally"** (and the
reverse, "Resume in sandbox"): a byte-exact, daemon-free handoff of a sandbox's
complete git state — branch, full commit-graph delta, **and the uncommitted
working state** (staged + unstaged + untracked, with file modes and binary
bytes) — into the developer's machine with one command, and back. The POC
(PR #87) proved this with stock `git bundle` plumbing and a three-tree capture
trick, hitting **byte-exact fidelity in both directions** across seven
independent fingerprints on a deliberately nasty mixed state. The hard part is
not the commits (git transports those well) — it is the uncommitted/untracked
fidelity that naive `git diff`/`git stash` silently drops; that blind spot is
eliminated. This is the high-value, low-risk member of the cloud↔local pair: no
remote-exec, no daemon, no standing authority.

## User/operator path protected

- A developer running a cloud session clicks **"Continue locally"** on the
  session/diff view.
- The backend runs an export routine *inside the live sandbox* (a sequence of
  `exec`-able git commands) producing a single portable artifact (`.bundle` +
  `.meta`), stores it, and returns a one-command checkout.
- The developer runs one command locally and gets their branch, full commit
  history, and exact in-progress edits landed byte-for-byte: staged change
  staged, unstaged tweak unstaged, untracked scratch file present, deletion
  reflected, `run.sh` still mode `755`, `logo.bin` byte-identical.
- **Reverse:** "Resume in sandbox" exports the local working tree and rehydrates
  a fresh sandbox clone to the same byte-exact state, updating session fields.
- The protected guarantee: after import, `git status -uall`, `git diff --cached`,
  `git diff`, the commit graph, and a sha256+mode manifest of every on-disk file
  are byte-identical to the source.

## Behavior contract

1. **Given** a sandbox on a `feature` branch 2 commits ahead of `main`, **when**
   the user clicks "Continue locally", **then** the export produces a single
   `git bundle` carrying the branch tip plus `refs/handoff/{head,index,worktree}`
   and a self-describing `.meta` sidecar (branch name + the two state-tree SHAs).
2. **Given** a staged modification with a further unstaged modification on top
   (status `MM`), **when** the bundle is imported into a fresh clone, **then**
   `git diff --cached` reproduces the staged diff exactly and `git diff`
   reproduces the unstaged diff exactly.
3. **Given** a brand-new untracked file the user never `git add`-ed, **when** the
   handoff completes, **then** that file is present on the target (plain
   `git stash create` would drop it — verified).
4. **Given** a tracked file deleted in the working tree (status `.D`), **when**
   imported, **then** the deletion is reflected (the file is absent on the
   target, derived from HEAD-minus-worktree).
5. **Given** an executable-mode file (`100755`) and a binary file, **when**
   restored via `git checkout-index -a -f`, **then** the exec bit is preserved
   (mode `755`) and the binary returns byte-identical (content-addressed blob,
   sha256 match).
6. **Given** the reverse direction (local → fresh sandbox), **when** the bundle
   is imported via `Sandbox.exec`, **then** all seven fingerprints match and
   `sessions.branch` / `sandboxState` update to the rehydrated state.
7. **Given** an uncommitted, non-gitignored file that looks like a secret
   (`.env`), **when** the user triggers export, **then** the UI warns before
   transport and the bundle is treated as a sensitive artifact (encrypted at
   rest, scoped/expiring URL).
8. **Given** a `.gitignore`'d file, **when** exported with default settings,
   **then** it is intentionally excluded (`git add -A` respects `.gitignore`)
   unless `--include-ignored` is opted in with a loud warning.

## Product and design spec

### UX — how users use it & how it's exposed

- **"Continue locally" button** on the session header / diff view. One click
  triggers the in-sandbox export.
- **One-command local checkout.** The backend produces the bundle and hands the
  user a ready-to-run command, e.g. `open-agents continue-locally session.bundle`
  (wrapping the proven `continue-locally.sh` = fresh `git clone` of
  `sessions.cloneUrl` + `import-state.sh`), so the user never touches raw
  scripts. Delivered via the same CLI as 3a or a copy-pasteable snippet — but it
  needs **no daemon and no remote-exec**.
- **"Resume in sandbox"** (reverse): a local CLI runs the export on the user's
  working tree, uploads the bundle, and the orchestrator provisions a fresh
  sandbox clone and rehydrates it.
- **No persistent connection.** This is a one-shot artifact transfer; the only
  persistence needed already exists on the `sessions` table.

### UX — how the feature demonstrates & explains its value to the user

- The export modal shows the exact state being transported, so the user sees
  the value before committing: "1 staged change • 1 unstaged change • 1 new file
  • 1 deletion • run.sh (executable) • logo.bin", with checkmarks for "includes
  untracked files", "preserves staged vs. unstaged split", "exec bits + binary
  files byte-identical".
- On the local side, the CLI prints a **fidelity summary** on completion (branch
  checked out, N commits fetched, staged/unstaged/untracked restored, and
  "working tree matches sandbox: ✓" derived from the same fingerprint check the
  eval uses), so the user can *trust* that "Continue locally" means exactly this
  state, not an approximation.

### UX — how it's clear what the feature is doing (states & feedback)

- **Export states:** `exporting` (running the in-sandbox capture) →
  `bundle-ready` (modal with the copy-button command + state summary) →
  `secret-warning` (a non-gitignored `.env`-like untracked file flagged before
  transport).
- **Import states (local):** `fetching-bundle` → `cloning` → `rehydrating`
  (materializing the worktree tree + index) → `fidelity-ok` ("working tree
  matches sandbox: ✓") or `fidelity-mismatch` (surfaced loudly with the failing
  fingerprint named) or `import-error`.
- **Reverse:** `uploading` → `provisioning-sandbox` → `rehydrated`
  (`sessions.branch`/`sandboxState` updated) or `resume-error`.

### UX — how to test the UX, including regressions

- **CLI integration test (fail-before/pass-after):** the POC eval (`src/eval.ts`)
  builds a realistic mixed state (`MM`, `A.`, `.D`, exec bit, binary, untracked,
  2-ahead) and asserts byte-exact fidelity in both directions across seven
  fingerprints; start from it and add a failing fingerprint assertion for each
  new edge before implementing. Assertions compare `git status -uall
  --porcelain=v2`, `git diff --cached`, `git diff`, branch, head, commit graph,
  and the sha256+mode manifest.
- **Authenticated-local-UI smoke (chat controls):** with `POSTGRES_URL` and
  `BETTER_AUTH_SECRET` present and migrations applied, drive the session UI with
  Agent Browser: assert the "Continue locally" button renders the state summary,
  click it, assert the `bundle-ready` modal shows the one-command checkout and the
  state breakdown, and assert the `secret-warning` appears for a seeded
  non-gitignored `.env`. Check `agent-browser errors`/`console`.
- **UX regressions to lock down:** the state-summary counts must match the
  sandbox; the secret warning must fire for non-gitignored secret-looking
  untracked files; the fidelity summary must report a mismatch loudly rather than
  silently succeeding when a fingerprint differs.

## Integration spec

- **Execution seam — `packages/sandbox/interface.ts`.** Every step is a plain
  `git` command string run via `Sandbox.exec(command, cwd, timeoutMs)`
  (interface.ts:132; bundle bytes read via `readFileBuffer`, interface.ts:126;
  concrete impl `packages/sandbox/vercel/sandbox.ts`). The export/import routines
  slot next to the existing git helpers in `packages/sandbox/git.ts`
  (`getCurrentBranch` git.ts:150, `getHeadSha` git.ts:158, `getStagedDiff`
  git.ts:166, `detectBinaryFiles` git.ts:232, `getFileModes` git.ts:303) as
  `exportHandoffBundle(sandbox)` (returns bundle bytes) and
  `importHandoffBundle(sandbox, bundle)` (reverse).
- **The git-bundle three-tree mechanism.** Transport is a single self-verifying
  `git bundle` (thin `<base>..<tip>` delta supported for ahead-of-main exports).
  Uncommitted capture writes two extra trees with plumbing:
  `refs/handoff/index` = `git write-tree` of the live index (**staged**);
  `refs/handoff/worktree` = `git add -A` into an **external throwaway index** then
  `git write-tree` (**staged + unstaged + untracked**, with exec bits + binary
  bytes). The importer reconstructs the split: HEAD→index = staged,
  index→worktree = unstaged, worktree-minus-HEAD = untracked/staged-new,
  HEAD-minus-worktree = working-tree deletions. Restore is byte-exact via
  `git checkout-index -a -f` through a throwaway index, then `git read-tree`
  points the real index at the staged snapshot.
- **Persistence / session fields — `apps/web/lib/db/schema.ts`.** The needed
  columns already exist on `sessions`: `repoOwner` (schema.ts:228), `repoName`
  (229), `branch` (230), `cloneUrl` (231), and the `sandboxState` JSON blob
  (249). Bundle storage can reuse blob storage or a `snapshotUrl`-style field
  (`snapshotUrl` schema.ts:289). "Continue locally" calls `exportHandoffBundle`,
  stores/streams the bundle, and hands the user
  `continue-locally.sh <bundle> <cloneUrl> <dest>` with `cloneUrl =
  sessions.cloneUrl` and the branch from `sessions.branch`.
- **Tech-debt supersession.** `git.ts` today reads changed files individually and
  base64-encodes binaries by hand; the bundle approach supersedes that with git's
  own content-addressed transfer and removes the per-file binary special-casing.
  The three-tree insight also feeds POC 4c.

## In scope

- `exportHandoffBundle(sandbox)` / `importHandoffBundle(sandbox, bundle)` next to
  `packages/sandbox/git.ts`, expressed entirely as `Sandbox.exec` git commands.
- The git-bundle + three-tree capture/restore (the proven mechanism), preserving
  staged/unstaged/untracked split, deletions, exec bits, and binary bytes.
- "Continue locally" button + `bundle-ready` modal + the one-command CLI wrapper
  (`open-agents continue-locally`).
- "Resume in sandbox" reverse path updating `sessions.branch` / `sandboxState`.
- Bundle storage (blob storage / `snapshotUrl`-style field) with **encryption at
  rest and scoped/expiring access URLs**.
- **Pre-export secret scan + warning** for non-gitignored secret-looking
  untracked files.
- A size guard before export; thin `<base>..<tip>` delta bundles for
  ahead-of-main exports.
- Structured observability (below) and the fidelity summary on import.

## Out of scope

- **Git LFS blob contents.** LFS pointer files transfer fine; LFS-backed blob
  *contents* are not in the bundle and need a separate fetch/transfer step (or a
  clear "LFS blobs not included" notice). Out of this slice.
- **Submodule working trees.** Only the gitlink (commit SHA) transfers; submodule
  working trees and their own uncommitted state are out of scope.
- **`.gitignore`'d-but-needed files** by default (`git add -A` respects
  `.gitignore`). An `--include-ignored` opt-in *with loud warnings* may be a
  follow-up, not this slice.
- **Cross-OS normalization beyond pinning.** The byte-exact guarantee assumes
  consistent `core.autocrlf` / `core.fileMode`; this slice pins them on both ends
  and scopes Windows-local EOL/mode edge cases out otherwise.
- **Device files / sockets / FIFOs** (not git-tracked, not transferred).
- Any remote-exec, daemon, or standing authority (that is POC 3a, not 3b).

## Research and context sources

- POC PR: https://github.com/dennisonbertram/fork-open-agents/pull/87
- POC folder: `POC/3b-sandbox-local-handoff/` (`README.md`, `PRODUCT-BRIEF.md`,
  `scripts/`, `src/`).
- Eval evidence: `POC/3b-sandbox-local-handoff/evidence/` — `00-summary.txt`
  (pass/fail roll-up), `01-source-sandbox.txt` (original state),
  `02-restored-local.txt` (direction 1, equals 01), `03-restored-sandbox-reverse.txt`
  (direction 2). `diff` of 01 vs 02 differs only in the title header line.
- POC source: `scripts/{export-state,import-state,continue-locally}.sh`,
  `src/exec-seam.ts` (stand-in for `Sandbox.exec`), `src/fidelity.ts`
  (byte-exact fingerprint + compare), `src/eval.ts`.
- Integration seams: `packages/sandbox/interface.ts` (`exec`, `readFileBuffer`),
  `packages/sandbox/git.ts`, `packages/sandbox/vercel/sandbox.ts`,
  `apps/web/lib/db/schema.ts` (`sessions` fields).
- Process: `docs/process/feature-ticket-format.md`,
  `docs/process/observability-discipline.md`,
  `docs/process/development-workflow.md#authenticated-local-ui-smoke`.

## Agent todo checklist

- [ ] Read `POC/3b-sandbox-local-handoff/scripts/*.sh`, `src/fidelity.ts`, and
      `packages/sandbox/git.ts` to map the seam and the protected path.
- [ ] Add a failing fidelity test asserting `git diff --cached` and `git diff`
      both reproduce on a fresh clone for the `MM` case (staged + further
      unstaged on the same file).
- [ ] Commit the failing test-only state on the work branch.
- [ ] Implement `exportHandoffBundle` (git-bundle + three-tree capture) and
      `importHandoffBundle` (checkout-index restore + read-tree) until the
      fidelity tests go green.
- [ ] Add tests for untracked, staged-new (`A.`), deletion (`.D`), exec-bit, and
      binary cases; confirm red, then green.
- [ ] Wire the reverse direction (local → sandbox) updating `sessions.branch` /
      `sandboxState`.
- [ ] Add bundle storage with encryption-at-rest + scoped/expiring URLs and the
      pre-export secret scan/warning.
- [ ] Add the size guard and thin delta-bundle path for ahead-of-main exports.
- [ ] Wire the "Continue locally" button + `bundle-ready` modal + CLI wrapper;
      add the authenticated-local-UI smoke.
- [ ] Land structured observability + the import fidelity summary.
- [ ] Run targeted tests, the adjacent suite, `git diff --check`, and
      `bun --bun run ci`.
- [ ] Update process docs and capture evidence (both-direction PASS table +
      fingerprint diff).

## Tests to add first

- **MM split:** staged change + further unstaged change on the same file →
  `git diff --cached` and `git diff` both reproduce on the target.
- **Untracked:** a never-`git add`-ed file is present after import (proves we beat
  `git stash create`, which drops it).
- **Staged-new (`A.`):** present in the index tree, restored staged.
- **Deletion (`.D`):** a tracked file deleted in the worktree is absent on the
  target.
- **Exec bit:** `run.sh` restored at mode `755` (manifest assertion).
- **Binary:** `logo.bin` byte-identical (sha256 manifest match), no encoding
  mangling.
- **Commit graph + branch:** `feature` 2 ahead of `main` reproduced; reachable
  graph fingerprint matches.
- **Reverse direction:** local → fresh sandbox reproduces all seven fingerprints.
- **Secret warning:** a non-gitignored `.env` untracked file triggers the
  pre-export warning.

## Observability and user feedback

- **User-visible status:** the export state summary, the `bundle-ready` modal, the
  secret warning, and the import fidelity summary ("working tree matches sandbox:
  ✓" or a named mismatch).
- **Named service:** `state-handoff` emits structured events. Examples:
  - `handoff-export-started` at **info** with `{ userId, sessionId, chatId,
    requestId, branch, commitsAhead }`.
  - `handoff-bundle-created` at **info** with `{ requestId, sessionId, bundleId,
    bundleSizeBytes, fileCount }` — the bundle URL/token is never logged.
  - `handoff-secret-warning` at **warn** with `{ requestId, sessionId,
    suspectFileCount }` — **never log the file path or contents**.
  - `handoff-import-completed` at **info** with `{ requestId, sessionId,
    fidelity: "ok" | "mismatch", failingFingerprint? }`.
  - `handoff-resume-completed` at **info** with `{ requestId, sessionId,
    sandboxName, branch }`.
- **Typed error kinds (`errorKind`):** `bundle-too-large`, `lfs-blobs-missing`,
  `submodule-skipped`, `fidelity-mismatch`, `import-clone-failed`,
  `bundle-fetch-expired`.
- **Correlation IDs:** `userId`, `sessionId`, `chatId`, `requestId`, plus
  `bundleId` and `sandboxName` on the relevant events.
- **Redaction rules:** never log bundle bytes, the bundle URL/token, working-tree
  file contents, diffs, or the paths/contents of secret-looking files — only
  counts and sizes. Treat the bundle itself as a sensitive artifact.
- **Debug recipes:**
  `grep '"service":"state-handoff"' logs | grep '"requestId":"<id>"'`;
  `grep '"event":"handoff-import-completed"' logs | grep '"fidelity":"mismatch"'`.
- **Evidence expectation:** capture the both-direction PASS table
  (`ALL FIDELITY CHECKS PASSED (both directions)`), the `git status
  --porcelain=v2` source/target diff (header-only difference), and the
  sha256+mode manifest showing `755 … run.sh` and the binary hash.

## Regression harness plan

- **Existing coverage:** the POC eval (`src/eval.ts`) builds the nasty mixed
  state and asserts seven fingerprints in both directions; port it into the
  package test suite as the durable harness.
- **New tests/smoke:** per-edge fidelity tests (MM, A., .D, exec bit, binary,
  untracked, 2-ahead, reverse) plus the authenticated-local-UI smoke for the
  "Continue locally" button + modal + secret warning.
- **Fixtures:** a throwaway repo seeded with `tracked.txt` (`MM`),
  `staged-new.txt` (`A.`), `to-delete.txt` (`.D`), `run.sh` (mode `755`),
  `logo.bin` (binary), `scratch-notes.txt` (untracked), on a `feature` branch
  2 commits ahead of `main`; plus a non-gitignored `.env` for the secret-scan
  test.
- **Fail-before/pass-after:** each fingerprint assertion fails on a naive
  `git diff`/`git stash` baseline (which drops untracked / collapses the split)
  and passes once the three-tree mechanism lands.
- **Limits not caught:** the harness uses macOS/Linux git with pinned
  `core.fileMode`; it does **not** cover Windows EOL/mode, LFS blob contents,
  submodule working trees, or multi-GB worktrees — those need separate explicit
  scoping/notices rather than this harness.

## TDD audit trail

- Red: commit the failing MM-split fidelity test (no export/import impl).
- Green: commit `exportHandoffBundle` + `importHandoffBundle` so the MM test
  passes.
- Red: commit failing untracked/staged-new/deletion/exec-bit/binary fidelity
  tests.
- Green: commit the three-tree capture/restore refinements that turn them green.
- Red: commit the failing reverse-direction (local → sandbox) test.
- Green: commit the reverse path + `sessions.branch`/`sandboxState` update.

## Regression risks and concerns

- **Secrets in the uncommitted bundle.** Uncommitted, non-gitignored
  `.env`/credential files **will** be captured and transported. The bundle can
  contain live secrets, so it must be encrypted at rest, served via
  scoped/expiring URLs, and preceded by a secret scan + loud warning. Mishandling
  is a real liability.
- **LFS / submodule gaps.** LFS blob *contents* are not in the bundle (pointers
  only); submodule working trees and their uncommitted state don't transfer.
  "Byte-exact" quietly becomes "byte-exact except" — needs honest UI and explicit
  scoping to avoid "but my repo…" tickets.
- **Cross-OS normalization.** The guarantee assumes consistent `core.autocrlf` /
  `core.fileMode`; Windows locals can mangle EOLs and lose mode bits unless these
  are pinned on both ends.
- **`.gitignore`'d-but-needed files** silently don't transfer (correct by default,
  surprising in practice) — needs the opt-in with warnings if added.
- **Huge worktrees.** `git add -A` into a throwaway index + a bundle scales with
  worktree size; multi-GB trees mean large/slow bundles — mitigated by delta
  bundles + a size guard.

## Deploy or migration impact

- **Bundle encryption + scoped URLs.** Store bundles encrypted at rest and serve
  them via scoped, expiring access URLs; never persist the bundle URL/token in
  logs. This is a launch requirement, not a follow-up.
- **Pre-export secret scan** must be live before GA so secret-bearing bundles are
  flagged before transport.
- **Schema:** the `sessions` columns needed already exist (`repoOwner`,
  `repoName`, `branch`, `cloneUrl`, `sandboxState`, `snapshotUrl`); if a new
  bundle-metadata column is added, generate a Drizzle migration
  (`bun run --cwd apps/web db:generate`) and commit the `.sql`. Preview
  deployments get isolated Neon branches, so handoff QA never touches production
  data.
- **CLI delivery.** The `continue-locally` wrapper can ship via the same CLI as
  3a but requires **no daemon and no remote-exec**, so it carries none of 3a's
  signed-release security-gate burden — only standard signed distribution of a
  read-only checkout helper.
- **Cross-OS config pinning** (`core.autocrlf` / `core.fileMode`) must be set on
  both sandbox and local checkout to hold the byte-exact promise.

## Definition of done

- [ ] Protected user/operator path named ("Continue locally" + "Resume in
      sandbox", byte-exact).
- [ ] Behavior proof captured **red first** (failing fidelity test observed
      before code).
- [ ] Red-test commit recorded on the work branch (or a documented exception).
- [ ] Green commit follows the red commit for each slice.
- [ ] Targeted tests pass (seven fingerprints, both directions, all edge cases).
- [ ] Adjacent suite passes.
- [ ] `git diff --check` is clean.
- [ ] `bun --bun run ci` passes.
- [ ] Regression harness implemented (ported both-direction eval + per-edge
      fidelity tests + authenticated-local-UI smoke).
- [ ] Observability evidence captured (both-direction PASS table, source/target
      fingerprint diff, sha256+mode manifest).
- [ ] Docs updated (process notes + lessons learned).
- [ ] Deploy notes included (bundle encryption + scoped/expiring URLs,
      pre-export secret scan, cross-OS config pinning, migration if schema
      changed).
